import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Admission,HardwareSnapshot,ProviderGateway} from '../shared/types.js';
import type {Principal,User} from '../server/auth/policy.js';
import {openDatabase} from '../server/db/database.js';
import {row,Store} from '../server/db/store.js';
import {profile} from '../server/providers/registry.js';
import {codeEvaluationProtocol,codeHarnessDigest,codeHash,gradeCodeExecution,type CodeEvaluationIdentity} from '../server/models/code-evaluation.js';
import {CodeEvaluationStore} from '../server/models/code-evaluation-store.js';
import {startCodeEvaluation,type CodeEvaluationTools} from '../server/models/code-evaluation-start.js';
import {runCodeEvaluation} from '../server/orchestration/code-evaluation-runner.js';
import {buildTaskGraph} from '../server/orchestration/lifecycle.js';
import {ExecutionBudget} from '../server/orchestration/budget.js';
import {ExecutionActivity} from '../server/orchestration/activity.js';
import {LocalLease} from '../server/orchestration/lease.js';
import {EvaluationStore} from '../server/models/evaluation-store.js';

let store:Store,user:User,gateway:ProviderGateway,tools:CodeEvaluationTools,calls:number,verifications:number;
const model={...profile('ollama','code-fixture'),quantization:'Q4',details:{digest:'fixture-digest',runtimeVersion:'1'},contextWindow:32768};
const sandbox={imageId:`sha256:${'a'.repeat(64)}`,toolchainVersion:'24.0.0',harnessDigest:codeHarnessDigest};
const admission:Admission={allowed:true,decision:'run',reasons:[],estimatedRamBytes:1e9,estimatedVramBytes:0,contextTokens:8192,confidence:'estimated',execution:{numGpu:0}};
const hardware=async():Promise<HardwareSnapshot>=>({sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'cpu',cpu:{name:'Fixture CPU',physicalCores:8,logicalCores:16,utilization:0},memory:{totalBytes:32e9,availableBytes:20e9,swapTotalBytes:0,swapUsedBytes:0},gpus:[],storage:null,warnings:[]});
const principal=():Principal=>({user,remote:false,sessionId:'fixture'});
beforeEach(async()=>{
  store=new Store(await openDatabase());await store.init();user=row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]);calls=0;verifications=0;
  gateway={listModels:async()=>[model],statuses:async()=>[],stream:async function*(request){expect(request.tools).toEqual([]);calls++;yield {type:'text',text:JSON.stringify({files:{'solution.cjs':'module.exports = x => x;'}})};yield {type:'usage',inputTokens:100,outputTokens:20};yield {type:'done',finishReason:'stop'};}};
  tools={codeEvaluationStatus:async()=>({available:true,reason:'Fixture container gateway; no actual code executes'}),codeEvaluationPreflight:async()=>sandbox,codeEvaluationVerify:async(caseId,source)=>{verifications++;return {caseId,grade:gradeCodeExecution(caseId,{stdout:'[]',exitCode:0,truncated:false}),receipt:{...sandbox,sourceSha256:codeHash(source),outputSha256:codeHash('[]'),exitCode:0,truncated:false,durationMs:10}};}};
});
afterEach(async()=>{await store.close();});
async function setup(){
  const enqueue=vi.fn(),started=await startCodeEvaluation(store,{enqueue},gateway,tools,principal(),{modelId:model.id,confirmed:true},{admit:async()=>admission,hardware});expect(enqueue).toHaveBeenCalledWith(started.taskId);
  const identity=(await store.db.query('SELECT identity FROM model_calibrations WHERE task_id=$1',[started.taskId]))[0].identity as CodeEvaluationIdentity;
  const task=await store.task(started.taskId);await store.transition(task.id,'analyzing');await store.transition(task.id,'planning');const [step]=buildTaskGraph(task.id,task.options);await store.saveGraph([step]);await store.transition(task.id,'executing');
  const controller=new AbortController(),budget=await ExecutionBudget.start(store,task.id,controller),activity=new ExecutionActivity([step.id],budget,controller.signal,async()=>{});
  return {identity,budget,deps:{store,gateway,lease:new LocalLease(),admit:async()=>admission,watchMemory:(signal:AbortSignal)=>({signal,stop(){},error:()=>undefined}),budget,activity,task,user,step,signal:controller.signal,hardware}};
}
describe('executable evaluation production integration (fixture gateway)',()=>{
  it('does not create or enqueue a task when the requesting client disconnects during preflight',async()=>{
    const controller=new AbortController(),enqueue=vi.fn();
    tools.codeEvaluationPreflight=async()=>{controller.abort(new Error('Client disconnected'));return sandbox;};
    await expect(startCodeEvaluation(store,{enqueue},gateway,tools,principal(),{modelId:model.id,confirmed:true},{admit:async()=>admission,hardware,signal:controller.signal})).rejects.toThrow('Client disconnected');
    expect(enqueue).not.toHaveBeenCalled();expect(await store.conversations()).toHaveLength(0);expect(calls).toBe(0);
  });
  it('requires explicit consent and an available sandbox before creating a task or calling a model',async()=>{
    await expect(startCodeEvaluation(store,{enqueue(){}},gateway,tools,principal(),{modelId:model.id},{hardware})).rejects.toThrow();tools.codeEvaluationStatus=async()=>({available:false,reason:'No approved local image'});
    await expect(startCodeEvaluation(store,{enqueue(){}},gateway,tools,principal(),{modelId:model.id,confirmed:true},{hardware})).rejects.toMatchObject({code:'EVALUATION_SANDBOX'});expect(await store.conversations()).toHaveLength(0);expect(calls).toBe(0);
  });
  it('records isolated suite provenance and actual call accounting without mixing v2 reports',async()=>{
    const run=await setup();try{const completed=await runCodeEvaluation(run.deps,tools,run.identity);expect(completed.result).toContain('0/3');expect(calls).toBe(3);expect(verifications).toBe(3);
      const rows=await store.db.query('SELECT status,cost_usd FROM model_calls WHERE task_id=$1',[run.deps.task.id]);expect(rows).toHaveLength(3);expect(rows.every(record=>record.status==='completed'&&Number(record.cost_usd)===0)).toBe(true);
      const history=await new CodeEvaluationStore(store).history({userId:user.id,sessionVersion:user.sessionVersion});expect(history[0]).toMatchObject({id:completed.reportId,status:'completed',result:{passed:0,total:3,executed:3}});expect(await new EvaluationStore(store).history({userId:user.id,sessionVersion:user.sessionVersion})).toEqual([]);
      await expect(runCodeEvaluation(run.deps,tools,run.identity)).rejects.toMatchObject({code:'EVALUATION_EXISTS'});expect(calls).toBe(3);
      expect((await store.db.query('SELECT protocol FROM model_evaluations WHERE id=$1',[completed.reportId]))[0].protocol).toBe(codeEvaluationProtocol);
    }finally{await run.budget.close();}
  });
  it('rejects changed sandbox provenance before any model call',async()=>{const run=await setup();tools.codeEvaluationPreflight=async()=>({...sandbox,toolchainVersion:'24.1.0'});try{await expect(runCodeEvaluation(run.deps,tools,run.identity)).rejects.toMatchObject({code:'EVALUATION_IDENTITY'});expect(calls).toBe(0);}finally{await run.budget.close();}});
  it('rechecks durable authorization after executable verification and refuses further calls',async()=>{const run=await setup(),verify=tools.codeEvaluationVerify;tools.codeEvaluationVerify=async(...args)=>{const result=await verify(...args);await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");return result;};try{await expect(runCodeEvaluation(run.deps,tools,run.identity)).rejects.toMatchObject({code:'REVOKED'});expect(calls).toBe(1);expect(verifications).toBe(1);expect((await new CodeEvaluationStore(store).history({userId:user.id,sessionVersion:1}))[0]).toMatchObject({status:'failed',result:null});}finally{await run.budget.close();}});
});
