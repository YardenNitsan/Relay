import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine, type ExecutionTools } from '../server/orchestration/engine.js';
import type { Admission, ModelChunk, ModelProfile, ModelRequest, ProviderGateway, TaskOptions, ToolDecision, ToolRequest, ToolResult } from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:8192,budget:{maxCalls:8,maxSeconds:60,maxIterations:5,maxCostUsd:null,localOnly:true}};
const admitted:Admission={allowed:true,decision:'run',reasons:['Test admission'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated'};
let store:Store; let engine:Engine;
afterEach(async()=>{vi.restoreAllMocks();await engine?.shutdown();await store?.close();});
async function waitFor(test:()=>Promise<boolean>) { const until=Date.now()+5000; while(Date.now()<until) {if(await test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Condition not reached'); }
async function setup(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,execute:(request:ToolRequest)=>Promise<ToolResult>,decision:ToolDecision={decision:'allow',reason:'Granted',risk:'write'},admit=async()=>admitted) {
  store=new Store(await openDatabase());await store.init();
  const gateway:ProviderGateway={listModels:async()=>[model],statuses:async()=>[],stream};
  const tools:ExecutionTools={definitions:()=>['file_write','terminal'].map(name=>({name,description:name,parameters:{type:'object'}})),decide:()=>decision,execute:async(_context,request)=>execute(request),stopAll:async()=>{},changes:async()=>[]};
  engine=new Engine(store,gateway,tools,{admit});
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Make and verify the requested change',options);engine.enqueue(task.id);
  return {task,gateway,tools};
}
const write=(id:string):ToolRequest=>({id,name:'file_write',arguments:{path:'result.txt',content:'created',expectedHash:null}});
const verified:ToolResult={content:'Written and read back',evidence:[{kind:'file_content',summary:'Content matches',passed:true}]};

describe('durable continuations and verification outcomes',()=>{
  it('preserves a completed tool receipt and provider continuation across a paused retry',async()=>{
    let calls=0;let executions=0;let receiptPreserved=false;let continuationPreserved=false;
    const {task}=await setup(async function*(request) {
      calls++;
      if(calls===2)throw new Error('Provider connection failed after the tool succeeded');
      const receipt=request.messages.some(message=>message.role==='tool');
      if(calls>=3){receiptPreserved=receipt;continuationPreserved=request.messages.some(message=>message.providerData?.data==='opaque-continuation');}
      if(receipt)yield {type:'text',text:'The change is verified.'};
      else {yield {type:'continuation',providerData:{provider:'ollama',data:'opaque-continuation'}};yield {type:'tool_call',call:write(`write-${calls}`)};}
      yield {type:'done',finishReason:'stop'};
    },async()=>{executions++;return verified;});
    await waitFor(async()=>(await store.task(task.id)).status==='paused');
    await engine.resume(task.id);
    await waitFor(async()=>(await store.task(task.id)).status==='completed');
    expect(executions).toBe(1);expect(receiptPreserved).toBe(true);expect(continuationPreserved).toBe(true);
  });
  it('does not complete a file objective when its only requested write failed',async()=>{
    const {task}=await setup(async function*(request){if(request.messages.some(m=>m.role==='tool'))yield {type:'text',text:'Done, I created the file.'};else yield {type:'tool_call',call:write('write-fails')};yield {type:'done',finishReason:'stop'};},async()=>{throw new Error('Write failed');});
    await waitFor(async()=>['completed','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('waiting_for_user');
    expect((await store.verification(task.id)).some(check=>!check.passed)).toBe(true);
  });
  it('does not treat a denied action as a completed objective',async()=>{
    let executions=0;
    const {task}=await setup(async function*(request){if(request.messages.some(m=>m.role==='tool'))yield {type:'text',text:'Done.'};else yield {type:'tool_call',call:write('write-denied')};yield {type:'done',finishReason:'stop'};},async()=>{executions++;return verified;},{decision:'deny',reason:'No write grant',risk:'write'});
    await waitFor(async()=>['completed','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('waiting_for_user');expect(executions).toBe(0);
  });
  it('resolves a failed command check after the same command passes without deleting its history',async()=>{
    let calls=0;let executions=0;
    const {task}=await setup(async function*(){calls++;if(calls<=2)yield {type:'tool_call',call:{id:`test-${calls}`,name:'terminal',arguments:{argv:['npm','test']}}};else yield {type:'text',text:'The corrected tests pass.'};yield {type:'done',finishReason:'stop'};},async()=>{executions++;return {content:`Exit ${executions===1?1:0}`,evidence:[{kind:'command_exit',summary:'npm test',passed:executions>1}]};});
    await waitFor(async()=>['completed','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');
    const history=await store.verification(task.id);expect(history.some(check=>!check.passed)).toBe(true);expect(history.some(check=>check.passed)).toBe(true);
  });
  it('does not let an unrelated passing command hide a failed check',async()=>{
    let calls=0;let executions=0;
    const {task}=await setup(async function*(){calls++;if(calls<=2)yield {type:'tool_call',call:{id:`test-${calls}`,name:'terminal',arguments:{argv:['npm',calls===1?'test':'--version']}}};else yield {type:'text',text:'Done.'};yield {type:'done',finishReason:'stop'};},async()=>{executions++;return {content:'Command result',evidence:[{kind:'command_exit',summary:'Command completed',passed:executions>1}]};});
    await waitFor(async()=>['completed','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('waiting_for_user');
  });
  it('pauses recoverable work on graceful shutdown and resumes after restart',async()=>{
    let entered=false;let interrupted=true;
    const {task,gateway,tools}=await setup(async function*(request){entered=true;if(interrupted){await new Promise<void>(resolve=>request.signal.addEventListener('abort',()=>resolve(),{once:true}));request.signal.throwIfAborted();}yield {type:'text',text:'Recovered answer.'};yield {type:'done',finishReason:'stop'};},async()=>verified);
    await waitFor(async()=>entered);await engine.shutdown();
    expect((await store.task(task.id)).status).toBe('paused');
    interrupted=false;engine=new Engine(store,gateway,tools,{admit:async()=>admitted});await engine.initialize();await engine.resume(task.id);
    await waitFor(async()=>(await store.task(task.id)).status==='completed');
  });
  it('passes fresh CPU-fallback admission constraints to the provider',async()=>{
    let seen:unknown;let admissions=0;
    const {task}=await setup(async function*(request){seen=request.execution;yield {type:'text',text:'CPU execution complete.'};yield {type:'done',finishReason:'stop'};},async()=>verified,{decision:'allow',reason:'Granted',risk:'read'},async()=>({...admitted,...(++admissions>1?{execution:{numGpu:0}}:{})}));
    await waitFor(async()=>(await store.task(task.id)).status==='completed');expect(seen).toEqual({numGpu:0});
  });
  it('retains the first receipt when interrupted between two tool proposals and never replays it',async()=>{
    let calls=0;let interrupted=false;const executed:string[]=[];
    const second:ToolRequest={...write('second'),arguments:{path:'second.txt',content:'second',expectedHash:null}};
    const {task}=await setup(async function*(request){
      calls++;
      if(calls===1){yield {type:'tool_call',call:write('first')};yield {type:'tool_call',call:second};}
      else if(calls===2){expect(request.messages.some(message=>message.toolCallId==='first'&&message.content==='Written and read back')).toBe(true);expect(request.messages.some(message=>message.toolCallId==='second'&&message.content.includes('interrupted'))).toBe(true);yield {type:'tool_call',call:{...second,id:'second-retry'}};}
      else yield {type:'text',text:'Both changes verified.'};
      yield {type:'done',finishReason:'stop'};
    },async request=>{executed.push(String(request.arguments.path));return verified;});
    const append=store.append.bind(store);vi.spyOn(store,'append').mockImplementation(async(taskId,type,data)=>{
      const event=await append(taskId,type,data);if(type==='TOOL_COMPLETED'&&!interrupted){interrupted=true;throw new Error('Interruption after receipt committed');}return event;
    });
    await waitFor(async()=>(await store.task(task.id)).status==='paused');await engine.resume(task.id);
    await waitFor(async()=>(await store.task(task.id)).status==='completed');expect(executed).toEqual(['result.txt','second.txt']);
  });
  it('blocks replay when a side effect succeeded but its receipt could not be committed',async()=>{
    let executions=0;
    const {task}=await setup(async function*(){yield {type:'tool_call',call:write('uncertain')};yield {type:'done',finishReason:'stop'};},async()=>{executions++;return verified;});
    vi.spyOn(store,'finishTool').mockRejectedValueOnce(new Error('Storage interrupted after execution'));
    await waitFor(async()=>(await store.task(task.id)).status==='paused');
    await expect(engine.resume(task.id)).rejects.toThrow(/uncertain outcome/i);expect(executions).toBe(1);
    expect((await store.db.query('SELECT status FROM tool_calls WHERE task_id=$1',[task.id]))[0].status).toBe('uncertain');
  });
  it('rechecks a revoked user grant before executing a model tool proposal',async()=>{
    let executions=0;
    const {task}=await setup(async function*(){yield {type:'tool_call',call:write('revoked')};await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");yield {type:'done',finishReason:'stop'};},async()=>{executions++;return verified;});
    await waitFor(async()=>['paused','completed'].includes((await store.task(task.id)).status));
    expect(executions).toBe(0);expect((await store.task(task.id)).status).toBe('paused');
  });
});
