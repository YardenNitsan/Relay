import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { chatPermissions } from '../server/auth/policy.js';
import type { TaskOptions, TaskStep } from '../shared/types.js';

let store:Store;
afterEach(async()=>store?.close());
const options:TaskOptions={depth:'fast',modelId:'openai/test',access:'read_only',workspaceId:null,contextTokens:4096,cloudPolicy:'allow',budget:{maxCalls:8,maxSeconds:60,maxIterations:3,maxCostUsd:1,localOnly:false}};
const reservation={cloud:true,amountUsd:0.6,provider:'openai' as const,sessionVersion:0};
async function init() {store=new Store(await openDatabase());await store.init();}
async function taskFor(userId='owner') {
  const conversation=await store.createConversation('Priced call',userId);const {task}=await store.createTask(conversation.id,'Answer',options,userId);
  await store.transition(task.id,'analyzing');await store.transition(task.id,'planning');await store.transition(task.id,'executing');
  const step:TaskStep={id:randomUUID(),taskId:task.id,role:'worker',title:'Answer',dependencies:[],status:'pending',modelId:null,output:null};
  await store.saveGraph([step]);const agentId=await store.startAgent(step,'openai/test');return {task,agentId};
}
describe('atomic cloud budget reservations',()=>{
  it('requires an explicit personal billing grant for unpriced remote calls and preserves strict caps',async()=>{
    await init();await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','trusted',JSON.stringify({...chatPermissions,providers:['openai'],dailyCloudBudgetUsd:1})]);
    const {task,agentId}=await taskFor('friend');
    const uncapped={...task.options,budget:{...task.options.budget,maxCostUsd:null}};
    await store.db.query('UPDATE tasks SET options=$1 WHERE id=$2',[JSON.stringify(uncapped),task.id]);
    await expect(store.startCall(task.id,agentId,'openai/test',[],{...reservation,amountUsd:null})).rejects.toThrow(/pricing/i);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,providers:['openai'],allowUnpricedCloud:true}),'friend']);
    const call=await store.startCall(task.id,agentId,'openai/test',[],{...reservation,amountUsd:null});
    expect((await store.db.query('SELECT cost_usd,cost_state FROM model_calls WHERE id=$1',[call]))[0]).toEqual({cost_usd:null,cost_state:'unpriced'});
    await store.db.query('UPDATE tasks SET options=$1 WHERE id=$2',[JSON.stringify(task.options),task.id]);
    // Full current policy is rechecked before reservation; zero daily spending
    // denies a strict cap even earlier than unknown-price admission.
    await expect(store.startCall(task.id,agentId,'openai/test',[],{...reservation,amountUsd:null})).rejects.toThrow(/pricing|spending/i);
  });
  it('admits only one of two concurrent calls when the task can afford one',async()=>{
    await init();const {task,agentId}=await taskFor();
    const results=await Promise.allSettled([store.startCall(task.id,agentId,'openai/test',[],reservation),store.startCall(task.id,agentId,'openai/test',[],reservation)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await store.task(task.id)).callsUsed).toBe(1);expect(await store.cost(task.id)).toBeCloseTo(0.6);
    const call=(await store.db.query('SELECT status,finished_at FROM model_calls WHERE task_id=$1',[task.id]))[0];expect(call.status).toBe('running');expect(call.finished_at).toBeNull();
  });
  it('reserves against the same user budget across different tasks',async()=>{
    await init();await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','trusted',JSON.stringify({...chatPermissions,providers:['openai'],maxConcurrentTasks:2,dailyCloudBudgetUsd:1})]);
    const first=await taskFor('friend');const second=await taskFor('friend');
    const results=await Promise.allSettled([store.startCall(first.task.id,first.agentId,'openai/test',[],reservation),store.startCall(second.task.id,second.agentId,'openai/test',[],reservation)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect((await store.cost(first.task.id))+(await store.cost(second.task.id))).toBeCloseTo(0.6);
  });
  it('retains an uncertain reservation after a failed stream instead of making it free',async()=>{
    await init();const {task,agentId}=await taskFor();const call=await store.startCall(task.id,agentId,'openai/test',[],reservation);
    await store.finishCall(call,null,null,null,'Provider disconnected after partial output');
    expect(await store.cost(task.id)).toBeCloseTo(0.6);
    await expect(store.startCall(task.id,agentId,'openai/test',[],reservation)).rejects.toThrow(/budget/i);
    expect((await store.db.query('SELECT cost_state FROM model_calls WHERE id=$1',[call]))[0].cost_state).toBe('uncertain');
  });
  it('releases unused reservation only when successful usage settles the charge',async()=>{
    await init();const {task,agentId}=await taskFor();const call=await store.startCall(task.id,agentId,'openai/test',[],reservation);
    await store.finishCall(call,100,100,0.2);await store.startCall(task.id,agentId,'openai/test',[],reservation);
    expect(await store.cost(task.id)).toBeCloseTo(0.8);
  });
  it('retains outstanding cloud reservations through crash recovery',async()=>{
    await init();const {task,agentId}=await taskFor();const call=await store.startCall(task.id,agentId,'openai/test',[],reservation);await store.recover();
    expect(await store.cost(task.id)).toBeCloseTo(0.6);
    const saved=(await store.db.query('SELECT status,cost_state FROM model_calls WHERE id=$1',[call]))[0];expect(saved.status).toBe('interrupted');expect(saved.cost_state).toBe('uncertain');
  });
  it('retains the reservation when a completed response has no usage information',async()=>{
    await init();const {task,agentId}=await taskFor();const call=await store.startCall(task.id,agentId,'openai/test',[],reservation);
    await store.finishCall(call,null,null,null);
    expect(await store.cost(task.id)).toBeCloseTo(0.6);
    expect((await store.db.query('SELECT cost_state FROM model_calls WHERE id=$1',[call]))[0].cost_state).toBe('uncertain');
  });
  it('checks current revocation inside the reservation transaction',async()=>{
    await init();const {task,agentId}=await taskFor();await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");
    await expect(store.startCall(task.id,agentId,'openai/test',[],reservation)).rejects.toThrow(/revoked/i);
    expect((await store.task(task.id)).callsUsed).toBe(0);
  });
  it('fails closed on unknown pricing for a strict task budget',async()=>{
    await init();const {task,agentId}=await taskFor();
    await expect(store.startCall(task.id,agentId,'openai/test',[],{...reservation,amountUsd:null})).rejects.toThrow(/pricing/i);
    expect(await store.cost(task.id)).toBe(0);
  });
  it('does not age unresolved reservations out of a user spending limit',async()=>{
    await init();await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)',['friend','Friend','trusted',JSON.stringify({...chatPermissions,providers:['openai'],maxConcurrentTasks:2,dailyCloudBudgetUsd:1})]);
    const first=await taskFor('friend');const second=await taskFor('friend');
    const call=await store.startCall(first.task.id,first.agentId,'openai/test',[],reservation);
    await store.finishCall(call,null,null,null,'Disconnected');
    await store.db.query("UPDATE model_calls SET started_at=now()-interval '2 days' WHERE id=$1",[call]);
    await expect(store.startCall(second.task.id,second.agentId,'openai/test',[],reservation)).rejects.toThrow(/budget/i);
  });
});
