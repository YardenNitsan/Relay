import type {HardwareSnapshot,ModelChunk,ModelTiming,ProviderGateway,TaskRecord,TaskStep,ToolRequest} from '../../shared/types.js';
import type {User} from '../auth/policy.js';
import {AppError,publicError} from '../core/errors.js';
import type {Store} from '../db/store.js';
import {getHardware} from '../hardware/index.js';
import type {MemoryWatch,MemoryWatchFactory} from '../hardware/watchdog.js';
import {compatibleEvaluationIdentity,gradeEvaluationSample,localEvaluationIdentity,type EvaluationExecutor,type EvaluationIdentity,type EvaluationMeasurement} from '../models/evaluation.js';
import {EvaluationStore} from '../models/evaluation-store.js';
import {timingRecord,usageRecord} from '../models/usage.js';
import type {ExecutionActivity} from './activity.js';
import type {ExecutionBudget} from './budget.js';
import type {LocalLease} from './lease.js';
import type {Admit} from './router.js';
import {outputTruncated} from './token-policy.js';

export interface EvaluationRunnerDependencies {store:Store;gateway:ProviderGateway;lease:LocalLease;admit:Admit;watchMemory:MemoryWatchFactory;budget:ExecutionBudget;activity:ExecutionActivity;task:TaskRecord;user:User;step:TaskStep;signal:AbortSignal;hardware?:()=>Promise<HardwareSnapshot>;}

export function watchEvaluationAuthorization(parent:AbortSignal,check:()=>Promise<void>){
  const controller=new AbortController(),signal=AbortSignal.any([parent,controller.signal]);
  let closed=false,timer:ReturnType<typeof setTimeout>|undefined,pending:Promise<void>|undefined,failure:unknown;
  const cancel=()=>{closed=true;clearTimeout(timer);};
  const poll=async()=>{
    try{await check();}
    catch(error){failure=error instanceof AppError?error:new AppError('REVOKED','Evaluation permissions could not be verified. Generation was stopped.',403);controller.abort(failure);cancel();}
    finally{if(!closed){timer=setTimeout(()=>{pending=poll();},1000);timer.unref();}}
  };
  parent.addEventListener('abort',cancel,{once:true});
  if(parent.aborted)cancel();else{timer=setTimeout(()=>{pending=poll();},1000);timer.unref();}
  return {signal,error:()=>failure,async stop(){cancel();parent.removeEventListener('abort',cancel);await pending;}};
}

/** Runs inside Engine's existing task slot/budget/activity. Proposed tools are
 * graded only: this module has no broker, workspace or host-command dependency. */
