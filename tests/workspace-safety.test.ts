import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { Engine, type ExecutionTools } from '../server/orchestration/engine.js';
import { ToolBroker } from '../server/tools/index.js';
import { ToolStore } from '../server/tools/store.js';
import { actionCheckKey } from '../server/orchestration/checks.js';
import { invalidateCommandChecks } from '../server/orchestration/verification.js';
import type { ModelChunk, ModelProfile, ModelRequest, TaskOptions } from '../shared/types.js';

const model:ModelProfile={id:'ollama/test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const workspaceId='11111111-1111-4111-8111-111111111111';
const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId,contextTokens:8192,budget:{maxCalls:8,maxSeconds:60,maxIterations:5,maxCostUsd:null,localOnly:true}};
const admitted={allowed:true,decision:'run' as const,reasons:['Fixture'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated' as const};
const tools:ExecutionTools={definitions:()=>[],decide:()=>({decision:'deny',reason:'No tools',risk:'read'}),execute:async()=>{throw new Error('No tools');},stopAll:async()=>{},changes:async()=>[]};
let store:Store;let engine:Engine;let directory:string|undefined;
afterEach(async()=>{vi.restoreAllMocks();await engine?.shutdown();await store?.close();if(directory)await rm(directory,{recursive:true,force:true});directory=undefined;});
async function init(stream:(request:ModelRequest)=>AsyncIterable<ModelChunk>,broker:ExecutionTools=tools){store=new Store(await openDatabase());await store.init();engine=new Engine(store,{listModels:async()=>[model],statuses:async()=>[],stream},broker,{admit:async()=>admitted});}
async function task(objective:string,workspace:string|null=workspaceId){return (await store.createTask((await store.createConversation()).id,objective,{...options,workspaceId:workspace})).task;}
async function until(test:()=>Promise<boolean>){const deadline=Date.now()+6000;while(Date.now()<deadline){if(await test())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Condition not reached');}
const done:ModelChunk={type:'done',finishReason:'stop'};

describe('shared workspace execution ownership',()=>{
  it('queues a second task until the task using that workspace releases it',async()=>{
    let entered=false;let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    await init(async function*(request){if(request.messages.some(message=>message.content.includes('First objective'))){entered=true;await Promise.race([gate,new Promise<void>(resolve=>request.signal.addEventListener('abort',()=>resolve(),{once:true}))]);}yield {type:'text',text:'Completed.'};yield done;});
    const first=await task('First objective');engine.enqueue(first.id);await until(async()=>entered);
    const second=await task('Second objective');engine.enqueue(second.id);
    // A different-workspace task demonstrates the scheduler has processed the queue.
    const chat=await task('Independent chat',null);engine.enqueue(chat.id);await until(async()=>(await store.task(chat.id)).status==='executing');
    expect((await store.task(second.id)).status).toBe('created');release();
    await until(async()=>(await store.task(second.id)).status==='completed');
  });
  it('marks checks on a paused task stale after another task changes their shared workspace',async()=>{
    await init(async function*(){yield done;});const first=await task('Paused checked work');await store.transition(first.id,'paused');const second=await task('New edit');
    const command={id:'tests',name:'terminal',arguments:{argv:['npm','test']}};const key=actionCheckKey(workspaceId,command);
    await store.verify(first.id,'tool_outcome','Passed tests',true,{tool:'terminal',argv:['npm','test']},key);
    await invalidateCommandChecks(store,second.id,{id:'write',name:'file_write',arguments:{path:'a.ts'}},{content:'Changed',evidence:[{kind:'file_content',passed:true,summary:'Changed'}]},'write-call');
    expect((await store.unresolvedChecks(first.id)).map(check=>check.kind)).toEqual(['command_stale']);
  });
  it('reserves manual maintenance so newly admitted work cannot race its writes',async()=>{
    await init(async function*(){yield {type:'text',text:'Done'};yield done;});
    let entered=false;let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
    const maintenance=engine.mutateWorkspace(workspaceId,async()=>{entered=true;await gate;});
    await until(async()=>entered);
    const queued=await task('After manual edit');engine.enqueue(queued.id);
    await expect(engine.mutateWorkspace(workspaceId,async()=>{})).rejects.toThrow(/Stop active workspace tasks/);
    const chat=await task('Independent chat',null);engine.enqueue(chat.id);await until(async()=>(await store.task(chat.id)).status==='completed');
    expect((await store.task(queued.id)).status).toBe('created');release();await maintenance;
    await until(async()=>(await store.task(queued.id)).status==='completed');
  });
  it('invalidates a paused task before an owner upload or checkpoint revert can change its evidence',async()=>{
    await init(async function*(){yield done;});const previous=await task('Previously checked task');await store.transition(previous.id,'paused');
    const key=actionCheckKey(workspaceId,{id:'tests',name:'terminal',arguments:{argv:['npm','test']}});
    await store.verify(previous.id,'tool_outcome','Tests passed',true,{tool:'terminal',argv:['npm','test']},key);
    let invalidatedBeforeWrite=false;
    await engine.mutateWorkspace(workspaceId,async()=>{invalidatedBeforeWrite=(await store.unresolvedChecks(previous.id)).some(check=>check.kind==='command_stale');});
    expect(invalidatedBeforeWrite).toBe(true);
  });
  it('makes a real post-write checkpoint failure uncertain and blocks automatic replay',async()=>{
    directory=await mkdtemp(join(tmpdir(),'relay-uncertain-'));const broker=new ToolBroker(directory,()=>false);const workspace=await broker.createWorkspace('Partial commit');let modelCalls=0;
    const save=ToolStore.prototype.saveCheckpoint;vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,record){if(record.state==='committed')throw new Error('Simulated metadata disk failure after file rename');return save.call(this,record);});
    await init(async function*(){modelCalls++;yield {type:'tool_call',call:{id:'write',name:'file_write',arguments:{path:'result.txt',content:'Actually written',expectedHash:null}}};yield done;},broker);
    const created=await task('Write a file',workspace.id);engine.enqueue(created.id);await until(async()=>['paused','waiting_for_user','completed'].includes((await store.task(created.id)).status));
    expect(await readFile(join(directory,'workspaces',workspace.id,'files','result.txt'),'utf8')).toBe('Actually written');
    expect((await store.task(created.id)).status).toBe('paused');expect((await store.db.query('SELECT status FROM tool_calls WHERE task_id=$1',[created.id]))[0].status).toBe('uncertain');
    expect((await store.taskEvents(created.id)).some(event=>event.type==='TOOL_FAILED'&&event.data.uncertain===true)).toBe(true);
    await expect(engine.resume(created.id)).rejects.toThrow(/uncertain outcome/i);expect(modelCalls).toBe(1);
  });
});
