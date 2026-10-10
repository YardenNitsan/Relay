import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {HardwareSnapshot,ProviderGateway,TaskOptions} from '../../shared/types.js';
import {authorizeOwner,type Principal} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import type {Store} from '../db/store.js';
import {getHardware} from '../hardware/index.js';
import {hardwareAdmission,type Admit} from '../orchestration/router.js';
import {watchEvaluationAuthorization} from '../orchestration/evaluation-runner.js';
import {localEvaluationIdentity} from './evaluation.js';
import {evaluationInput} from './evaluation-start.js';
import {codeEvaluationCases,codeEvaluationIdentitySchema,codeEvaluationProtocol,type CodeSandboxIdentity,type CodeSample} from './code-evaluation.js';
import {CodeEvaluationStore} from './code-evaluation-store.js';

export interface CodeEvaluationTools {codeEvaluationStatus():Promise<{available:boolean;reason:string}>;codeEvaluationPreflight(signal:AbortSignal,authorize:()=>Promise<void>):Promise<CodeSandboxIdentity>;codeEvaluationVerify(caseId:string,source:string,identity:CodeSandboxIdentity,signal:AbortSignal,authorize:()=>Promise<void>):Promise<CodeSample>;}
export const codeEvaluationInput=evaluationInput.extend({confirmed:z.literal(true)}).strict();
export async function startCodeEvaluation(store:Store,engine:{enqueue:(id:string)=>void},gateway:ProviderGateway,tools:CodeEvaluationTools,principal:Principal,raw:unknown,dependencies:{admit?:Admit;hardware?:()=>Promise<HardwareSnapshot>;signal?:AbortSignal}={}){
  authorizeOwner(principal);const input=codeEvaluationInput.parse(raw),records=new CodeEvaluationStore(store);
  const signal=AbortSignal.any([AbortSignal.timeout(45000),...(dependencies.signal?[dependencies.signal]:[])]);
  const authorize=async()=>{signal.throwIfAborted();await records.preflightAuthorization(principal);signal.throwIfAborted();};await authorize();
  const status=await tools.codeEvaluationStatus();if(!status.available)throw new AppError('EVALUATION_SANDBOX',status.reason,409);
  const scoped=gateway.forUser?await gateway.forUser(principal.user.id):gateway,model=(await scoped.listModels()).find(candidate=>candidate.id===input.modelId);
  if(!model?.local||!['ollama','lmstudio'].includes(model.provider)||['offline','error'].includes(model.state))throw new AppError('EVALUATION_MODEL','Choose an available direct local model.',409);
  if(model.contextWindow!==null&&input.contextTokens>model.contextWindow||typeof model.details.maxOutputTokens==='number'&&input.maxOutputTokens>model.details.maxOutputTokens)throw new AppError('EVALUATION_CONTEXT','Evaluation exceeds the selected model context or output limit.',409);
  const admission=await (dependencies.admit??hardwareAdmission)(model,input.contextTokens);if(!admission.allowed)throw new AppError('RESOURCE_PRESSURE',admission.reasons.join('; '),409);
  const modelIdentity=localEvaluationIdentity(model,await(dependencies.hardware??getHardware)(),input.contextTokens,input.maxOutputTokens,admission.execution);
  const cases=codeEvaluationCases();if(cases.some(sample=>Buffer.byteLength(JSON.stringify(sample.messages))+input.maxOutputTokens+384>input.contextTokens))throw new AppError('EVALUATION_CONTEXT','Executable cases do not fit the context allowance.',409);
  const watched=watchEvaluationAuthorization(signal,authorize);let sandbox:CodeSandboxIdentity;
  try{sandbox=await tools.codeEvaluationPreflight(watched.signal,authorize);await authorize();}finally{await watched.stop();}
  const identity=codeEvaluationIdentitySchema.parse({model:modelIdentity,sandbox});
  const options:TaskOptions={depth:'fast',modelId:model.id,modelSelection:'required',reasoning:'default',efficiency:'standard',workspaceId:null,access:'read_only',contextTokens:input.contextTokens,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},budget:{maxCalls:cases.length,maxIterations:cases.length,maxSeconds:input.maxSeconds,maxOutputTokens:input.maxOutputTokens,maxCostUsd:0,localOnly:true}};
  const conversationId=randomUUID();const created=await store.db.transaction(async tx=>{signal.throwIfAborted();const result=await store.createTaskInTransaction(tx,conversationId,`Run ${cases.length} synthetic coding cases for ${model.name} in the approved offline Node container and verify actual outputs.`,options,principal.user.id,principal.user.sessionVersion,true);await tx.query('INSERT INTO model_calibrations(task_id,model_id,context_tokens,protocol,identity) VALUES ($1,$2,$3,$4,$5)',[result.task.id,model.id,input.contextTokens,codeEvaluationProtocol,JSON.stringify(identity)]);signal.throwIfAborted();return result;});
  engine.enqueue(created.task.id);return {taskId:created.task.id,conversationId,protocol:codeEvaluationProtocol,cases:cases.length};
}
