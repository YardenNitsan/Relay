import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine, type ExecutionTools } from '../server/orchestration/engine.js';
import type { ModelChunk, ModelProfile, ModelRequest, TaskOptions, ToolRequest, ToolResult } from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:'11111111-1111-4111-8111-111111111111',contextTokens:8192,budget:{maxCalls:12,maxSeconds:60,maxIterations:8,maxCostUsd:null,localOnly:true}};
let store:Store;let engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
async function run(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,execute:(request:ToolRequest)=>Promise<ToolResult>,overrides:Partial<TaskOptions>={}) {
  store=new Store(await openDatabase());await store.init();
  const tools:ExecutionTools={definitions:()=>['file_read','file_write','terminal'].map(name=>({name,description:name,parameters:{type:'object'}})),decide:()=>({decision:'allow',reason:'Fixture capability',risk:'write'}),execute:async(_context,request)=>execute(request),stopAll:async()=>{},changes:async()=>[]};
  engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},tools,{admit:async()=>({allowed:true,decision:'run',reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated'})});
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Fix and verify the file', {...options,...overrides});engine.enqueue(task.id);
  const deadline=Date.now()+6000;
  while(Date.now()<deadline){const current=await store.task(task.id);if(['completed','paused','waiting_for_user'].includes(current.status))return current;await new Promise(resolve=>setTimeout(resolve,10));}
  throw new Error('Task did not settle');
}
const done:ModelChunk={type:'done',finishReason:'stop'};
const command=(id:string,name='test'):ToolRequest=>({id,name:'terminal',arguments:{argv:['npm',name]}});
const write:ToolRequest={id:'write',name:'file_write',arguments:{path:'source.ts',content:'changed',expectedHash:null}};
const passedCommand:ToolResult={content:JSON.stringify({exitCode:0,filesChanged:0}),evidence:[{kind:'command_exit',summary:'Tests passed',passed:true}]};
const passedWrite:ToolResult={content:JSON.stringify({path:'source.ts',sha256:'a'.repeat(64),checkpointId:'checkpoint'}),evidence:[{kind:'file_content',summary:'Content read back',passed:true}]};

describe('verification context and freshness',()=>{
  it('pauses rather than asking a reviewer to approve a candidate that does not fit',async()=>{
    let reviews=0;
    const task=await run(async function*(request){if(request.messages[0].content.includes("Relay's reviewer")){reviews++;yield {type:'text',text:'REVIEW: PASS'};}else yield {type:'text',text:'CANDIDATE: '+'x'.repeat(5900)};yield done;},async()=>passedWrite,{depth:'balanced'});
    expect(task.status).toBe('paused');expect(task.error).toMatch(/context/i);expect(reviews).toBe(0);
  });
  it('retains a valid file-read receipt and hash when its content exceeds the receipt budget',async()=>{
    let calls=0;let receipt='';
    const task=await run(async function*(request){if(++calls===1)yield {type:'tool_call',call:{id:'read',name:'file_read',arguments:{path:'source.ts'}}};else{receipt=request.messages.find(message=>message.role==='tool')!.content;yield {type:'text',text:'Read complete.'};}yield done;},async()=>({content:JSON.stringify({path:'source.ts',content:'x'.repeat(2500),sha256:'a'.repeat(64),bytes:2500,truncated:false}),evidence:[{kind:'file_read',summary:'Read file',passed:true}]}));
    expect(task.status).toBe('completed');const parsed=JSON.parse(receipt) as Record<string,unknown>;
    expect(parsed.sha256).toBe('a'.repeat(64));expect(parsed.bytes).toBe(2500);expect(parsed.truncated).toBe(true);expect(Buffer.byteLength(receipt)).toBeLessThanOrEqual(2048);
  });
  it('invalidates an earlier passing command when a subsequent file mutation changes the workspace',async()=>{
    let calls=0;
    const task=await run(async function*(){calls++;if(calls===1)yield {type:'tool_call',call:command('test-before')};else if(calls===2)yield {type:'tool_call',call:write};else yield {type:'text',text:'Done.'};yield done;},async request=>request.name==='terminal'?passedCommand:passedWrite);
    expect(task.status).toBe('waiting_for_user');expect((await store.unresolvedChecks(task.id)).map(check=>check.kind)).toContain('command_stale');
  });
  it('settles a stale check only when its original command is rerun after the mutation',async()=>{
    let calls=0;
    const task=await run(async function*(){calls++;if(calls===1||calls===3)yield {type:'tool_call',call:command(`test-${calls}`)};else if(calls===2)yield {type:'tool_call',call:write};else yield {type:'text',text:'Done.'};yield done;},async request=>request.name==='terminal'?passedCommand:passedWrite);
    expect(task.status).toBe('completed');expect(await store.unresolvedChecks(task.id)).toHaveLength(0);expect((await store.verification(task.id)).some(check=>check.kind==='command_stale')).toBe(true);
  });
  it('records a mutating command result after invalidating older command checks',async()=>{
    let calls=0;
    const task=await run(async function*(){calls++;if(calls<=2)yield {type:'tool_call',call:command(`command-${calls}`,calls===1?'lint':'test')};else yield {type:'text',text:'Done.'};yield done;},async request=>(request.arguments.argv as string[])[1]==='lint'?passedCommand:{...passedCommand,content:JSON.stringify({exitCode:0,filesChanged:1,checkpointId:'generated-report'}),evidence:[...passedCommand.evidence,{kind:'file_content',summary:'Report written',passed:true}]});
    expect(task.status).toBe('waiting_for_user');const stale=await store.unresolvedChecks(task.id);expect(stale).toHaveLength(1);expect(stale[0].summary).toContain('lint');
  });
});
