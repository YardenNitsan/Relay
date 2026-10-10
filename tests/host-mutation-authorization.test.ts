import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {Store} from '../server/db/store';
import {openDatabase} from '../server/db/database';
import {ToolBroker} from '../server/tools';
import {HostFileBroker} from '../server/tools/host-files';
import {UncertainToolEffect} from '../server/tools/errors';
import * as files from '../server/tools/files';
import type {TaskOptions,ToolContext} from '../shared/types';

const parent=resolve('..');
let root:string,data:string,target:string,store:Store,broker:ToolBroker,scope:ToolContext;
beforeEach(async()=>{
  // Keep the real installation/data-path protections active. Only these owned
  // disposable sibling files are host mutation targets.
  root=await mkdtemp(join(parent,'relay-host-revocation-'));data=join(root,'data');target=join(root,'source','file.txt');
  await mkdir(dirname(target));await mkdir(data);
  store=new Store(await openDatabase());await store.init();broker=new ToolBroker(data,()=>false,undefined,store);
  const options:TaskOptions={depth:'fast',modelId:null,workspaceId:null,access:'unrestricted',hostAccessConfirmed:true,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:4,maxCostUsd:0,localOnly:true}};
  const conversation=await store.createConversation(),{task}=await store.createTask(conversation.id,'Explicit host file acceptance',options);
  await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);
  scope={taskId:task.id,agentId:'authorized-worker',userId:'owner',sessionVersion:0,workspaceId:null,access:'unrestricted',hostAccess:true,allowedTools:['host_write','host_delete'],signal:new AbortController().signal,approved:true};
});
afterEach(async()=>{
  vi.restoreAllMocks();await broker.stopAll();await store.close();
  if(dirname(root)!==parent||!basename(root).startsWith('relay-host-revocation-'))throw new Error('Unexpected host fixture boundary');
  await rm(root,{recursive:true,force:true});
});
async function revoke(kind:string){
  if(kind==='disabled')await store.db.query("UPDATE users SET enabled=false WHERE id='owner'");
  else if(kind==='session')await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");
  else if(kind==='grant')await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{hostAccessConfirmed}','false') WHERE id=$1",[scope.taskId]);
  else if(kind==='deadline')await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{budget,maxElapsedSeconds}','30'),created_at=now()-interval '31 seconds' WHERE id=$1",[scope.taskId]);
  else throw new Error('Unknown revocation fixture');
}
describe('durable authority inside ordinary agent host mutations',()=>{
  it.each(['disabled','session','grant','deadline'])('refuses exclusive creation after %s changes during host preparation',async kind=>{
    const writer=HostFileBroker.prototype as unknown as {writePreservingMetadata:(...args:unknown[])=>Promise<void>},write=writer.writePreservingMetadata;
    vi.spyOn(writer,'writePreservingMetadata').mockImplementation(async function(this:HostFileBroker,...args){await revoke(kind);return write.apply(this,args);});
    await expect(broker.execute(scope,{id:'create',name:'host_write',arguments:{path:target,content:'approved contents',expectedHash:null}})).rejects.toBeInstanceOf(UncertainToolEffect);
    await expect(lstat(target)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('refuses deletion when the account is disabled after the first durable check',async()=>{
    await writeFile(target,'original');const replace=files.replaceText;
    vi.spyOn(files,'replaceText').mockImplementation(async(...args)=>{if(args[2]===null)await revoke('disabled');return replace(...args);});
    await expect(broker.execute(scope,{id:'delete',name:'host_delete',arguments:{path:target,expectedHash:files.sha256('original')}})).rejects.toBeInstanceOf(UncertainToolEffect);
    expect(await readFile(target,'utf8')).toBe('original');
  });
  it('stops between chunks after session revocation and retains the prepared recovery checkpoint',async()=>{
    const before='A'.repeat(180000),after='B'.repeat(180000);await writeFile(target,before);
    const execute=HostFileBroker.prototype.execute;let revoked=false;
    vi.spyOn(HostFileBroker.prototype,'execute').mockImplementation(async function(this:HostFileBroker,...args){
      const authorize=args[5];args[5]=async()=>{if(!revoked&&(await readFile(target,'utf8')).startsWith('B')){revoked=true;await revoke('session');}await authorize?.();};
      return execute.apply(this,args);
    });
    await expect(broker.execute(scope,{id:'write',name:'host_write',arguments:{path:target,content:after,expectedHash:files.sha256(before)}})).rejects.toBeInstanceOf(UncertainToolEffect);
    expect(revoked).toBe(true);const actual=await readFile(target,'utf8');expect(actual).not.toBe(before);expect(actual).not.toBe(after);
    const names=await readdir(join(data,'host-checkpoints'));expect(names).toHaveLength(1);
    expect(JSON.parse(await readFile(join(data,'host-checkpoints',names[0]),'utf8'))).toMatchObject({state:'prepared',before,beforeHash:files.sha256(before)});
  });
});
