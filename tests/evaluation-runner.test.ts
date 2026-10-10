import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Admission,HardwareSnapshot,ModelProfile,ProviderGateway} from '../shared/types.js';
import {openDatabase} from '../server/db/database.js';
import {row,Store} from '../server/db/store.js';
import type {Principal,User} from '../server/auth/policy.js';
import {profile} from '../server/providers/registry.js';
import {startModelEvaluation} from '../server/models/evaluation-start.js';
import {evaluationProtocol,localEvaluationIdentity} from '../server/models/evaluation.js';
import {runLocalEvaluation} from '../server/orchestration/evaluation-runner.js';
import {buildTaskGraph} from '../server/orchestration/lifecycle.js';
import {LocalLease} from '../server/orchestration/lease.js';
import {ExecutionBudget} from '../server/orchestration/budget.js';
import {ExecutionActivity} from '../server/orchestration/activity.js';

let store:Store,user:User,model:ModelProfile,gateway:ProviderGateway,calls:number,watched:number,stopped:number;
const admission:Admission={allowed:true,decision:'run',reasons:['fixture admission'],contextTokens:8192,estimatedRamBytes:1e9,estimatedVramBytes:0,confidence:'estimated',execution:{numGpu:0}};
const hardware=async():Promise<HardwareSnapshot>=>({sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'Fixture CPU',physicalCores:8,logicalCores:16,utilization:0},memory:{totalBytes:32e9,availableBytes:20e9,swapTotalBytes:0,swapUsedBytes:0},gpus:[{vendor:'nvidia',name:'Fixture GPU',totalBytes:12e9,usedBytes:1e9,utilization:0,temperature:40,driver:'1'}],storage:null,warnings:[]});
beforeEach(async()=>{
  store=new Store(await openDatabase());await store.init();user=row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]);calls=0;watched=0;stopped=0;
  model={...profile('ollama','fixture'),capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:'Q4',details:{digest:'fixture-digest',runtimeVersion:'1'}};
  gateway={listModels:async()=>[structuredClone(model)],statuses:async()=>[],stream:async function*(){calls++;yield {type:'text',text:'{}'};yield {type:'usage',inputTokens:100,outputTokens:2};yield {type:'done',finishReason:'stop'};}};
});
afterEach(async()=>{vi.restoreAllMocks();await store.close();});
const principal=():Principal=>({user,remote:false,sessionId:'fixture'});
async function setup(){
  const enqueue=vi.fn();const created=await startModelEvaluation(store,{enqueue},gateway,principal(),{modelId:model.id},{admit:async()=>admission,hardware});
  expect(enqueue).toHaveBeenCalledWith(created.taskId);
  const task=await store.task(created.taskId);await store.transition(task.id,'analyzing');await store.transition(task.id,'planning');const [step]=buildTaskGraph(task.id,task.options);await store.saveGraph([step]);await store.transition(task.id,'executing');
  const controller=new AbortController(),budget=await ExecutionBudget.start(store,task.id,controller),lease=new LocalLease();
  const activity=new ExecutionActivity([step.id],budget,controller.signal,async()=>{});
  const identity=localEvaluationIdentity(model,await hardware(),8192,512,admission.execution);
  return {identity,budget,controller,deps:{store,gateway,lease,admit:async()=>admission,watchMemory:(signal:AbortSignal)=>{watched++;return {signal,stop(){stopped++;},error:()=>undefined};},budget,activity,task,user,step,signal:controller.signal,hardware}};
}

