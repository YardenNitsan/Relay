import {randomUUID} from 'node:crypto';
import {lstat,open,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {publicationSchema,publicationConfirmationSchema,type Publication,type PublicationSummary} from '../../shared/publication';
import {authorizeOwner,type Principal} from '../auth/policy';
import {AppError,checkSignal,publicError} from '../core/errors';
import {row,type Store} from '../db/store';
import type {Workspace} from '../../shared/types';
import {privateDirectory,writePrivate} from '../host/private-storage';
import {HostFileBroker} from './host-files';
import {ToolStore} from './store';
import {readGitBaseline} from './git-baseline';
import {boundedText,sha256,snapshot} from './files';
import {inspectPath,readFlags,safePath,sourceRoot} from './platform';
import {StorageBudget} from './storage-budget';

type Maintenance=<T>(workspaceId:string,operation:()=>Promise<T>)=>Promise<T>;
const MAX_RECORDS=100,MAX_JOURNAL_BYTES=8*1024*1024,MAX_CONTENT_BYTES=2*1024*1024;
const identity=async(path:string)=>{const info=await lstat(path,{bigint:true});return {dev:String(info.dev),ino:String(info.ino)};};
const sameIdentity=(a:{dev:string;ino:string},b:{dev:string;ino:string})=>a.dev===b.dev&&a.ino===b.ino;
const digest=(record:Publication)=>sha256(JSON.stringify({version:record.version,id:record.id,workspaceId:record.workspaceId,userId:record.userId,sessionVersion:record.sessionVersion,stopGeneration:record.stopGeneration,sourcePath:record.sourcePath,sourceIdentity:record.sourceIdentity,direction:record.direction,parentId:record.parentId,expiresAt:record.expiresAt,entries:record.entries.map(({before:_,after:__,...entry})=>entry)}));

/** Owner UI only. No tool definition exposes original-project publication to a model. */
export class PublicationService {
  private queue:Promise<unknown>=Promise.resolve();
  private ready=false;
  private readonly tools:ToolStore;
  private readonly host:HostFileBroker;
  private readonly now:()=>number;
  constructor(private readonly store:Store,private readonly dataDir:string,private readonly maintenance:Maintenance,options:{host?:HostFileBroker;now?:()=>number}={}){
    this.tools=new ToolStore(dataDir);this.host=options.host??new HostFileBroker(dataDir);this.now=options.now??Date.now;
  }
  private serial<T>(operation:()=>Promise<T>):Promise<T>{const result=this.queue.then(operation);this.queue=result.catch(()=>{});return result;}
  private async authorize(actor:Principal,record?:Publication,mutating=false):Promise<{generation:number}>{
    authorizeOwner(actor);
    const saved=(await this.store.db.query("SELECT u.enabled,u.role,u.registration_status,u.session_version,c.value AS control,(SELECT value FROM settings WHERE key='restoration_pending') AS restoration FROM users u JOIN sessions s ON s.user_id=u.id CROSS JOIN settings c WHERE u.id=$1 AND s.id=$2 AND s.remote=false AND s.expires_at>now() AND s.version=u.session_version AND c.key='control'",[actor.user.id,actor.sessionId]))[0];
    if(!saved||saved.enabled!==true||saved.role!=='owner'||saved.registration_status!=='approved'||Number(saved.session_version)!==actor.user.sessionVersion)throw new AppError('PUBLICATION_AUTH','Owner authorization changed.',403);
    if(record&&record.userId!==actor.user.id)throw new AppError('PUBLICATION_NOT_FOUND','Publication review not found.',404);
    const control=saved.control as {stopped:boolean;generation:number};
    if(mutating&&(control.stopped||saved.restoration===true))throw new AppError('PUBLICATION_STOPPED','Review restoration and resume execution before publishing files.',409);
    if(mutating&&record&&(record.sessionVersion!==actor.user.sessionVersion||record.stopGeneration!==control.generation))throw new AppError('PUBLICATION_REVOKED','This review was revoked. Create a new review.',409);
    return control;
  }
  private async init(){await this.tools.init();await inspectPath(this.tools.root);if(!this.ready){await privateDirectory(join(this.tools.root,'publications'));this.ready=true;}await inspectPath(this.tools.root,'publications');}
  private async read(id:string):Promise<Publication>{
    z.string().uuid().parse(id);await this.init();const path=await inspectPath(this.tools.root,`publications/${id}.json`);let file;
    try{file=await open(path,readFlags());const info=await file.stat();if(!info.isFile()||info.nlink!==1||info.size>MAX_JOURNAL_BYTES)throw new Error('Invalid publication journal');
      const record=publicationSchema.parse(JSON.parse(await file.readFile('utf8')));
      if(record.id!==id||record.entries.some(entry=>{safePath(entry.path);boundedText(entry.before);boundedText(entry.after);return sha256(entry.before)!==entry.beforeHash||sha256(entry.after)!==entry.afterHash;})||digest(record)!==record.digest)throw new Error('Publication journal integrity failed');
      return record;
    }finally{await file?.close();}
  }
  private async records():Promise<Publication[]>{await this.init();const names=await readdir(join(this.tools.root,'publications'));if(names.length>MAX_RECORDS)throw new AppError('PUBLICATION_CAPACITY','Publication history requires owner maintenance.',409);const records:Publication[]=[];for(const name of names){if(!/^[0-9a-f-]{36}\.json$/.test(name))throw new Error('Unexpected publication journal file');records.push(await this.read(name.slice(0,-5)));}return records.sort((a,b)=>a.sequence-b.sequence);}
  private async save(record:Publication){publicationSchema.parse(record);const content=JSON.stringify(record);if(Buffer.byteLength(content)>MAX_JOURNAL_BYTES)throw new Error('Publication journal exceeds its bounded size');await writePrivate(await inspectPath(this.tools.root,`publications/${record.id}.json`),content);}
  private async scope(record:Pick<Publication,'workspaceId'|'sourcePath'|'sourceIdentity'>){
    const saved=(await this.store.db.query('SELECT * FROM workspaces WHERE id=$1',[record.workspaceId]))[0];
    if(!saved||saved.source_path!==record.sourcePath||saved.owner_user_id)throw new AppError('PUBLICATION_SCOPE','Imported project scope changed.',409);
    const path=await sourceRoot(record.sourcePath,this.dataDir);
    if(path!==record.sourcePath||!sameIdentity(await identity(path),record.sourceIdentity))throw new AppError('PUBLICATION_IDENTITY','Original project directory identity changed.',409);
  }
  private async inspectEntry(record:Publication,entry:Publication['entries'][number],expectedHash:string,actor:Principal){
    await this.scope(record);const path=join(record.sourcePath,safePath(entry.path));
    if(!sameIdentity(await identity(path),entry.identity))throw new AppError('PUBLICATION_IDENTITY',`Original file identity changed: ${entry.path}`,409);
    const result=JSON.parse((await this.host.execute('host_read',{path},undefined,()=>{},undefined,()=>this.authorize(actor).then(()=>{}))).content) as {sha256:string;redacted:boolean};
    if(result.redacted)throw new AppError('PUBLICATION_PROTECTED','Protected credential content cannot be published.',403);
    if(result.sha256!==expectedHash)throw new AppError('PUBLICATION_CONFLICT',`Original file changed: ${entry.path}. No overwrite is permitted.`,409);
    if(!sameIdentity(await identity(path),entry.identity))throw new AppError('PUBLICATION_IDENTITY','Original file identity changed during inspection.',409);
  }
  private async newRecord(actor:Principal,workspace:Workspace,entries:Publication['entries'],direction:'publish'|'rollback',parentId:string|null,records:Publication[]):Promise<Publication>{
    if(records.length>=MAX_RECORDS)throw new AppError('PUBLICATION_CAPACITY','Publication history reached 100 reviews. Preserve recovery records and perform owner maintenance.',409);
    if(!entries.length)throw new AppError('PUBLICATION_EMPTY','No existing-file modifications are available to review.',409);
    if(entries.length>20||entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.before)+Buffer.byteLength(entry.after),0)>MAX_CONTENT_BYTES)throw new AppError('PUBLICATION_LIMIT','Publish at most 20 files and 2 MiB of combined before/after text per review.',409);
    const control=await this.authorize(actor,undefined,true),createdAt=new Date(this.now()).toISOString();
    const record:Publication={version:1,id:randomUUID(),sequence:(records.at(-1)?.sequence??0)+1,userId:actor.user.id,sessionVersion:actor.user.sessionVersion,stopGeneration:control.generation,workspaceId:workspace.id,sourcePath:workspace.sourcePath!,sourceIdentity:await identity(workspace.sourcePath!),direction,parentId,createdAt,expiresAt:new Date(this.now()+600_000).toISOString(),digest:'0'.repeat(64),status:'preview',completed:[],error:null,entries};
    record.digest=digest(record);for(const entry of entries)await this.inspectEntry(record,entry,entry.beforeHash,actor);
    await this.authorize(actor,record,true);await new StorageBudget(this.dataDir).assertCapacity(2*Buffer.byteLength(JSON.stringify(record))+2*1024*1024);await this.save(record);return record;
  }
  async preview(actor:Principal,workspaceId:string):Promise<Publication>{return this.serial(()=>this.maintenance(workspaceId,async()=>{
    await this.authorize(actor,undefined,true);const saved=(await this.store.db.query('SELECT * FROM workspaces WHERE id=$1',[z.string().uuid().parse(workspaceId)]))[0];
    if(!saved||!saved.source_path||saved.owner_user_id)throw new AppError('PUBLICATION_SCOPE','Publication requires a host-imported managed project.',409);
    const workspace=row<Workspace>(saved),records=await this.records();
    if(records.some(record=>record.sourcePath===workspace.sourcePath&&['applying','uncertain'].includes(record.status)))throw new AppError('PUBLICATION_UNCERTAIN','Review the existing uncertain publication before publishing again.',409);
    await sourceRoot(workspace.sourcePath!,this.dataDir);const current=await snapshot(await this.tools.workspaceRoot(workspaceId),true),baseline=await readGitBaseline(this.tools,workspaceId,current,()=>{});
    if(baseline.metadata.kind!=='workspace_creation')throw new AppError('PUBLICATION_BASELINE','This project has no authentic import baseline. Import a fresh managed copy.',409);
    for(const record of records)if(record.workspaceId===workspaceId&&record.sourcePath===workspace.sourcePath&&record.status==='completed')for(const entry of record.entries)baseline.files.set(entry.path,entry.after);
    const entries:Publication['entries']=[];
    for(const path of [...new Set([...baseline.files.keys(),...current.keys()])].sort()){
      const before=baseline.files.get(path),after=current.get(path);if(before===after)continue;
      if(before===undefined||after===undefined)throw new AppError('PUBLICATION_EXISTING_ONLY','This publication workflow supports existing-file modifications only. Review additions and deletions separately.',409);
      entries.push({path:safePath(path),before,after,beforeHash:sha256(before),afterHash:sha256(after),identity:await identity(join(workspace.sourcePath!,path))});
    }
    return this.newRecord(actor,workspace,entries,'publish',null,records);
  }));}
  async get(actor:Principal,id:string):Promise<Publication>{return this.serial(async()=>{await this.authorize(actor);const record=await this.read(id);await this.authorize(actor,record);return record;});}
  async list(actor:Principal,workspaceId:string):Promise<PublicationSummary[]>{return this.serial(async()=>{await this.authorize(actor);const records=await this.records();await this.authorize(actor);return records.filter(record=>record.userId===actor.user.id&&record.workspaceId===workspaceId).reverse().map(({id,workspaceId,direction,createdAt,status,completed,error,parentId,entries})=>({id,workspaceId,direction,createdAt,status,completed,error,parentId,files:entries.length}));});}
  async apply(actor:Principal,id:string,input:unknown,signal:AbortSignal=new AbortController().signal):Promise<Publication>{
    const approval=publicationConfirmationSchema.parse(input);
    return this.serial(async()=>{checkSignal(signal);await this.authorize(actor);const record=await this.read(id);await this.authorize(actor,record);
      if(approval.digest!==record.digest)throw new AppError('PUBLICATION_APPROVAL','The confirmation does not match the reviewed changes.',409);
      if(record.status==='completed'||record.status==='rolled_back')return record;
      if(record.status!=='preview')throw new AppError('PUBLICATION_UNCERTAIN','Publication may have changed files. Automatic replay is blocked; inspect and review rollback.',409);
      if(Date.parse(record.expiresAt)<=this.now())throw new AppError('PUBLICATION_EXPIRED','This preview expired. Create a fresh review.',409);
      return this.maintenance(record.workspaceId,async()=>{
        checkSignal(signal);await this.authorize(actor,record,true);await this.scope(record);
        if((await this.records()).some(other=>other.id!==record.id&&other.id!==record.parentId&&other.sourcePath===record.sourcePath&&['applying','uncertain'].includes(other.status)))throw new AppError('PUBLICATION_UNCERTAIN','Another publication for this source requires recovery review.',409);
        for(const entry of record.entries)await this.inspectEntry(record,entry,entry.beforeHash,actor);
        checkSignal(signal);record.status='applying';await this.save(record);
        try{
          for(const entry of record.entries){
            await this.authorize(actor,record,true);await this.inspectEntry(record,entry,entry.beforeHash,actor);
            const authorize=async()=>{checkSignal(signal);await this.authorize(actor,record,true);await this.scope(record);if(!sameIdentity(await identity(join(record.sourcePath,entry.path)),entry.identity))throw new AppError('PUBLICATION_IDENTITY','Original file identity changed before writing.',409);};
            await this.host.execute('host_write',{path:join(record.sourcePath,entry.path),content:entry.after,expectedHash:entry.beforeHash},signal,()=>{},`publication-${record.id}`,authorize);
            record.completed.push(entry.path);await this.save(record);
          }
          for(const entry of record.entries)await this.inspectEntry(record,entry,entry.afterHash,actor);
          checkSignal(signal);await this.authorize(actor,record,true);
          await this.store.audit(null,'PROJECT_PUBLICATION_COMPLETED',{publicationId:record.id,workspaceId:record.workspaceId,direction:record.direction,files:record.entries.length,userId:actor.user.id});
          record.status='completed';await this.save(record);
          if(record.parentId){const parent=await this.read(record.parentId);parent.status='rolled_back';await this.save(parent);}
          return record;
        }catch(error){record.status='uncertain';record.error=publicError(error).slice(0,500);await this.save(record);throw new AppError('PUBLICATION_UNCERTAIN',`Publication stopped; files may have changed. Review receipt ${record.id} before any retry.`,409);}
      });
    });
  }
  async rollbackPreview(actor:Principal,id:string):Promise<Publication>{return this.serial(async()=>{
    await this.authorize(actor);const parent=await this.read(id);await this.authorize(actor,parent);
    if(parent.direction!=='publish'||!['applying','uncertain','completed'].includes(parent.status))throw new AppError('PUBLICATION_ROLLBACK','This receipt cannot be rolled back through this workflow.',409);
    return this.maintenance(parent.workspaceId,async()=>{
      await this.authorize(actor,undefined,true);await this.scope(parent);const entries:Publication['entries']=[];
      for(const entry of parent.entries){
        try{await this.inspectEntry(parent,entry,entry.beforeHash,actor);continue;}catch(error){if(!(error instanceof AppError)||error.code!=='PUBLICATION_CONFLICT')throw error;}
        await this.inspectEntry(parent,entry,entry.afterHash,actor);entries.push({...entry,before:entry.after,after:entry.before,beforeHash:entry.afterHash,afterHash:entry.beforeHash});
      }
      return this.newRecord(actor,{id:parent.workspaceId,sourcePath:parent.sourcePath} as Workspace,entries.reverse(),'rollback',parent.id,await this.records());
    });
  });}
  async reconcile(actor:Principal,id:string,input:unknown):Promise<Publication>{
    const approval=publicationConfirmationSchema.parse(input);
    return this.serial(async()=>{
      await this.authorize(actor);const record=await this.read(id);await this.authorize(actor,record);
      if(record.digest!==approval.digest||!['applying','uncertain'].includes(record.status))throw new AppError('PUBLICATION_REVIEW','Select an uncertain receipt and confirm its exact review.',409);
      return this.maintenance(record.workspaceId,async()=>{
      await this.scope(record);let before=true,after=true;
      for(const entry of record.entries){
        try{await this.inspectEntry(record,entry,entry.beforeHash,actor);after=false;}
        catch(error){if(!(error instanceof AppError)||error.code!=='PUBLICATION_CONFLICT')throw error;await this.inspectEntry(record,entry,entry.afterHash,actor);before=false;}
      }
      if(!before&&!after)throw new AppError('PUBLICATION_PARTIAL','Files are in a mixed state. Review rollback or inspect private checkpoints before closing this receipt.',409);
      await this.authorize(actor,record);record.status=before?'rolled_back':'completed';record.error=null;record.completed=after?record.entries.map(entry=>entry.path):[];await this.save(record);
      if(after&&record.parentId){const parent=await this.read(record.parentId);parent.status='rolled_back';await this.save(parent);}
      await this.store.audit(null,'PROJECT_PUBLICATION_RECONCILED',{publicationId:record.id,userId:actor.user.id,observed:before?'original':'approved'});return record;
      });
    });
  }
}
