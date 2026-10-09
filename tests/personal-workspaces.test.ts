import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {ToolBroker} from '../server/tools/index.js';
import {chatPermissions} from '../server/auth/policy.js';
import type {TaskOptions,ToolContext,Workspace} from '../shared/types.js';

let store:Store,broker:ToolBroker,dir:string,own:Workspace,other:Workspace;
const options:TaskOptions={depth:'fast',modelId:null,workspaceId:null,access:'workspace',contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
beforeEach(async()=>{
 dir=await mkdtemp(join(tmpdir(),'relay-private-workspaces-'));store=new Store(await openDatabase());await store.init();
 for(const id of ['alice','bob'])await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',[id,'chat',JSON.stringify(chatPermissions)]);
 broker=new ToolBroker(dir,()=>false,undefined,store);
 own=await broker.createWorkspace('Alice',undefined,'alice');other=await broker.createWorkspace('Bob',undefined,'bob');
 await store.saveWorkspace(own);await store.saveWorkspace(other);
});
afterEach(async()=>{await broker.stopAll();await store.close();await rm(dir,{recursive:true,force:true});});
async function admitted(access:TaskOptions['access']='workspace'){
 const conversation=await store.createConversation('My files','alice');
 return (await store.createTask(conversation.id,'Edit my own file',{...options,workspaceId:own.id,access},'alice',0)).task;
}
describe('trusted private workspace authority',()=>{
 it.each(['read_only','supervised','workspace'] as const)('admits %s in own workspace and preserves the original account ceiling elsewhere',async access=>{
  expect((await admitted(access)).options.access).toBe(access);
  const conversation=await store.createConversation('Untrusted request','alice');
  await expect(store.createTask(conversation.id,'host access',{...options,workspaceId:own.id,access:'unrestricted',hostAccessConfirmed:true},'alice',0)).rejects.toThrow(/local owner/i);
  await expect(store.createTask(conversation.id,'outside',{...options,workspaceId:null},'alice',0)).rejects.toThrow(/exceeds/i);
  await expect(store.createTask(conversation.id,'quota',{...options,workspaceId:own.id,budget:{...options.budget,maxCalls:64}},'alice',0)).rejects.toThrow(/budget/i);
 });
 it('rejects another private workspace even when a forged grant lists it',async()=>{
  await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,workspaceIds:[other.id],maxAccess:'workspace'}),'alice']);
  const conversation=await store.createConversation('Forbidden','alice');
  await expect(store.createTask(conversation.id,'read bob',{...options,workspaceId:other.id},'alice',0)).rejects.toThrow(/another account/i);
 });
 it('executes real private file tools but rejects forged task scope and revoked sessions',async()=>{
  const task=await admitted();await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1",[task.id]);
  const scope:ToolContext={userId:'alice',sessionVersion:0,taskId:task.id,agentId:randomUUID(),workspaceId:own.id,access:'workspace',allowedTools:['file_write'],signal:new AbortController().signal,approved:false};
  const request={id:randomUUID(),name:'file_write',arguments:{path:'notes.txt',content:'private',expectedHash:null}};
  await broker.execute(scope,request);expect((await broker.readFile(own.id,'notes.txt')).content).toBe('private');
  await expect(broker.execute({...scope,workspaceId:other.id},request)).rejects.toThrow(/scope/i);
  await store.db.query("UPDATE users SET session_version=1 WHERE id='alice'");
  await expect(broker.execute(scope,{...request,arguments:{...request.arguments,path:'late.txt'}})).rejects.toThrow(/revoked/i);
  expect(await broker.listFiles(own.id)).toEqual(['notes.txt']);
 });
 it('rechecks current ownership during resume and before reserving a model call',async()=>{
  const task=await admitted();await store.db.query("UPDATE tasks SET status='paused' WHERE id=$1",[task.id]);
  await store.db.query('UPDATE workspaces SET owner_user_id=$1 WHERE id=$2',['bob',own.id]);
  await expect(store.resumeTask(task.id,0)).rejects.toThrow(/exceeds|another account/i);
  await expect(store.startCall(task.id,'unused-agent','ollama/test',[],{cloud:false,amountUsd:0,provider:'ollama',sessionVersion:0})).rejects.toThrow(/exceeds|another account/i);
  expect(await store.db.query('SELECT id FROM model_calls')).toEqual([]);
 });
 it('does not change durable ownership when resaving workspace metadata',async()=>{
  await store.saveWorkspace({...own,ownerUserId:'bob'});
  expect((await store.db.query('SELECT owner_user_id FROM workspaces WHERE id=$1',[own.id]))[0].owner_user_id).toBe('alice');
 });
});