describe('local evaluation production boundary',()=>{
  it('creates a durable request before enqueue and records nine guarded calls without executing proposals',async()=>{
    const run=await setup();
    gateway.stream=async function*(request){calls++;Object.assign(request.timing!,{firstContentMs:12,loadWallMs:4,cleanupWallMs:3,streamWallMs:20});yield {type:'text',text:'{}'};yield {type:'usage',inputTokens:100,outputTokens:2,generationTokensPerSecond:5};yield {type:'done',finishReason:'stop'};};
    try{
      const result=await runLocalEvaluation(run.deps,run.identity);
      expect(result.result).toContain('9 synthetic');expect(calls).toBe(9);expect(watched).toBe(9);expect(stopped).toBe(9);
      expect((await store.db.query('SELECT protocol FROM model_calibrations WHERE task_id=$1',[run.deps.task.id]))[0].protocol).toBe(evaluationProtocol);
      const requests=await store.db.query('SELECT status,cost_usd,usage FROM model_calls WHERE task_id=$1',[run.deps.task.id]);expect(requests).toHaveLength(9);expect(requests.every(call=>call.status==='completed'&&Number(call.cost_usd)===0)).toBe(true);
      expect(requests[0].usage).toMatchObject({firstContentMs:12,loadWallMs:4,cleanupWallMs:3,streamWallMs:20});
      expect((await store.db.query('SELECT * FROM tool_calls WHERE task_id=$1',[run.deps.task.id]))).toHaveLength(0);
      const recorded=(await store.db.query('SELECT status,report FROM model_evaluations WHERE id=$1',[result.reportId]))[0];expect(recorded.status).toBe('completed');
      const samples=(recorded.report as {samples:Array<{measurement:Record<string,number>}>}).samples;
      for(const sample of samples){expect(sample.measurement.firstContentMs).toBeGreaterThanOrEqual(0);expect(sample.measurement.firstTokenMs).toBeUndefined();expect(sample.measurement.generationMs).toBeUndefined();}
    }finally{await run.budget.close();}
  });
  it('rejects revocation after waiting for the shared local lease before provider dispatch',async()=>{
    const run=await setup();const release=await run.deps.lease.acquire(run.controller.signal);const acquire=run.deps.lease.acquire.bind(run.deps.lease);let entered!:()=>void;const waiting=new Promise<void>(resolve=>{entered=resolve;});vi.spyOn(run.deps.lease,'acquire').mockImplementation(async signal=>{entered();return acquire(signal);});
    const promise=runLocalEvaluation(run.deps,run.identity);const rejected=expect(promise).rejects.toMatchObject({code:'REVOKED'});
    try{await waiting;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");release();await rejected;expect(calls).toBe(0);expect(stopped).toBe(watched);}finally{release();await run.budget.close();}
  });
  it('stops after incomplete generation, releases the lease and keeps the attempt ineligible',async()=>{
    const run=await setup();gateway.stream=async function*(){calls++;yield {type:'text',text:'partial'};};
    try{
      await expect(runLocalEvaluation(run.deps,run.identity)).rejects.toMatchObject({code:'INCOMPLETE_STREAM'});expect(calls).toBe(1);expect(stopped).toBe(1);
      expect((await store.db.query('SELECT status,report FROM model_evaluations WHERE task_id=$1',[run.deps.task.id]))[0]).toMatchObject({status:'failed',report:null});
      const release=await run.deps.lease.acquire(run.controller.signal);release();
    }finally{await run.budget.close();}
  });
  it('aborts a long generation after durable revocation and joins provider cleanup',async()=>{
    const run=await setup();let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});let cleaned=false;
    gateway.stream=async function*(request){calls++;entered();try{await new Promise<never>((_resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});}finally{await new Promise(resolve=>setTimeout(resolve,25));cleaned=true;}};
    const pending=runLocalEvaluation(run.deps,run.identity);const rejected=expect(pending).rejects.toMatchObject({code:'REVOKED'});
    try{await started;await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");await rejected;expect(cleaned).toBe(true);expect(calls).toBe(1);const release=await run.deps.lease.acquire(run.controller.signal);release();}finally{await run.budget.close();}
  });
  it('rejects changed artifacts before calling the provider',async()=>{
    const run=await setup();model.details.digest='changed';
    try{await expect(runLocalEvaluation(run.deps,run.identity)).rejects.toMatchObject({code:'EVALUATION_IDENTITY'});expect(calls).toBe(0);}finally{await run.budget.close();}
  });
  it('refuses remote initiation and unverifiable model metadata without enqueuing',async()=>{
    const enqueue=vi.fn();await expect(startModelEvaluation(store,{enqueue},gateway,{...principal(),remote:true},{modelId:model.id},{admit:async()=>admission,hardware})).rejects.toMatchObject({code:'OWNER_ONLY'});
    delete model.details.digest;await expect(startModelEvaluation(store,{enqueue},gateway,principal(),{modelId:model.id},{admit:async()=>admission,hardware})).rejects.toThrow();expect(enqueue).not.toHaveBeenCalled();expect(calls).toBe(0);
  });
});
