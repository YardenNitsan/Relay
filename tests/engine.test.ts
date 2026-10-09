import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { Engine } from '../server/orchestration/engine.js';
import type { ModelChunk, ModelProfile, ModelRequest, ProviderGateway, TaskOptions, ToolContext, ToolRequest } from '../shared/types.js';

const model:ModelProfile={id:'ollama:test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'fast',modelId:null,access:'supervised',workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}};
const allowed={allowed:true,decision:'run' as const,reasons:['Test admission'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated' as const};
let store:Store; let engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
async function waitFor(test:()=>Promise<boolean>) { const until=Date.now()+6000; while(Date.now()<until) {if(await test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Condition not reached'); }
async function setup(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,overrides:Partial<TaskOptions>={},objective='Create a greeting file') {
  store=new Store(await openDatabase());await store.init();
  const gateway:ProviderGateway={listModels:async()=>[model],statuses:async()=>[],stream};
  const executed:string[]=[];
  const broker={definitions:()=>[{name:'file_write',description:'Write',parameters:{type:'object',properties:{}}}],decide:(c:ToolContext)=>({decision:c.approved?'allow' as const:'approval' as const,reason:'Writing changes the workspace',risk:'write' as const}),execute:async(_c:ToolContext,r:ToolRequest)=>{executed.push(r.name);return {content:'File written',evidence:[{kind:'file_hash',summary:'Read-back hash matches',passed:true}]};},stopAll:async()=>{},changes:async()=>[]};
  engine=new Engine(store,gateway,broker,{admit:async()=>allowed});
  const conversation=await store.createConversation();
  const {task}=await store.createTask(conversation.id,objective,{...options,...overrides});engine.enqueue(task.id);
  return {task,conversation,executed};
}
describe('integrated execution',()=>{
  it('finishes an ordinary Balanced greeting with one natural answer even when a reviewer would reject it',async()=>{
    const roles:string[]=[];const answer='Hello! I am ready to help. How are you today?';
    const {task,conversation,executed}=await setup(async function*(request){
      const reviewer=request.messages[0].content.includes("Relay's reviewer");roles.push(reviewer?'reviewer':'worker');
      expect(request.tools).toEqual([]);
      yield {type:'text',text:reviewer?'A greeting needs another check. REVIEW: REVISE':answer};yield {type:'done',finishReason:'stop'};
    },{depth:'balanced',access:'read_only',workspaceId:null},'hello how are you today?');
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    const completed=await store.task(task.id);expect(completed.status).toBe('completed');expect(completed.result).toBe(answer);expect(completed.options.depth).toBe('balanced');expect(completed.callsUsed).toBe(1);
    expect(roles).toEqual(['worker']);expect(executed).toEqual([]);expect((await store.steps(task.id)).map(step=>step.role)).toEqual(['worker']);
    expect((await store.conversation(conversation.id)).messages.filter(message=>message.role==='assistant').map(message=>message.content)).toEqual([answer]);
    expect((await store.taskEvents(task.id)).find(event=>event.type==='TASK_ANALYZED')?.data).toMatchObject({depth:'balanced',strategy:'Single worker'});
    expect((await store.verification(task.id)).some(check=>check.kind==='model_review')).toBe(false);
  });
  it('retains the reviewer for a Balanced task with an authorized workspace',async()=>{
    const roles:string[]=[];
    const {task}=await setup(async function*(request){
      const reviewer=request.messages[0].content.includes("Relay's reviewer");roles.push(reviewer?'reviewer':'worker');
      yield {type:'text',text:reviewer?'The answer matches the available evidence. REVIEW: PASS':'The requested workspace explanation.'};yield {type:'done',finishReason:'stop'};
    },{depth:'balanced'});
    await waitFor(async()=>['completed','waiting_for_user','paused'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');expect(roles).toEqual(['worker','reviewer']);
    expect((await store.taskEvents(task.id)).find(event=>event.type==='TASK_ANALYZED')?.data).toMatchObject({depth:'balanced',strategy:'Worker and reviewer'});
    expect((await store.verification(task.id)).some(check=>check.kind==='model_review'&&check.passed)).toBe(true);
  });
  it('holds a mutating tool until an exact approval and persists verified completion',async()=>{
    const {task,conversation,executed}=await setup(async function*(request) {
      if(request.messages.some(m=>m.role==='tool')) yield {type:'text',text:'Created the greeting and checked its content.'};
      else yield {type:'tool_call',call:{id:'proposal',name:'file_write',arguments:{path:'greeting.txt',content:'Hello',expectedHash:null}}};
      yield {type:'done',finishReason:'stop'};
    });
    await waitFor(async()=> (await store.approvals(task.id)).length===1);
    expect(executed).toEqual([]);
    const approval=(await store.approvals(task.id))[0];
    await store.decideApproval(approval.id,'allow_once');engine.approvalChanged(approval.id);
    await waitFor(async()=> (await store.task(task.id)).status==='completed');
    expect(executed).toEqual(['file_write']);
    expect((await store.conversation(conversation.id)).messages.at(-1)?.role).toBe('assistant');
    expect((await store.verification(task.id)).some(v=>v.kind==='file_hash'&&v.passed)).toBe(true);
  });
  it('stop invalidates pending approval and prevents any subsequent tool action',async()=>{
    const {task,executed}=await setup(async function*(){yield {type:'tool_call',call:{id:'p',name:'file_write',arguments:{path:'a',content:'x',expectedHash:null}}};yield {type:'done',finishReason:'stop'};});
    await waitFor(async()=> (await store.approvals(task.id)).length===1);
    const approval=(await store.approvals(task.id))[0];
    await engine.stopAll();
    await expect(store.decideApproval(approval.id,'allow_once')).rejects.toThrow();
    expect(executed).toEqual([]);
    expect((await store.task(task.id)).status).toBe('cancelled');
  });
});
