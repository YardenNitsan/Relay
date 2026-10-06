import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine, type ExecutionTools } from '../server/orchestration/engine.js';
import { verificationContractSchema } from '../server/orchestration/required-reads.js';
import type { ModelChunk, ModelProfile, ModelRequest, TaskOptions, ToolRequest } from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const sha256='a'.repeat(64);const options={depth:'fast',modelId:null,access:'workspace',workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:16384,budget:{maxCalls:8,maxSeconds:60,maxIterations:6,maxCostUsd:null,localOnly:true},verification:{requiredReads:[{path:'result.txt',expectedSha256:sha256}]}} satisfies TaskOptions&{verification:unknown};
const admission={allowed:true,decision:'run' as const,reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:16384,confidence:'estimated' as const};
let store:Store;let engine:Engine;let opened=false;
afterEach(async()=>{if(opened){await engine.shutdown();await store.close();opened=false;}});
const done:ModelChunk={type:'done',finishReason:'stop'};
const write:ToolRequest={id:'write',name:'file_write',arguments:{path:'result.txt',content:'Expected file contents',expectedHash:null}};
const read=(id='read',path='result.txt'):ToolRequest=>({id,name:'file_read',arguments:{path}});
async function until(test:()=>Promise<boolean>){const end=Date.now()+6000;while(Date.now()<end){if(await test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Task did not settle');}
async function setup(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,readHash:string|(()=>string)=sha256,readCapability=true) {
  store=new Store(await openDatabase());await store.init();opened=true;let writes=0;
  const tools:ExecutionTools={definitions:()=>['file_write',...(readCapability?['file_read']:[]),'terminal'].map(name=>({name,description:name,parameters:{type:'object'}})),decide:()=>({decision:'allow',reason:'Workspace grant',risk:'write'}),execute:async(_context,request)=>{if(request.name==='file_write')writes++;return {content:JSON.stringify({path:request.arguments.path,sha256:request.name==='file_read'?(typeof readHash==='function'?readHash():readHash):sha256,content:'Expected file contents'}),evidence:[{kind:request.name==='file_read'?'file_read':'file_content',summary:'Actual tool result',passed:true}]};},stopAll:async()=>{},changes:async()=>[]};
  const gateway={listModels:async()=>[model],statuses:async()=>[],stream};engine=new Engine(store,gateway,tools,{admit:async()=>admission});
  const {task}=await store.createTask((await store.createConversation()).id,'Create the file and read it back',options);engine.enqueue(task.id);
  return {task,tools,gateway,writes:()=>writes};
}

describe('trusted required-read verification',()=>{
  it('does not accept an unsupported read claim and requires a real later read before completion',async()=>{
    let calls=0;let feedbackSeen=false;
    const {task,writes}=await setup(async function*(request){calls++;if(calls===1)yield {type:'tool_call',call:write};else if(calls===3){feedbackSeen=request.messages.some(message=>message.content.includes('Required verification is incomplete'));yield {type:'tool_call',call:read()};}else yield {type:'text',text:'I used file_read and verified the exact hash.'};yield done;});
    await until(async()=>['completed','paused','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('completed');expect(calls).toBe(4);expect(feedbackSeen).toBe(true);expect(writes()).toBe(1);
    expect((await store.taskEvents(task.id)).some(event=>event.type==='TOOL_COMPLETED'&&event.data.tool==='file_read')).toBe(true);
    expect((await store.unresolvedChecks(task.id))).toHaveLength(0);
  });
  it.each(['wrong path','wrong hash'])('does not settle the contract with a %s receipt',async mistake=>{
    let calls=0;
    const {task}=await setup(async function*(){calls++;if(calls===1)yield {type:'tool_call',call:write};else if(calls===2)yield {type:'tool_call',call:read('read',mistake==='wrong path'?'other.txt':'result.txt')};else yield {type:'text',text:'Everything was verified.'};yield done;},mistake==='wrong hash'?'b'.repeat(64):sha256);
    await until(async()=>['completed','paused','waiting_for_user'].includes((await store.task(task.id)).status));
    expect((await store.task(task.id)).status).toBe('paused');expect(calls).toBeLessThanOrEqual(options.budget.maxIterations);
    expect((await store.unresolvedChecks(task.id)).some(check=>check.kind==='required_file_read')).toBe(true);
  });
  it('rejects a matching read that happened before the final write',async()=>{
    let calls=0;
    const {task}=await setup(async function*(){calls++;if(calls===1)yield {type:'tool_call',call:read()};else if(calls===2)yield {type:'tool_call',call:write};else yield {type:'text',text:'Verified before writing.'};yield done;});
    await until(async()=>['completed','paused','waiting_for_user'].includes((await store.task(task.id)).status));expect((await store.task(task.id)).status).toBe('paused');
  });
  it('preserves the unmet contract and completed write across host recovery',async()=>{
    let calls=0;
    const {task,gateway,tools,writes}=await setup(async function*(){calls++;if(calls===1)yield {type:'tool_call',call:write};else if(calls===3)throw new Error('Connection interrupted before verification');else if(calls===4)yield {type:'tool_call',call:read()};else yield {type:'text',text:'Verified.'};yield done;});
    await until(async()=>['completed','paused'].includes((await store.task(task.id)).status));expect((await store.task(task.id)).status).toBe('paused');
    await engine.shutdown();engine=new Engine(store,gateway,tools,{admit:async()=>admission});await engine.initialize();await engine.resume(task.id);
    await until(async()=>['completed','paused'].includes((await store.task(task.id)).status));expect((await store.task(task.id)).status).toBe('completed');expect(writes()).toBe(1);
  });
  it('invalidates a matching read after a terminal mutation',async()=>{
    let calls=0;
    const {task}=await setup(async function*(){calls++;if(calls===1)yield {type:'tool_call',call:read()};else if(calls===2)yield {type:'tool_call',call:{id:'command',name:'terminal',arguments:{argv:['node','modify.js']}}};else yield {type:'text',text:'Earlier read verified the file.'};yield done;});
    await until(async()=>['completed','paused','waiting_for_user'].includes((await store.task(task.id)).status));expect((await store.task(task.id)).status).toBe('paused');
  });
  it('does not reuse an older matching read when the latest read observes a different hash',async()=>{
    let calls=0;let reads=0;
    const {task}=await setup(async function*(){calls++;if(calls<=2)yield {type:'tool_call',call:read(`read-${calls}`)};else yield {type:'text',text:'An earlier read matched.'};yield done;},()=>++reads===1?sha256:'b'.repeat(64));
    await until(async()=>['completed','paused'].includes((await store.task(task.id)).status));expect((await store.task(task.id)).status).toBe('paused');
  });
  it('the persistence completion boundary independently refuses missing required evidence',async()=>{
    const {task}=await setup(async function*(){throw new Error('Provider unavailable');});await until(async()=>(await store.task(task.id)).status==='paused');
    await store.transition(task.id,'executing');await store.transition(task.id,'verifying');
    await expect(store.complete(task.id,'Unsupported final claim')).rejects.toThrow(/missing or stale/);
    expect((await store.conversation(task.conversationId)).messages.some(message=>message.role==='assistant')).toBe(false);
  });
  it('rejects unsafe, duplicate, unbounded and malformed contract fields',()=>{
    const item={path:'result.txt',expectedSha256:sha256};
    for(const contract of [{requiredReads:[{...item,path:'../secret'}]},{requiredReads:[{...item,path:'.env'}]},{requiredReads:[{...item,expectedSha256:'not-a-hash'}]},{requiredReads:[item,item]},{requiredReads:Array.from({length:9},(_,index)=>({...item,path:`file-${index}`}))},{requiredReads:[item],permissions:'unrestricted'}])expect(verificationContractSchema.safeParse(contract).success).toBe(false);
  });
  it('pauses before spending model calls when the required read capability is unavailable',async()=>{
    let calls=0;const {task}=await setup(async function*(){calls++;yield {type:'text',text:'Unsupported claim'};yield done;},sha256,false);
    await until(async()=>(await store.task(task.id)).status==='paused');expect(calls).toBe(0);expect((await store.task(task.id)).error).toContain('file_read capability is unavailable');
  });
});
