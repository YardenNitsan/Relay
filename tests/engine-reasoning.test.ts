import {enrichPricing} from '../server/providers/pricing.js';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine} from '../server/orchestration/engine.js';
import type {ModelProfile,ModelRequest,TaskOptions} from '../shared/types.js';

const model:ModelProfile={id:'deepseek/fixture',name:'Fixture',provider:'deepseek',runtime:'fixture',local:false,capabilities:{tools:true,vision:false,reasoning:true,structured:true},contextWindow:32000,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:.3,outputPricePerMillion:1.2,reasoning:{levels:['none','low','high'],source:'Test contract',mode:'deepseek'}};
const options:TaskOptions={depth:'fast',modelId:model.id,modelSelection:'required',access:'read_only',workspaceId:null,assistantId:'personal',cloudPolicy:'allow',contextTokens:8192,budget:{maxCalls:4,maxSeconds:30,maxIterations:2,maxOutputTokens:2048,maxCostUsd:1,localOnly:false}};
let store:Store,engine:Engine;
afterEach(async()=>{vi.restoreAllMocks();await engine?.shutdown();await store?.close();});
async function run(reasoning:TaskOptions['reasoning'],history:boolean,expiry=false){
  const profile=expiry?enrichPricing({...model,id:'deepseek/deepseek-flash',inputPricePerMillion:null,outputPricePerMillion:null},Date.parse('2026-10-10T12:00:00Z')):model;
  store=new Store(await openDatabase());await store.init();
  const calls:ModelRequest[]=[];
  engine=new Engine(store,{listModels:async()=>{if(expiry)vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-10T12:00:00Z'));return [profile];},statuses:async()=>[],stream:async function*(request){calls.push(request);yield {type:'text',text:'Fixture result'};yield {type:'usage',inputTokens:10,outputTokens:10};yield {type:'done',finishReason:'stop'};}},{definitions:()=>[{name:'personal_tasks',description:'Tasks',parameters:{type:'object'}}],decide:()=>({decision:'deny',reason:'Fixture',risk:'read'}),execute:async()=>{throw new Error('No execution expected');},changes:async()=>[],stopAll:async()=>{}},{admit:async()=>({allowed:true,decision:'run',reasons:[],contextTokens:8192,estimatedRamBytes:0,estimatedVramBytes:0,confidence:'estimated'})});
  const conversation=await store.createConversation();
  if(history)await store.db.query('INSERT INTO messages(id,conversation_id,role,content) VALUES ($1,$2,$3,$4)',[randomUUID(),conversation.id,'assistant','Previous ordinary answer']);
  const {task}=await store.createTask(conversation.id,'Debug my task algorithm',{...options,modelId:profile.id,reasoning});engine.enqueue(task.id);
  const end=performance.now()+6000;
  while(performance.now()<end){const current=await store.task(task.id);if(['completed','paused','failed'].includes(current.status))return {task:current,calls,events:await store.taskEvents(task.id)};await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Fixture did not settle');
}
describe('reasoning through durable execution',()=>{
  it('rechecks a pricing snapshot before dispatch after its evidence expires',async()=>{
    const result=await run('none',false,true);
    expect(result.task.status).toBe('paused');expect(result.calls).toHaveLength(0);expect(result.task.callsUsed).toBe(0);
    expect(await store.db.query('SELECT id FROM model_calls WHERE task_id=$1',[result.task.id])).toHaveLength(0);
  });
  it('passes manual effort and unchanged ceilings to the provider and records them',async()=>{
    const result=await run('high',false);
    expect(result.task.status).toBe('completed');expect(result.calls).toHaveLength(1);
    expect(result.calls[0]).toMatchObject({reasoning:'high',maxOutputTokens:2048});
    expect(result.events.find(event=>event.type==='CALL_BUDGET')?.data).toMatchObject({reasoning:'high',requestedReasoning:'high',maxOutputTokens:2048});
  });
  it('rejects unsupported continuation before counting calls, reserving cost or rerouting',async()=>{
    const result=await run('high',true);
    expect(result.task.status).toBe('paused');expect(result.calls).toHaveLength(0);expect(result.task.callsUsed).toBe(0);
    expect(await store.db.query('SELECT id FROM model_calls WHERE task_id=$1',[result.task.id])).toHaveLength(0);
    expect(result.events.some(event=>event.type==='MODEL_REROUTED')).toBe(false);
  });
  it('Auto explicitly disables thinking for incompatible history before a single call',async()=>{
    const result=await run('auto',true);
    expect(result.task.status).toBe('completed');expect(result.calls).toHaveLength(1);expect(result.calls[0].reasoning).toBe('none');
    expect(result.events.find(event=>event.type==='REASONING_ADJUSTED')?.data.reasoning).toBe('none');
    expect(result.events.find(event=>event.type==='CALL_BUDGET')?.data.reasoning).toBe('none');
  });
});
