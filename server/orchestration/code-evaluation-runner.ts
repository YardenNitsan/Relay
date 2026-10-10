import {AppError} from '../core/errors.js';
import {CodeEvaluationStore} from '../models/code-evaluation-store.js';
import {compatibleCodeIdentity,codeEvaluationCases,codeEvaluationEvidence,codeEvaluationIdentitySchema,parseCodeSubmission,type CodeEvaluationIdentity,type CodeSample} from '../models/code-evaluation.js';
import type {CodeEvaluationTools} from '../models/code-evaluation-start.js';
import {localEvaluationExecutor,watchEvaluationAuthorization,type EvaluationRunnerDependencies} from './evaluation-runner.js';

export async function runCodeEvaluation(deps:EvaluationRunnerDependencies,tools:CodeEvaluationTools,rawIdentity:CodeEvaluationIdentity){
  const identity=codeEvaluationIdentitySchema.parse(rawIdentity),{store,task,user,step,signal,budget}=deps,records=new CodeEvaluationStore(store),scope={userId:user.id,sessionVersion:user.sessionVersion,taskId:task.id};
  const authorize=()=>records.authorize(scope,identity);await authorize();step.modelId=identity.model.modelId;let agentId:string|undefined;
  const saved=await records.runAndRecord(scope,identity,async()=>{
    const watch=watchEvaluationAuthorization(signal,authorize);try{
      const current=await tools.codeEvaluationPreflight(watch.signal,authorize);
      if(!compatibleCodeIdentity({...identity,sandbox:current},identity))throw new AppError('EVALUATION_IDENTITY','Sandbox image or toolchain changed before generation.',409);
      agentId=await store.startAgent(step,identity.model.modelId);const execute=await localEvaluationExecutor(deps,identity.model,agentId);
      const samples:CodeSample[]=[];
      for(const sample of codeEvaluationCases()){
        budget.assertActive();watch.signal.throwIfAborted();await authorize();
        const controller=new AbortController(),combined=AbortSignal.any([watch.signal,controller.signal]),timer=setTimeout(()=>controller.abort(new AppError('EVALUATION_TIMEOUT','Coding case generation exceeded its deadline.',409)),120000);
        let generated:Awaited<ReturnType<typeof execute>>;try{generated=await execute(sample,{identity:identity.model,signal:combined,maxOutputTokens:identity.model.executionSettings.maxOutputTokens});combined.throwIfAborted();}finally{clearTimeout(timer);}
        let source:string;try{if(generated.toolCalls.length||!generated.completed)throw new Error('Expected code only');source=parseCodeSubmission(generated.text);}catch{samples.push({caseId:sample.id,grade:{passed:false,checks:[{name:'bounded-code-submission',passed:false}]},receipt:null});await store.append(task.id,'CODE_EVALUATION_CASE_COMPLETED',{caseId:sample.id,passed:false,executed:false});continue;}
        budget.assertActive();await authorize();const result=await tools.codeEvaluationVerify(sample.id,source,identity.sandbox,watch.signal,authorize);watch.signal.throwIfAborted();budget.assertActive();await authorize();samples.push(result);
        await store.append(task.id,'CODE_EVALUATION_CASE_COMPLETED',{caseId:sample.id,passed:result.grade.passed,executed:true,checks:result.grade.checks,receipt:result.receipt});
      }return samples;
    }finally{await watch.stop();}
  },signal);
  const evidence=codeEvaluationEvidence(saved.report,identity)!;
  const result=`Executable Node evaluation: ${evidence.passed}/${evidence.total} synthetic coding cases passed; ${evidence.executed} generated programs were run through the verified offline container boundary. For executed programs, host-side comparisons graded actual outputs and checked code, inputs and harness hashes. Results apply only to the recorded model and container configuration. This public, small suite does not prove general coding quality.`;
  if(!agentId)throw new AppError('EVALUATION_REPORT','Executable evaluation did not start its worker.');
  await store.finishAgent(step,agentId,result);await store.verify(task.id,'code_evaluation','Isolated executable evaluation recorded',true,{reportId:saved.id,protocol:saved.report.protocol,...evidence,objectiveVerification:true});return {result,reportId:saved.id};
}
