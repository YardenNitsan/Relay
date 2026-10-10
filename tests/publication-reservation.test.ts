import {afterEach,describe,expect,it} from 'vitest';
import {Store} from '../server/db/store';
import {openDatabase} from '../server/db/database';
import {Engine} from '../server/orchestration/engine';
import type {ModelProfile,ProviderGateway,TaskOptions} from '../shared/types';

let store:Store,engine:Engine;
afterEach(async()=>{await engine?.shutdown();await store?.close();});
const model:ModelProfile={id:'ollama:test',name:'test',provider:'ollama',runtime:'test',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32000,quantization:'Q4',sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const options:TaskOptions={depth:'fast',modelId:null,access:'unrestricted',hostAccessConfirmed:true,workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}};
async function waitFor(check:()=>Promise<boolean>){const deadline=Date.now()+6000;while(Date.now()<deadline){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('Condition not reached');}
async function setup(approval=false){
  store=new Store(await openDatabase());await store.init();let calls=0;
  const gateway:ProviderGateway={listModels:async()=>[model],statuses:async()=>[],stream:async function*(){calls++;if(approval)yield {type:'tool_call',call:{id:'host-write',name:'host_write',arguments:{path:'fixture-only',content:'text',expectedHash:null}}};else yield {type:'text',text:'Hello.'};yield {type:'done',finishReason:'stop'};}};
  engine=new Engine(store,gateway,{definitions:()=>[{name:'host_write',description:'Fixture write',parameters:{type:'object',properties:{}}}],decide:()=>({decision:'approval',reason:'Explicit host approval',risk:'write'}),execute:async()=>{throw new Error('Fixture must never execute host writes');},stopAll:async()=>{},changes:async()=>[]},{admit:async()=>({allowed:true,decision:'run',reasons:['Fixture admission'],estimatedRamBytes:100,estimatedVramBytes:100,contextTokens:8192,confidence:'estimated'})});
  const conversation=await store.createConversation();const {task}=await store.createTask(conversation.id,'Hello',options);return {task,calls:()=>calls};
}
describe('original project host reservation',()=>{
  it('holds host tasks queued through maintenance and releases the reservation after failure',async()=>{
    const {task,calls}=await setup();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const maintenance=engine.mutateOriginalProject('11111111-1111-4111-8111-111111111111',async()=>{entered();await gate;throw new Error('Fixture publication interrupted');});
    const rejected=expect(maintenance).rejects.toThrow('Fixture publication interrupted');await started;engine.enqueue(task.id);
    await expect(engine.mutateOriginalProject('22222222-2222-4222-8222-222222222222',async()=>{})).rejects.toMatchObject({code:'HOST_BUSY'});
    await new Promise(resolve=>setTimeout(resolve,80));expect((await store.task(task.id)).status).toBe('created');expect(calls()).toBe(0);
    release();await rejected;await waitFor(async()=>(await store.task(task.id)).status==='completed');expect(calls()).toBe(1);
  });
  it('rejects publication while an unrestricted task is parked for human approval',async()=>{
    const {task}=await setup(true);engine.enqueue(task.id);await waitFor(async()=>(await store.approvals(task.id)).length===1);
    await expect(engine.mutateOriginalProject('11111111-1111-4111-8111-111111111111',async()=>{throw new Error('Must not enter');})).rejects.toMatchObject({code:'HOST_BUSY'});
    expect((await store.approvals(task.id))[0].status).toBe('pending');
  });
});
