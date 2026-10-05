import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine } from '../server/orchestration/engine.js';
import { chatPermissions } from '../server/auth/policy.js';
import type { TaskOptions } from '../shared/types.js';

let store:Store,engine:Engine;
const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
beforeEach(async()=>{
  store=new Store(await openDatabase());await store.init();
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','chat',JSON.stringify(chatPermissions)]);
  engine=new Engine(store,{listModels:async()=>[],statuses:async()=>[],stream:async function*(){}},{definitions:()=>[],decide:()=>({decision:'deny',reason:'No tools',risk:'read'}),execute:async()=>{throw new Error('Not executed');},stopAll:async()=>{},changes:async()=>[]});
  vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
});
afterEach(async()=>{await engine.shutdown();await store.close();vi.restoreAllMocks();});
async function paused(conversationId?:string) {
  const id=conversationId??(await store.createConversation('Paused','friend')).id;
  const {task}=await store.createTask(id,'Continue when ready',options,'friend');await store.transition(task.id,'paused');return task;
}

describe('atomic task admission and resume',()=>{
  it('reserves a user task slot before returning from concurrent resumes',async()=>{
    const first=await paused();const second=await paused();
    const results=await Promise.allSettled([engine.resume(first.id),engine.resume(second.id)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await store.db.query("SELECT id FROM tasks WHERE user_id='friend' AND status<>'paused'"))).toHaveLength(1);
  });
  it('admits only one concurrent resume for the same task',async()=>{
    const task=await paused();const results=await Promise.allSettled([engine.resume(task.id),engine.resume(task.id)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(engine.enqueue).toHaveBeenCalledTimes(1);
  });
  it('does not resume into a conversation that already has active work',async()=>{
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,maxConcurrentTasks:2}),'friend']);
    const conversation=await store.createConversation('Shared conversation','friend');const old=await paused(conversation.id);
    await store.createTask(conversation.id,'New objective',options,'friend');
    await expect(engine.resume(old.id)).rejects.toThrow(/conversation/i);
  });
  it('rechecks current workspace grants inside resume admission',async()=>{
    const workspaceId='11111111-1111-4111-8111-111111111111';
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,workspaceIds:[workspaceId],maxAccess:'workspace'}),'friend']);
    const conversation=await store.createConversation('Old grant','friend');const {task}=await store.createTask(conversation.id,'Modify workspace',{...options,workspaceId,access:'workspace'},'friend');await store.transition(task.id,'paused');
    await store.db.query('UPDATE users SET permissions=$1,session_version=session_version+1 WHERE id=$2',[JSON.stringify(chatPermissions),'friend']);
    await expect(engine.resume(task.id)).rejects.toThrow(/exceeds|granted/i);expect(engine.enqueue).not.toHaveBeenCalled();
  });
  it('rejects a revoked request version during creation and resume',async()=>{
    const task=await paused();const conversation=await store.createConversation('New request','friend');
    await store.db.query("UPDATE users SET session_version=1 WHERE id='friend'");
    await expect(store.createTask(conversation.id,'Stale request',options,'friend',0)).rejects.toThrow(/revoked/i);
    await expect(engine.resume(task.id,0)).rejects.toThrow(/revoked/i);
  });
  it('enforces current permissions in the creation transaction',async()=>{
    const conversation=await store.createConversation('Untrusted options','friend');
    await expect(store.createTask(conversation.id,'Unauthorized write',{...options,access:'workspace'},'friend')).rejects.toThrow(/exceeds/i);
  });
});
