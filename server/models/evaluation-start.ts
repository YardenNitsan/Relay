import {z} from 'zod';
import type {HardwareSnapshot,ProviderGateway,TaskOptions} from '../../shared/types.js';
import {authorizeOwner,type Principal} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import type {Store} from '../db/store.js';
import {getHardware} from '../hardware/index.js';
import {hardwareAdmission,type Admit} from '../orchestration/router.js';
import {evaluationCases,evaluationProtocol,localEvaluationIdentity} from './evaluation.js';

export const evaluationInput=z.object({modelId:z.string().min(1).max(200),contextTokens:z.number().int().min(4096).max(32768).default(8192),maxOutputTokens:z.number().int().min(256).max(2048).default(512),maxSeconds:z.number().int().min(30).max(1800).default(600)}).strict();

/** Explicit owner-run entry point. Discovery and metadata are read before task
 * creation; no inference, cloud request, tool dispatch or model load occurs here. */
export async function startModelEvaluation(store:Store,engine:{enqueue:(id:string)=>void},gateway:ProviderGateway,principal:Principal,raw:unknown,dependencies:{admit?:Admit;hardware?:()=>Promise<HardwareSnapshot>}={}){
  authorizeOwner(principal);const input=evaluationInput.parse(raw);
  const scoped=gateway.forUser?await gateway.forUser(principal.user.id):gateway;
  const model=(await scoped.listModels()).find(candidate=>candidate.id===input.modelId);
  if(!model?.local||!['ollama','lmstudio'].includes(model.provider)||['offline','error'].includes(model.state)||!model.capabilities.tools)throw new AppError('EVALUATION_MODEL','Select an available direct local model with tool-call support.',409);
  if(model.contextWindow!==null&&input.contextTokens>model.contextWindow)throw new AppError('EVALUATION_CONTEXT','Evaluation context exceeds this model limit.',409);
  const outputLimit=model.details.maxOutputTokens;
  if(typeof outputLimit==='number'&&outputLimit<input.maxOutputTokens)throw new AppError('EVALUATION_OUTPUT','Evaluation output allowance exceeds this model limit.',409);
  const admission=await (dependencies.admit??hardwareAdmission)(model,input.contextTokens);
  if(!admission.allowed)throw new AppError('RESOURCE_PRESSURE',admission.reasons.join('; '),409);
  const identity=localEvaluationIdentity(model,await (dependencies.hardware??getHardware)(),input.contextTokens,input.maxOutputTokens,admission.execution);
  const samples=evaluationCases(),count=samples.length;
  if(samples.some(sample=>Buffer.byteLength(JSON.stringify(sample.messages))+Buffer.byteLength(JSON.stringify(sample.tools))+input.maxOutputTokens+384>input.contextTokens))throw new AppError('EVALUATION_CONTEXT','Increase the context budget to fit the complete evaluation suite.',409);
  const options:TaskOptions={depth:'fast',modelId:model.id,modelSelection:'required',reasoning:'default',efficiency:'standard',workspaceId:null,access:'read_only',contextTokens:input.contextTokens,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},budget:{maxCalls:count,maxIterations:count,maxSeconds:input.maxSeconds,maxOutputTokens:input.maxOutputTokens,maxCostUsd:0,localOnly:true}};
  const conversation=await store.createConversation(`Capability evaluation - ${model.name}`,principal.user.id);
  const {task}=await store.createTask(conversation.id,`Run ${count} synthetic capability evaluation cases for ${model.name}. This measures these cases only, without executing proposed tools or generated code.`,options,principal.user.id,principal.user.sessionVersion);
  try{
    await store.db.query('INSERT INTO model_calibrations(task_id,model_id,context_tokens,protocol,identity) VALUES ($1,$2,$3,$4,$5)',[task.id,model.id,input.contextTokens,evaluationProtocol,JSON.stringify(identity)]);
    await store.audit(task.id,'MODEL_EVALUATION_REQUESTED',{protocol:evaluationProtocol,modelId:model.id,cases:count,localOnly:true});
  }catch(error){await store.transition(task.id,'cancelled');throw error;}
  engine.enqueue(task.id);return {taskId:task.id,conversationId:conversation.id,protocol:evaluationProtocol,cases:count};
}