export async function localEvaluationExecutor(deps:EvaluationRunnerDependencies,identity:EvaluationIdentity,agentId:string):Promise<EvaluationExecutor>{
  const {store,task,user,step,budget}=deps;
  const gateway=deps.gateway.forUser?await deps.gateway.forUser(user.id):deps.gateway;
  const records=new EvaluationStore(store);
  return async(sample,execution)=>{
    budget.assertActive();execution.signal.throwIfAborted();
    const permissions=watchEvaluationAuthorization(execution.signal,()=>records.assertAuthorized({userId:user.id,sessionVersion:user.sessionVersion,taskId:task.id},identity));
    let release:()=>void=()=>{};
    let watch:MemoryWatch|undefined,callId:string|undefined,measured:Extract<ModelChunk,{type:'usage'}>|undefined;
    const timing:ModelTiming={};
    try{
      release=await deps.activity.wait(step.id,'resource',()=>deps.lease.acquire(permissions.signal),dispose=>dispose());
      permissions.signal.throwIfAborted();budget.assertActive();
      const model=(await gateway.listModels()).find(candidate=>candidate.id===identity.modelId);
      if(!model?.local||!['ollama','lmstudio'].includes(model.provider)||model.details.remoteHost||model.details.remoteModel||['offline','error'].includes(model.state)||sample.tools.length>0&&!model.capabilities.tools)throw new AppError('EVALUATION_MODEL','The exact local evaluation model is no longer available.',409);
      const admitted=await deps.admit(model,identity.contextTokens);
      if(!admitted.allowed)throw new AppError('RESOURCE_PRESSURE',admitted.reasons.join('; '),409);
      const actual=localEvaluationIdentity(model,await (deps.hardware??getHardware)(),identity.contextTokens,execution.maxOutputTokens,admitted.execution);
      if(!compatibleEvaluationIdentity(identity,actual))throw new AppError('EVALUATION_IDENTITY','Model, runtime, hardware or execution settings changed; start a new evaluation.',409);
      await records.assertAuthorized({userId:user.id,sessionVersion:user.sessionVersion,taskId:task.id},identity);
      permissions.signal.throwIfAborted();watch=deps.watchMemory(permissions.signal,admitted.execution);watch.signal.throwIfAborted();budget.assertActive();
      callId=await store.startCall(task.id,agentId,model.id,sample.messages,{cloud:false,amountUsd:0,provider:model.provider,sessionVersion:user.sessionVersion});
      await store.append(task.id,'MODEL_EVALUATION_SAMPLE_STARTED',{caseId:sample.id,callId,modelId:model.id});
      let text='',done=false,firstContentMs:number|undefined;const calls:ToolRequest[]=[];const started=performance.now();
      for await(const chunk of gateway.stream({model,messages:sample.messages,tools:sample.tools,contextTokens:identity.contextTokens,maxOutputTokens:execution.maxOutputTokens,signal:watch.signal,execution:admitted.execution,timing})){
        watch.signal.throwIfAborted();budget.assertActive();
        if(chunk.type==='text'){
          if(firstContentMs===undefined&&chunk.text)firstContentMs=performance.now()-started;
          text+=chunk.text;if(text.length>32768)throw new AppError('EVALUATION_OUTPUT','Evaluation output exceeded its bounded text allowance.');
        }else if(chunk.type==='tool_call'){
          calls.push(chunk.call);if(calls.length>8||Buffer.byteLength(JSON.stringify(calls))>32768)throw new AppError('EVALUATION_OUTPUT','Evaluation tool proposals exceeded their bounded allowance.');
        }else if(chunk.type==='usage')measured=chunk;
        else if(chunk.type==='done'){if(outputTruncated(chunk.finishReason))throw new AppError('OUTPUT_LIMIT','Evaluation response hit its output ceiling.');done=true;}
        // Private provider continuation is neither retained nor graded.
      }
      if(!done)throw new AppError('INCOMPLETE_STREAM','Evaluation response did not finish.');
      watch.signal.throwIfAborted();budget.assertActive();
      const refreshed=(await gateway.listModels()).find(candidate=>candidate.id===model.id);
      if(!refreshed)throw new AppError('EVALUATION_IDENTITY','Evaluation model disappeared after generation.',409);
      const after=localEvaluationIdentity(refreshed,await (deps.hardware??getHardware)(),identity.contextTokens,execution.maxOutputTokens,admitted.execution);
      if(!compatibleEvaluationIdentity(actual,after))throw new AppError('EVALUATION_IDENTITY','Evaluation model or host identity changed during generation.',409);
      await store.finishCall(callId,measured?.inputTokens??null,measured?.outputTokens??null,0,undefined,{...usageRecord(measured),...timingRecord(timing)});callId=undefined;
      const measurement:EvaluationMeasurement={...(firstContentMs!==undefined?{firstContentMs}:{})};
      if(measured){
        if(measured.inputTokens!==null)measurement.inputTokens=measured.inputTokens;
        if(measured.outputTokens!==null)measurement.outputTokens=measured.outputTokens;
        if(measured.loadDurationMs!==undefined)measurement.loadMs=measured.loadDurationMs;
      }
      return {identity:after,completed:true,text,toolCalls:calls,measurement};
    }catch(error){
      const failure=watch?.error()??permissions.error()??error;
      if(callId)await store.finishCall(callId,measured?.inputTokens??null,measured?.outputTokens??null,0,publicError(failure),{...usageRecord(measured),...timingRecord(timing)});
      throw failure;
    }finally{watch?.stop();await permissions.stop();release();}
  };
}

export async function runLocalEvaluation(deps:EvaluationRunnerDependencies,identity:EvaluationIdentity):Promise<{result:string;reportId:string}>{
  const {store,task,user,step,signal}=deps;
  const records=new EvaluationStore(store);step.modelId=identity.modelId;
  const agentId=await store.startAgent(step,identity.modelId),execute=await localEvaluationExecutor(deps,identity,agentId);
  const saved=await records.runAndRecord({userId:user.id,sessionVersion:user.sessionVersion,taskId:task.id},identity,async(sample,execution)=>{
    const result=await execute(sample,execution),grade=gradeEvaluationSample(sample.id,result);
    await store.append(task.id,'MODEL_EVALUATION_SAMPLE_COMPLETED',{caseId:sample.id,passed:grade.passed,checks:grade.checks});return result;
  },{signal,maxCalls:task.options.budget.maxCalls,timeoutMs:120000});
  const passed=saved.report.samples.filter(sample=>sample.passed).length;
  const result=`Completed ${saved.report.samples.length} synthetic capability cases: ${passed} passed, ${saved.report.samples.length-passed} failed. Results apply only to this recorded model, runtime, hardware and execution configuration. Tool calls were graded proposals; generated code was not executed. This small suite does not establish broad model quality.`;
  await store.finishAgent(step,agentId,result);
  await store.verify(task.id,'model_evaluation','Synthetic evaluation report recorded',true,{protocol:saved.report.protocol,reportId:saved.id,passed,total:saved.report.samples.length,objectiveVerification:true,claim:'bounded_synthetic_evaluation'});
  return {result,reportId:saved.id};
}
