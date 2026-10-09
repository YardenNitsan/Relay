import {afterEach,describe,it,expect} from 'vitest';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Engine} from '../server/orchestration/engine.js';
import {callBudget,efficientTools} from '../server/orchestration/token-policy.js';
import {buildReviewContext,fitContext} from '../server/orchestration/context.js';
import type {ModelProfile,ModelRequest,TaskOptions,ModelChunk,ToolDefinition} from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:null,sizeBytes:1,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'fast',access:'read_only',modelId:null,workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:16000,budget:{maxCalls:8,maxSeconds:60,maxIterations:4,maxCostUsd:null,localOnly:true}};
const definitions:ToolDefinition[]=['file_read','file_list','file_write','file_delete','terminal'].map(name=>({name,description:name,parameters:{type:'object',properties:{}}}));
let store:Store|undefined,engine:Engine|undefined;
afterEach(async()=>{await engine?.shutdown();await store?.close();engine=undefined;store=undefined;});
async function run(input:TaskOptions,stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,selected=model){
 store=new Store(await openDatabase());await store.init();let executed=0;
 engine=new Engine(store,{listModels:async()=>[selected,{...selected,id:'ollama/alternate'}],statuses:async()=>[],stream},{definitions:()=>definitions,decide:()=>({decision:'allow',risk:'read',reason:'fixture'}),execute:async()=>{executed++;return {content:'read receipt',evidence:[]};},stopAll:async()=>{},changes:async()=>[]},{admit:async()=>({allowed:true,decision:'run',reasons:['test'],estimatedRamBytes:1,estimatedVramBytes:0,contextTokens:16000,confidence:'estimated'})});
 const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Explain the supplied files completely',input);engine.enqueue(task.id);
 await expect.poll(async()=>['completed','paused','waiting_for_user','failed'].includes((await store!.task(task.id)).status),{timeout:6000}).toBe(true);
 return {task:await store.task(task.id),events:await store.taskEvents(task.id),conversation:await store.conversation(conversation.id),executed};
}
describe('bounded token efficiency',()=>{
 it('clamps one output allowance against requested, context and known model limits',()=>{
  expect(callBudget(options,model).maxOutputTokens).toBe(2048);
  expect(callBudget({...options,budget:{...options.budget,maxOutputTokens:8192}},model).maxOutputTokens).toBe(5333);
  expect(callBudget(options,{...model,details:{maxOutputTokens:700}}).maxOutputTokens).toBe(700);
  for(const value of [0,255,8193,1.5,Infinity])expect(()=>callBudget({...options,budget:{...options.budget,maxOutputTokens:value}},model)).toThrow();
 });
 it('prunes only forbidden read-only schemas without changing standard mode',()=>{
  expect(efficientTools(options,definitions).map(tool=>tool.name)).toEqual(['file_read','file_list']);
  expect(efficientTools({...options,efficiency:'standard'},definitions)).toEqual(definitions);
  expect(efficientTools({...options,access:'workspace'},definitions)).toEqual(definitions);
 });
 it.each(['efficient','standard'] as const)('runs %s with truthful sizing events and unchanged worker allowance',async efficiency=>{
  const requests:ModelRequest[]=[];
  const result=await run({...options,efficiency},async function*(request){requests.push(request);yield {type:'text',text:'A complete answer.'};yield {type:'done',finishReason:'stop'};});
  expect(result.task.status).toBe('completed');expect(requests).toHaveLength(1);expect(requests[0].maxOutputTokens).toBe(2048);
  expect(requests[0].tools.map(tool=>tool.name)).toEqual(efficiency==='efficient'?['file_read','file_list']:definitions.map(tool=>tool.name));
  expect(requests[0].messages[0].content.includes('Token efficiency:')).toBe(efficiency==='efficient');
  expect(result.events.find(event=>event.type==='CALL_BUDGET')?.data).toMatchObject({efficiency,maxOutputTokens:2048,inputSizingMethod:'conservative_utf8_bytes',removedToolCount:efficiency==='efficient'?3:0});
 });
 it('retains the complete required review inputs instead of hiding evidence to fit',()=>{
  const candidate='candidate '.repeat(40),objective='Review required proof';
  const context=buildReviewContext(objective,candidate,[],16000);
  expect(fitContext(context,[],16000,2048).messages).toEqual(context);
  expect(()=>fitContext(context,[],600,256)).toThrow(/context/i);
 });
 it('uses the same advertised ceiling in the request and conservative cloud reservation',async()=>{
  const cloud={...model,id:'openai/test',provider:'openai' as const,local:false,details:{maxOutputTokens:1024},inputPricePerMillion:1,outputPricePerMillion:2};
  const result=await run({...options,cloudPolicy:'allow',budget:{...options.budget,localOnly:false,maxCostUsd:1,maxOutputTokens:4096}},async function*(request){
    expect(request.maxOutputTokens).toBe(1024);yield {type:'text',text:'Complete.'};yield {type:'usage',inputTokens:30,outputTokens:60};yield {type:'done',finishReason:'stop'};
  },cloud);
  expect(result.task.status).toBe('completed');
  const saved=(await store!.db.query('SELECT reserved_cost_usd,cost_usd FROM model_calls'))[0];
  expect(saved.reserved_cost_usd).toBeCloseTo((16000+1024*2)/1e6);
  expect(saved.cost_usd).toBeCloseTo((30+60*2)/1e6);
 });
 it.each(['length','max_tokens','max_output_tokens'])('pauses %s once without running partial proposals or accepting an answer',async finishReason=>{
  let calls=0;const result=await run(options,async function*(){calls++;yield {type:'text',text:'Partial answer'};yield {type:'tool_call',call:{id:'partial',name:'file_read',arguments:{path:'x'}}};yield {type:'usage',inputTokens:30,outputTokens:2048};yield {type:'done',finishReason};});
  expect(result.task.status).toBe('paused');expect(result.task.error).toMatch(/output|ceiling/i);expect(calls).toBe(1);expect(result.executed).toBe(0);
  expect(result.conversation.messages.filter(message=>message.role==='assistant')).toEqual([]);
  expect((await store!.db.query('SELECT input_tokens,output_tokens,status FROM model_calls'))[0]).toMatchObject({input_tokens:30,output_tokens:2048,status:'failed'});
 });
});
