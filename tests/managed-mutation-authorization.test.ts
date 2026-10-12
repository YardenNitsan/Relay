import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../server/db/store';
import {openDatabase} from '../server/db/database';
import {ToolBroker} from '../server/tools';
import {ToolStore} from '../server/tools/store';
import {DockerSandbox} from '../server/tools/sandbox';
import {UncertainToolEffect} from '../server/tools/errors';
import * as files from '../server/tools/files';
import type {TaskOptions,ToolContext,Workspace} from '../shared/types';

let directory:string,store:Store,broker:ToolBroker,workspace:Workspace,scope:ToolContext;
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-managed-authorization-'));store=new Store(await openDatabase());await store.init();broker=new ToolBroker(directory,()=>false,undefined,store);
  workspace=await broker.createWorkspace('Managed authorization');await store.saveWorkspace(workspace);await broker.upload(workspace.id,'source.txt','original');
  const options:TaskOptions={depth:'fast',modelId:null,workspaceId:workspace.id,access:'workspace',contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:4,maxCostUsd:0,localOnly:true}};
  const conversation=await store.createConversation(),{task}=await store.createTask(conversation.id,'Managed file authority',options);await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);
  scope={taskId:task.id,agentId:'authorized-worker',userId:'owner',sessionVersion:0,workspaceId:workspace.id,access:'workspace',allowedTools:['file_write','file_delete'],signal:new AbortController().signal,approved:true};
});
afterEach(async()=>{vi.restoreAllMocks();await broker.stopAll();await store.close();await rm(directory,{recursive:true,force:true});});
async function revoke(kind:string){
  if(kind==='disabled')await store.db.query("UPDATE users SET enabled=false WHERE id='owner'");
  else if(kind==='session')await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");
  else await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{budget,maxElapsedSeconds}','30'),created_at=now()-interval '31 seconds' WHERE id=$1",[scope.taskId]);
}

describe('managed mutation authorization after asynchronous preparation',()=>{
  for(const name of ['file_write','file_delete'] as const)it.each(['disabled','session','deadline'])(`${name} refuses a %s change after initial dispatch`,async kind=>{
    const replace=files.replaceText;vi.spyOn(files,'replaceText').mockImplementation(async(...args)=>{await revoke(kind);return replace(...args);});
    await expect(broker.execute(scope,{id:'mutation',name,arguments:{path:'source.txt',expectedHash:files.sha256('original'),...(name==='file_write'?{content:'changed'}:{})}})).rejects.toBeInstanceOf(UncertainToolEffect);
    expect((await broker.readFile(workspace.id,'source.txt')).content).toBe('original');
    expect(await broker.changes(scope.taskId)).toEqual([]);
  });
  it('checks the manual editor authority again at the filesystem mutation',async()=>{
    let permitted=true;const authorize=async()=>{if(!permitted)throw new Error('Manual session revoked');};
    const replace=files.replaceText;vi.spyOn(files,'replaceText').mockImplementation(async(...args)=>{permitted=false;return replace(...args);});
    await expect(broker.changeFile(workspace.id,'source.txt','new editor text',files.sha256('original'),authorize)).rejects.toBeInstanceOf(UncertainToolEffect);
    expect((await broker.readFile(workspace.id,'source.txt')).content).toBe('original');
  });
  it('does not publish a prepared temporary file when final authority is denied',async()=>{
    const root=await new ToolStore(directory).workspaceRoot(workspace.id);let prepared=false;
    await expect(files.replaceText(root,'source.txt','replacement',files.sha256('original'),()=>{},async()=>{prepared=(await readdir(root)).some(name=>name.startsWith('.relay-')&&name.endsWith('.tmp'));throw new Error('Final authorization denied');})).rejects.toThrow('Final authorization denied');
    expect(prepared).toBe(true);expect((await broker.readFile(workspace.id,'source.txt')).content).toBe('original');expect((await readdir(root)).filter(name=>name.startsWith('.relay-'))).toEqual([]);
  });
  it('checks rollback authority again before changing the checkpoint files',async()=>{
    await broker.execute(scope,{id:'write',name:'file_write',arguments:{path:'source.txt',content:'completed change',expectedHash:files.sha256('original')}});
    const [change]=await broker.changes(scope.taskId);let permitted=true;const authorize=async()=>{if(!permitted)throw new Error('Rollback session revoked');};
    const replace=files.replaceText;vi.spyOn(files,'replaceText').mockImplementation(async(...args)=>{permitted=false;return replace(...args);});
    await expect(broker.revert(scope.taskId,change.checkpointId,authorize)).rejects.toThrow('Rollback session revoked');expect((await broker.readFile(workspace.id,'source.txt')).content).toBe('completed change');
  });
  it('retains authorized writes and deletions with verified content receipts',async()=>{
    const write=await broker.execute(scope,{id:'write',name:'file_write',arguments:{path:'source.txt',content:'new content',expectedHash:files.sha256('original')}});expect(JSON.parse(write.content).sha256).toBe(files.sha256('new content'));
    const deleted=await broker.execute(scope,{id:'delete',name:'file_delete',arguments:{path:'source.txt',expectedHash:files.sha256('new content')}});expect(JSON.parse(deleted.content).sha256).toBeNull();expect(await broker.listFiles(workspace.id)).not.toContain('source.txt');
  });
  it('does not import sandbox changes after the account is revoked during execution',async()=>{
    vi.spyOn(DockerSandbox.prototype,'status').mockResolvedValue({available:true,reason:'Explicit unit fixture; no command execution claimed'});
    vi.spyOn(DockerSandbox.prototype,'run').mockImplementation(async()=>{await revoke('session');return {files:new Map([['source.txt','sandbox replacement']]),stdout:'Fixture output',stderr:'',exitCode:0,truncated:false,durationMs:1,imageId:`sha256:${'a'.repeat(64)}`,toolchain:{profile:'node',version:'fixture'}};});
    await expect(broker.execute({...scope,allowedTools:['terminal']},{id:'terminal',name:'terminal',arguments:{argv:['node','--version']}})).rejects.toBeInstanceOf(UncertainToolEffect);
    expect((await broker.readFile(workspace.id,'source.txt')).content).toBe('original');
  });
});
