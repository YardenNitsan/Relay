import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm,rename,lstat,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openDatabase} from '../server/db/database';
import {Store,row} from '../server/db/store';
import type {Principal,User} from '../server/auth/policy';
import {ToolBroker} from '../server/tools';
import {HostFileBroker} from '../server/tools/host-files';
import {PublicationService} from '../server/tools/publication';
import {sha256} from '../server/tools/files';
import * as toolFiles from '../server/tools/files';

let root:string,source:string,data:string,store:Store,broker:ToolBroker,service:PublicationService,actor:Principal,workspaceId:string,host:HostFileBroker;
beforeEach(async()=>{
  await mkdir(resolve('output'),{recursive:true});root=await mkdtemp(join(resolve('output'),'publication-test-'));source=join(root,'source');data=join(root,'data');
  await Promise.all([mkdir(source),mkdir(data),mkdir(join(root,'installation'))]);
  await writeFile(join(source,'one.ts'),'export const one = 1;\n');await writeFile(join(source,'two.ts'),'export const two = 2;\n');await writeFile(join(source,'unrelated.txt'),'Original owner work');
  store=new Store(await openDatabase());await store.init();actor={user:row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]),remote:false,sessionId:'fixture'};
  await store.db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES('fixture','owner','fixture-csrf',false,'test',0,now()+interval '1 day')");
  broker=new ToolBroker(data,()=>false,undefined,store);const workspace=await broker.createWorkspace('Test project',source);workspaceId=workspace.id;await store.saveWorkspace(workspace);
  host=new HostFileBroker(data,join(root,'installation'));
  service=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
  await broker.changeFile(workspaceId,'one.ts','export const one = 10;\n',sha256('export const one = 1;\n'));
  await broker.changeFile(workspaceId,'two.ts','export const two = 20;\n',sha256('export const two = 2;\n'));
});
afterEach(async()=>{vi.restoreAllMocks();await store.close();await rm(root,{recursive:true,force:true});});
const confirm=(digest:string)=>({digest,confirmed:true as const});
describe('explicit original project publication',()=>{
  it('reviews nested directory creation, publishes exact files and rolls back files while retaining later owner contents',async()=>{
    await broker.upload(workspaceId,'features/new-feature/index.ts','export const added = true;\n');
    const preview=await service.preview(actor,workspaceId);expect(preview.version).toBe(3);expect(preview.directories?.map(item=>item.path)).toEqual(['features','features/new-feature']);
    await expect(lstat(join(source,'features'))).rejects.toMatchObject({code:'ENOENT'});
    const applied=await service.apply(actor,preview.id,confirm(preview.digest));expect(await readFile(join(source,'features/new-feature/index.ts'),'utf8')).toBe('export const added = true;\n');expect(Object.keys(applied.createdDirectoryIdentities??{})).toEqual(['features','features/new-feature']);
    await writeFile(join(source,'features/new-feature/owner.txt'),'Later independent owner work');
    const rollback=await service.rollbackPreview(actor,preview.id);await service.apply(actor,rollback.id,confirm(rollback.digest));
    await expect(lstat(join(source,'features/new-feature/index.ts'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(source,'features/new-feature/owner.txt'),'utf8')).toBe('Later independent owner work');expect((await lstat(join(source,'features/new-feature'))).isDirectory()).toBe(true);
  });
  it('refuses a directory that appears after review before writing any source files',async()=>{
    await broker.upload(workspaceId,'new-folder/file.txt','new');const preview=await service.preview(actor,workspaceId);await mkdir(join(source,'new-folder'));
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toThrow(/identity|appeared|directory/i);expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');await expect(lstat(join(source,'new-folder/file.txt'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses a replaced existing ancestor of a planned new directory',async()=>{
    await mkdir(join(source,'existing'));await broker.upload(workspaceId,'existing/new-folder/file.txt','new');const preview=await service.preview(actor,workspaceId);await rename(join(source,'existing'),join(source,'previous-existing'));await mkdir(join(source,'existing'));
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toThrow(/identity|changed/i);expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('retains directory receipts after mid-creation revocation and verifies complete original file state without replay',async()=>{
    await broker.upload(workspaceId,'nested/second/file.txt','new');const preview=await service.preview(actor,workspaceId),create=host.createPublicationDirectory.bind(host);let revoked=false;
    vi.spyOn(host,'createPublicationDirectory').mockImplementation(async(...args)=>{const value=await create(...args);if(!revoked){revoked=true;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");}return value;});
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    const current={...actor,user:{...actor.user,sessionVersion:1}};await store.db.query("UPDATE sessions SET version=1 WHERE id='fixture'");const receipt=await service.get(current,preview.id);expect(receipt.status).toBe('uncertain');expect(Object.keys(receipt.createdDirectoryIdentities??{})).toEqual(['nested']);expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
    expect((await service.reconcile(current,preview.id,confirm(preview.digest))).status).toBe('rolled_back');await expect(lstat(join(source,'nested/second/file.txt'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('bounds planned directory creation before any source mutation',async()=>{
    for(let index=0;index<9;index++)await broker.upload(workspaceId,`new-${index}/a/b/c/file.txt`,'new');
    await expect(service.preview(actor,workspaceId)).rejects.toThrow(/32.*director/i);await expect(lstat(join(source,'new-0'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('freezes review bytes, preserves unrelated edits/file identity, and supports approved rollback',async()=>{
    const preview=await service.preview(actor,workspaceId);expect(preview.entries).toHaveLength(2);
    const original=await lstat(join(source,'one.ts'));await writeFile(join(source,'unrelated.txt'),'Unrelated new owner work');
    await broker.changeFile(workspaceId,'one.ts','later unreviewed edit',sha256('export const one = 10;\n'));
    const saved=await service.apply(actor,preview.id,confirm(preview.digest));expect(saved.status).toBe('completed');
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 10;\n');expect((await lstat(join(source,'one.ts'))).ino).toBe(original.ino);
    expect(await readFile(join(source,'unrelated.txt'),'utf8')).toBe('Unrelated new owner work');
    expect((await service.apply(actor,preview.id,confirm(preview.digest))).status).toBe('completed');
    const rollback=await service.rollbackPreview(actor,preview.id);await service.apply(actor,rollback.id,confirm(rollback.digest));
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');expect((await service.get(actor,preview.id)).status).toBe('rolled_back');
  });
  it('rejects altered confirmation, remote authority, source changes and same-content path replacement before any write',async()=>{
    const preview=await service.preview(actor,workspaceId);
    await expect(service.apply(actor,preview.id,{digest:'0'.repeat(64),confirmed:true})).rejects.toThrow();
    await expect(service.apply({...actor,remote:true},preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'OWNER_ONLY'});
    await writeFile(join(source,'two.ts'),'Owner changed this file');
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toThrow(/conflict|changed/i);
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
    await writeFile(join(source,'two.ts'),'export const two = 2;\n');
    await rename(join(source,'one.ts'),join(source,'original-one.ts'));await writeFile(join(source,'one.ts'),'export const one = 1;\n');
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toThrow(/identity|changed/i);
  });
  it('leaves a durable uncertain receipt on revocation, never retries, and supports new-session reviewed recovery',async()=>{
    const preview=await service.preview(actor,workspaceId),execute=host.execute.bind(host);let revoked=false;
    vi.spyOn(host,'execute').mockImplementation(async(...args)=>{const result=await execute(...args);if(args[0]==='host_write'&&!revoked){revoked=true;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");}return result;});
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toThrow();
    const current={...actor,user:{...actor.user,sessionVersion:1}},restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await store.db.query("UPDATE sessions SET version=1 WHERE id='fixture'");
    expect((await restarted.get(current,preview.id)).status).toBe('uncertain');
    await expect(restarted.apply(current,preview.id,confirm(preview.digest))).rejects.toThrow(/replay|review|uncertain/i);
    expect(await readFile(join(source,'two.ts'),'utf8')).toBe('export const two = 2;\n');
    const rollback=await restarted.rollbackPreview(current,preview.id);await restarted.apply(current,rollback.id,confirm(rollback.digest));
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('does not restore over a later owner edit',async()=>{
    const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));await writeFile(join(source,'one.ts'),'Owner post-publication edit');
    await expect(service.rollbackPreview(actor,preview.id)).rejects.toThrow(/conflict|changed/i);
  });
  it('publishes frozen additions, deletions and a rename pair, preserving absent versus empty files through rollback',async()=>{
    await broker.changeFile(workspaceId,'new.ts','new file',null);
    await broker.changeFile(workspaceId,'empty.txt','',null);
    await broker.changeFile(workspaceId,'renamed.ts','export const two = 2;\n',null);
    await broker.changeFile(workspaceId,'two.ts',null,sha256('export const two = 20;\n'));
    const preview=await service.preview(actor,workspaceId);
    expect(preview.entries.find(entry=>entry.path==='empty.txt')).toMatchObject({before:null,after:'',beforeHash:null,identity:null});
    expect(preview.entries.find(entry=>entry.path==='two.ts')).toMatchObject({before:'export const two = 2;\n',after:null,afterHash:null});
    await broker.changeFile(workspaceId,'new.ts','unapproved change',sha256('new file'));
    await service.apply(actor,preview.id,confirm(preview.digest));
    expect(await readFile(join(source,'new.ts'),'utf8')).toBe('new file');
    expect(await readFile(join(source,'empty.txt'),'utf8')).toBe('');
    await expect(lstat(join(source,'two.ts'))).rejects.toMatchObject({code:'ENOENT'});
    expect(await readFile(join(source,'renamed.ts'),'utf8')).toBe('export const two = 2;\n');
    const rollback=await service.rollbackPreview(actor,preview.id);await service.apply(actor,rollback.id,confirm(rollback.digest));
    expect(await readFile(join(source,'two.ts'),'utf8')).toBe('export const two = 2;\n');
    for(const path of ['new.ts','empty.txt','renamed.ts'])await expect(lstat(join(source,path))).rejects.toMatchObject({code:'ENOENT'});
    expect((await service.get(actor,preview.id)).status).toBe('rolled_back');
  });
  it('preflights new-path collisions before any existing source file is modified',async()=>{
    await broker.changeFile(workspaceId,'z-new.ts','approved addition',null);
    const preview=await service.preview(actor,workspaceId);await writeFile(join(source,'z-new.ts'),'independent owner file');
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_CONFLICT'});
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
    expect(await readFile(join(source,'z-new.ts'),'utf8')).toBe('independent owner file');
  });
  it('binds the parent identity of an absent target and refuses a replacement directory',async()=>{
    await mkdir(join(source,'lib'));await broker.changeFile(workspaceId,'lib/new.ts','new file',null);
    const preview=await service.preview(actor,workspaceId);
    await rename(join(source,'lib'),join(source,'old-lib'));await mkdir(join(source,'lib'));
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    await expect(lstat(join(source,'lib/new.ts'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses rollback over a same-content replacement of a created file',async()=>{
    await broker.changeFile(workspaceId,'new.ts','created by Relay',null);
    const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));
    await rename(join(source,'new.ts'),join(source,'original-new.ts'));await writeFile(join(source,'new.ts'),'created by Relay');
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await expect(restarted.rollbackPreview(actor,preview.id)).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    expect(await readFile(join(source,'new.ts'),'utf8')).toBe('created by Relay');
  });
  it('recovers a recorded empty creation after cancellation without replaying or touching later entries',async()=>{
    await broker.changeFile(workspaceId,'a-empty.txt','',null);
    const preview=await service.preview(actor,workspaceId),execute=host.execute.bind(host),controller=new AbortController();
    vi.spyOn(host,'execute').mockImplementation(async(...args)=>{const result=await execute(...args);if(args[0]==='host_write')controller.abort();return result;});
    await expect(service.apply(actor,preview.id,confirm(preview.digest),controller.signal)).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect(await readFile(join(source,'a-empty.txt'),'utf8')).toBe('');
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await expect(restarted.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    const rollback=await restarted.rollbackPreview(actor,preview.id);expect(rollback.entries).toHaveLength(1);
    await restarted.apply(actor,rollback.id,confirm(rollback.digest));await expect(lstat(join(source,'a-empty.txt'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('keeps an unrecorded creation uncertain across restart even when approved bytes match',async()=>{
    await broker.changeFile(workspaceId,'new.ts','created file',null);
    const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));
    await writeFile(join(data,'publications',`${preview.id}.json`),JSON.stringify({...await service.get(actor,preview.id),status:'uncertain',createdIdentities:{}}));
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await expect(restarted.rollbackPreview(actor,preview.id)).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    await expect(restarted.reconcile(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    expect(await readFile(join(source,'new.ts'),'utf8')).toBe('created file');
  });
  it('uses presence-aware successful receipts for sequential additions and deletions',async()=>{
    await broker.changeFile(workspaceId,'new.ts','first',null);
    await broker.changeFile(workspaceId,'two.ts',null,sha256('export const two = 20;\n'));
    const first=await service.preview(actor,workspaceId);await service.apply(actor,first.id,confirm(first.digest));
    await broker.changeFile(workspaceId,'new.ts','second',sha256('first'));
    const second=await service.preview(actor,workspaceId);expect(second.entries).toHaveLength(1);expect(second.entries[0].before).toBe('first');
    await service.apply(actor,second.id,confirm(second.digest));
    await broker.changeFile(workspaceId,'new.ts',null,sha256('second'));
    const third=await service.preview(actor,workspaceId);expect(third.entries).toHaveLength(1);expect(third.entries[0].after).toBeNull();
    await service.apply(actor,third.id,confirm(third.digest));
    await expect(service.preview(actor,workspaceId)).rejects.toMatchObject({code:'PUBLICATION_EMPTY'});
  });
  it('reads and applies an unchanged version1 approval digest and creates a new reviewed rollback',async()=>{
    const preview=await service.preview(actor,workspaceId);
    const {createdIdentities:_,...legacy}=preview;legacy.version=1;
    legacy.entries=legacy.entries.map(({parentIdentity:__,...entry})=>entry);
    legacy.digest=sha256(JSON.stringify({version:legacy.version,id:legacy.id,workspaceId:legacy.workspaceId,userId:legacy.userId,sessionVersion:legacy.sessionVersion,stopGeneration:legacy.stopGeneration,sourcePath:legacy.sourcePath,sourceIdentity:legacy.sourceIdentity,direction:legacy.direction,parentId:legacy.parentId,expiresAt:legacy.expiresAt,entries:legacy.entries.map(({before:___,after:____,...entry})=>entry)}));
    await writeFile(join(data,'publications',`${legacy.id}.json`),JSON.stringify(legacy));
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    expect((await restarted.get(actor,legacy.id)).digest).toBe(legacy.digest);
    await restarted.apply(actor,legacy.id,confirm(legacy.digest));
    const rollback=await restarted.rollbackPreview(actor,legacy.id);expect(rollback.version).toBe(2);
    await restarted.apply(actor,rollback.id,confirm(rollback.digest));expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('recreates a deleted empty file only through a fresh rollback approval',async()=>{
    await writeFile(join(source,'empty.txt'),'');const workspace=await broker.createWorkspace('Empty deletion',source);await store.saveWorkspace(workspace);
    await broker.changeFile(workspace.id,'empty.txt',null,sha256(''));
    const preview=await service.preview(actor,workspace.id);expect(preview.entries[0]).toMatchObject({before:'',after:null});
    await service.apply(actor,preview.id,confirm(preview.digest));
    const rollback=await service.rollbackPreview(actor,preview.id);await expect(lstat(join(source,'empty.txt'))).rejects.toMatchObject({code:'ENOENT'});
    await service.apply(actor,rollback.id,confirm(rollback.digest));expect(await readFile(join(source,'empty.txt'),'utf8')).toBe('');
  });
  it('plans missing parents without creating them and refuses linked parents without touching the link target',async()=>{
    await broker.changeFile(workspaceId,'new-directory/new.ts','new file',null);
    expect((await service.preview(actor,workspaceId)).directories?.map(item=>item.path)).toEqual(['new-directory']);await expect(lstat(join(source,'new-directory'))).rejects.toMatchObject({code:'ENOENT'});
    const elsewhere=join(root,'elsewhere');await mkdir(elsewhere);
    await symlink(elsewhere,join(source,'new-directory'),process.platform==='win32'?'junction':'dir');
    await expect(service.preview(actor,workspaceId)).rejects.toThrow(/link|reparse/i);
    await expect(lstat(join(elsewhere,'new.ts'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses missing directory creation receipts after restart even when published bytes match',async()=>{
    await broker.upload(workspaceId,'new-folder/file.txt','new');const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));
    await writeFile(join(data,'publications',`${preview.id}.json`),JSON.stringify({...await service.get(actor,preview.id),status:'uncertain',createdDirectoryIdentities:{}}));
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await expect(restarted.reconcile(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    await expect(restarted.rollbackPreview(actor,preview.id)).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    expect(await readFile(join(source,'new-folder/file.txt'),'utf8')).toBe('new');
  });
  it('records directory creation before honoring cancellation and never replays it',async()=>{
    await broker.upload(workspaceId,'new-folder/file.txt','new');const preview=await service.preview(actor,workspaceId),create=host.createPublicationDirectory.bind(host),controller=new AbortController();
    vi.spyOn(host,'createPublicationDirectory').mockImplementation((path,parent,authorize,signal,onCreated)=>create(path,parent,authorize,signal,async identity=>{controller.abort();await onCreated(identity);}));
    await expect(service.apply(actor,preview.id,confirm(preview.digest),controller.signal)).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect(Object.keys((await service.get(actor,preview.id)).createdDirectoryIdentities??{})).toEqual(['new-folder']);
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect((await service.reconcile(actor,preview.id,confirm(preview.digest))).status).toBe('rolled_back');
    await expect(lstat(join(source,'new-folder/file.txt'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses a replaced created ancestor even when the immediate parent and file identities survive',async()=>{
    await broker.upload(workspaceId,'outer/inner/file.txt','new');const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));
    await rename(join(source,'outer'),join(source,'old-outer'));await mkdir(join(source,'outer'));await rename(join(source,'old-outer/inner'),join(source,'outer/inner'));
    await expect(service.rollbackPreview(actor,preview.id)).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    expect(await readFile(join(source,'outer/inner/file.txt'),'utf8')).toBe('new');
  });
  it('rechecks every created ancestor at the file mutation boundary',async()=>{
    await broker.upload(workspaceId,'a-outer/inner/file.txt','new');const preview=await service.preview(actor,workspaceId),execute=host.execute.bind(host);let changed=false;
    vi.spyOn(host,'execute').mockImplementation(async(...args)=>{if(!changed){changed=true;await rename(join(source,'a-outer'),join(source,'old-outer'));await mkdir(join(source,'a-outer'));await rename(join(source,'old-outer/inner'),join(source,'a-outer/inner'));}return execute(...args);});
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    await expect(lstat(join(source,'a-outer/inner/file.txt'))).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('keeps directory identities bound after preparing a rollback review',async()=>{
    await broker.upload(workspaceId,'outer/inner/file.txt','new');const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));
    const rollback=await service.rollbackPreview(actor,preview.id);
    await rename(join(source,'outer'),join(source,'old-outer'));await mkdir(join(source,'outer'));await rename(join(source,'old-outer/inner'),join(source,'outer/inner'));
    await expect(service.apply(actor,rollback.id,confirm(rollback.digest))).rejects.toMatchObject({code:'PUBLICATION_IDENTITY'});
    expect(await readFile(join(source,'outer/inner/file.txt'),'utf8')).toBe('new');expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 10;\n');
  });
  it.each(['session','stop'])('rechecks %s authority immediately before deleting the original file',async(reason)=>{
    await broker.changeFile(workspaceId,'one.ts',null,sha256('export const one = 10;\n'));
    const preview=await service.preview(actor,workspaceId),replace=toolFiles.replaceText;
    vi.spyOn(toolFiles,'replaceText').mockImplementation(async(...args)=>{
      if(args[2]===null){if(reason==='session')await store.db.query("DELETE FROM sessions WHERE id='fixture'");else await store.setStopped(true);}
      return replace(...args);
    });
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it.each(['session','stop'])('rechecks %s authority before exclusive creation, leaving no empty original file',async(reason)=>{
    await broker.changeFile(workspaceId,'a-new.ts','new content',null);const preview=await service.preview(actor,workspaceId);
    // Enter the real handle writer after mutate's earlier authorization. Revoke
    // before its final asynchronous path inspection and exclusive open.
    const writer=host as unknown as {writePreservingMetadata:(...args:unknown[])=>Promise<void>},write=writer.writePreservingMetadata.bind(host);
    vi.spyOn(writer,'writePreservingMetadata').mockImplementation(async(...args)=>{
      if(reason==='session')await store.db.query("DELETE FROM sessions WHERE id='fixture'");else await store.setStopped(true);
      return write(...args);
    });
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    await expect(lstat(join(source,'a-new.ts'))).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects a delayed preview after a newer rollback so receipt order remains the actual mutation order',async()=>{
    await broker.changeFile(workspaceId,'new.ts','new file',null);
    const first=await service.preview(actor,workspaceId),delayed=await service.preview(actor,workspaceId);
    await service.apply(actor,first.id,confirm(first.digest));const rollback=await service.rollbackPreview(actor,first.id);await service.apply(actor,rollback.id,confirm(rollback.digest));
    await expect(service.apply(actor,delayed.id,confirm(delayed.digest))).rejects.toMatchObject({code:'PUBLICATION_STALE'});
    const fresh=await service.preview(actor,workspaceId);await service.apply(actor,fresh.id,confirm(fresh.digest));
    expect(await readFile(join(source,'new.ts'),'utf8')).toBe('new file');
    await expect(service.preview(actor,workspaceId)).rejects.toMatchObject({code:'PUBLICATION_EMPTY'});
  });
  it('uses successful publication receipts as the next baseline without silently replacing the Git baseline',async()=>{
    const first=await service.preview(actor,workspaceId);await service.apply(actor,first.id,confirm(first.digest));
    await broker.changeFile(workspaceId,'one.ts','second reviewed change',sha256('export const one = 10;\n'));
    const second=await service.preview(actor,workspaceId);expect(second.entries).toHaveLength(1);expect(second.entries[0].before).toBe('export const one = 10;\n');
    await service.apply(actor,second.id,confirm(second.digest));expect(await readFile(join(source,'one.ts'),'utf8')).toBe('second reviewed change');
  });
  it('checks durable revocation between write chunks and does not overwrite an uncertain partial file',async()=>{
    const before='A'.repeat(180000),after='B'.repeat(180000);await writeFile(join(source,'one.ts'),before);
    const workspace=await broker.createWorkspace('Large fixture',source);await store.saveWorkspace(workspace);await broker.changeFile(workspace.id,'one.ts',after,sha256(before));
    const preview=await service.preview(actor,workspace.id),execute=host.execute.bind(host);let revoked=false;
    vi.spyOn(host,'execute').mockImplementation(async(...args)=>{
      const authorize=args[5];if(args[0]==='host_write')args[5]=async()=>{if(!revoked&&(await readFile(join(source,'one.ts'),'utf8')).startsWith('B')){revoked=true;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");}await authorize?.();};
      return execute(...args);
    });
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});expect(revoked).toBe(true);
    const actual=await readFile(join(source,'one.ts'),'utf8');expect(actual).not.toBe(before);expect(actual).not.toBe(after);
    const current={...actor,user:{...actor.user,sessionVersion:1}};
    await store.db.query("UPDATE sessions SET version=1 WHERE id='fixture'");
    await expect(service.rollbackPreview(current,preview.id)).rejects.toMatchObject({code:'PUBLICATION_CONFLICT'});
    await expect(service.reconcile(current,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_CONFLICT'});
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe(actual);
  });
  it('blocks a crashed applying journal across service restart and verifies an unchanged receipt without replay',async()=>{
    const preview=await service.preview(actor,workspaceId),path=join(data,'publications',`${preview.id}.json`);
    await writeFile(path,JSON.stringify({...preview,status:'applying'}));
    const restarted=new PublicationService(store,data,async(_id,operation)=>operation(),{host});
    await expect(restarted.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect((await restarted.reconcile(actor,preview.id,confirm(preview.digest))).status).toBe('rolled_back');
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
    expect((await restarted.preview(actor,workspaceId)).status).toBe('preview');
  });
  it('rejects expired approval and stop generations; protected original paths remain protected',async()=>{
    let now=Date.now();const timed=new PublicationService(store,data,async(_id,operation)=>operation(),{host,now:()=>now});
    const preview=await timed.preview(actor,workspaceId);now+=600001;
    await expect(timed.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_EXPIRED'});
    const fresh=await service.preview(actor,workspaceId);await store.setStopped(true);await store.setStopped(false);
    await expect(service.apply(actor,fresh.id,confirm(fresh.digest))).rejects.toMatchObject({code:'PUBLICATION_REVOKED'});
    const protectedService=new PublicationService(store,data,async(_id,operation)=>operation());
    await expect(protectedService.preview(actor,workspaceId)).rejects.toThrow(/Protected Relay/);
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('requires the exact unexpired local browser session, including queued operations',async()=>{
    const preview=await service.preview(actor,workspaceId);
    await store.db.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id='fixture'");
    await expect(service.apply(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'PUBLICATION_AUTH'});
    await store.db.query("UPDATE sessions SET expires_at=now()+interval '1 day' WHERE id='fixture'");
    let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const queued=new PublicationService(store,data,async(_id,operation)=>{entered();await gate;return operation();},{host});
    const first=queued.preview(actor,workspaceId);const firstRejected=expect(first).rejects.toMatchObject({code:'PUBLICATION_AUTH'});await started;
    const second=queued.apply(actor,preview.id,confirm(preview.digest));const secondRejected=expect(second).rejects.toMatchObject({code:'PUBLICATION_AUTH'});
    await store.db.query("DELETE FROM sessions WHERE id='fixture'");release();await Promise.all([firstRejected,secondRejected]);
    expect(await readFile(join(source,'one.ts'),'utf8')).toBe('export const one = 1;\n');
  });
  it('keeps a receipt uncertain after client cancellation and reserves reconciliation',async()=>{
    const controller=new AbortController(),preview=await service.preview(actor,workspaceId),execute=host.execute.bind(host);
    vi.spyOn(host,'execute').mockImplementation(async(...args)=>{const result=await execute(...args);if(args[0]==='host_write')controller.abort('client_disconnected');return result;});
    await expect(service.apply(actor,preview.id,confirm(preview.digest),controller.signal)).rejects.toMatchObject({code:'PUBLICATION_UNCERTAIN'});
    expect((await service.get(actor,preview.id)).status).toBe('uncertain');
    const held=new PublicationService(store,data,async()=>{throw Object.assign(new Error('Host busy'),{code:'HOST_BUSY'});},{host});
    await expect(held.reconcile(actor,preview.id,confirm(preview.digest))).rejects.toMatchObject({code:'HOST_BUSY'});
    expect(await readFile(join(source,'two.ts'),'utf8')).toBe('export const two = 2;\n');
  });
  it('preserves a UTF-8 BOM in exact publication and rollback hashes',async()=>{
    const before='\uFEFFexport const bom = 1;\n',after='\uFEFFexport const bom = 2;\n';await writeFile(join(source,'one.ts'),before);
    const workspace=await broker.createWorkspace('BOM fixture',source);await store.saveWorkspace(workspace);await broker.changeFile(workspace.id,'one.ts',after,sha256(before));
    const preview=await service.preview(actor,workspace.id);await service.apply(actor,preview.id,confirm(preview.digest));expect(await readFile(join(source,'one.ts'),'utf8')).toBe(after);
    const rollback=await service.rollbackPreview(actor,preview.id);await service.apply(actor,rollback.id,confirm(rollback.digest));expect(await readFile(join(source,'one.ts'),'utf8')).toBe(before);
  });
});
