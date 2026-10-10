import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm,rename,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openDatabase} from '../server/db/database';
import {Store,row} from '../server/db/store';
import type {Principal,User} from '../server/auth/policy';
import {ToolBroker} from '../server/tools';
import {HostFileBroker} from '../server/tools/host-files';
import {PublicationService} from '../server/tools/publication';
import {sha256} from '../server/tools/files';

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
  it('does not restore over a later owner edit and refuses unsupported additions/deletions',async()=>{
    const preview=await service.preview(actor,workspaceId);await service.apply(actor,preview.id,confirm(preview.digest));await writeFile(join(source,'one.ts'),'Owner post-publication edit');
    await expect(service.rollbackPreview(actor,preview.id)).rejects.toThrow(/conflict|changed/i);
    await broker.changeFile(workspaceId,'new.ts','new file',null);
    await expect(service.preview(actor,workspaceId)).rejects.toThrow(/existing|addition|deletion/i);
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
