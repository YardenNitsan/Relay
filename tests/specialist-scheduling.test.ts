import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine} from '../server/orchestration/engine.js';
import {LocalLease} from '../server/orchestration/lease.js';
import {assessModel} from '../server/hardware/index.js';
import {watchLocalMemory} from '../server/hardware/watchdog.js';
import {assistantIds,getAssistantDefinition} from '../shared/assistants.js';
import type {HardwareSnapshot,ModelChunk,ModelProfile,ModelRequest,TaskOptions} from '../shared/types.js';
const GiB=1024**3;
const options:TaskOptions={depth:'fast',access:'read_only',modelId:null,workspaceId:null,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
const host=():HardwareSnapshot=>({sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'Test',physicalCores:8,logicalCores:16,utilization:10},memory:{totalBytes:32*GiB,availableBytes:24*GiB,swapTotalBytes:32*GiB,swapUsedBytes:0},gpus:[{vendor:'NVIDIA',name:'Test',totalBytes:12*GiB,usedBytes:GiB,utilization:0,temperature:40,driver:'fixture'}],storage:null,warnings:[]});
const model=(id:string,sizeBytes:number):ModelProfile=>({id,name:id,provider:'ollama',runtime:'ollama',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:'Q4',sizeBytes,state:'ready',details:{modelInfo:{'general.architecture':'llama','llama.block_count':32,'llama.attention.head_count_kv':8,'llama.attention.head_count':32,'llama.embedding_length':4096}},tokensPerSecond:20,inputPricePerMillion:null,outputPricePerMillion:null});
const small=model('ollama/safe',4*GiB),large=model('ollama/oversized',40*GiB);
let store:Store,engine:Engine|undefined;const releases:(()=>void)[]=[];
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();});
afterEach(async()=>{for(const release of releases.splice(0))release();await engine?.shutdown();engine=undefined;await store.close();});
const tools={definitions:()=>[],decide:()=>({decision:'deny' as const,risk:'read' as const,reason:'No tools'}),execute:async()=>{throw new Error('No tool execution');},changes:async()=>[],stopAll:async()=>{}};
async function create(overrides:Partial<TaskOptions>={}){const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Explain the supplied information',{...options,...overrides});engine!.enqueue(task.id);return task;}
async function settled(id:string){await expect.poll(async()=>['completed','paused','failed'].includes((await store.task(id)).status),{timeout:6000}).toBe(true);return store.task(id);}
describe('specialists share safe automatic routing',()=>{
 it.each(assistantIds)('routes %s through actual hardware admission and preserves specialist identity',async assistantId=>{
  const requests:ModelRequest[]=[];
  engine=new Engine(store,{listModels:async()=>[large,small],statuses:async()=>[],stream:async function*(request){requests.push(request);yield {type:'text',text:'A grounded response.'};yield {type:'done',finishReason:'stop'};}},tools,{admit:async(model,context)=>assessModel(model,host(),context)});
  const task=await create({assistantId});expect((await settled(task.id)).status).toBe('completed');expect(requests).toHaveLength(1);expect(requests[0].model.id).toBe(small.id);expect(requests[0].messages[0].content).toContain(`Selected specialist: ${getAssistantDefinition(assistantId)!.name}`);
 });
 it('refuses even an explicitly required oversized model without issuing any generation request',async()=>{
  let calls=0;engine=new Engine(store,{listModels:async()=>[large,small],statuses:async()=>[],stream:async function*(){calls++;yield {type:'done',finishReason:'stop'};}},tools,{admit:async(model,context)=>assessModel(model,host(),context)});
  const task=await create({assistantId:'coding',modelId:large.id,modelSelection:'required'});expect((await settled(task.id)).status).toBe('paused');expect(calls).toBe(0);expect(await store.db.query('SELECT id FROM model_calls')).toEqual([]);
 });
 it('rechecks fresh pressure after waiting behind another local-model request',async()=>{
  const lease=new LocalLease(),release=await lease.acquire(new AbortController().signal);releases.push(release);let pressure=false,calls=0;
  engine=new Engine(store,{listModels:async()=>[small],statuses:async()=>[],stream:async function*(){calls++;yield {type:'done',finishReason:'stop'};}},tools,{lease,admit:async(model,context)=>{const hardware=host();if(pressure)hardware.memory.availableBytes=GiB;return assessModel(model,hardware,context);}});
  const task=await create({assistantId:'computer'});await expect.poll(async()=>(await store.taskEvents(task.id)).some(event=>event.type==='MODEL_QUEUED')).toBe(true);expect(calls).toBe(0);pressure=true;release();expect((await settled(task.id)).status).toBe('paused');expect(calls).toBe(0);
 });
 it('stops active specialist generation under unsafe live pressure without rerouting or losing time accounting',async()=>{
  let calls=0;
  engine=new Engine(store,{listModels:async()=>[small,{...small,id:'ollama/alternative'}],statuses:async()=>[],stream:async function*(request):AsyncGenerator<ModelChunk>{calls++;yield {type:'text',text:'Working'};await new Promise<void>((_,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});}},tools,{admit:async(model,context)=>assessModel(model,host(),context),watchMemory:(signal,execution)=>watchLocalMemory(signal,async()=>{const hardware=host();hardware.memory.availableBytes=GiB;return {hardware,policy:{profile:'safe'}};},execution,{intervalMs:10,timeoutMs:100})});
  const task=await create({assistantId:'coding'});const result=await settled(task.id);expect(result.status).toBe('paused');expect(result.error).toMatch(/RAM|responsiveness/);expect(calls).toBe(1);expect((await store.db.query('SELECT execution_used_ms FROM tasks WHERE id=$1',[task.id]))[0].execution_used_ms).toBeGreaterThan(0);expect((await store.taskEvents(task.id)).some(event=>event.type==='MODEL_REROUTED')).toBe(false);
 });
});
