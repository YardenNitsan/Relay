import { z } from 'zod';
import type { ProviderGateway, TaskOptions } from '../../shared/types.js';
import { AppError } from '../core/errors.js';
import { row, type Store } from '../db/store.js';
import {evaluateTaskFit,taskFitObjective,taskFitProtocol} from './task-fit.js';

export const calibrationInput=z.object({modelId:z.string().min(1).max(200),contextTokens:z.number().int().min(2048).max(32768).default(4096),protocol:z.enum(['relay-text-v1',taskFitProtocol]).default('relay-text-v1')}).strict();
const objective='Local model calibration, protocol relay-text-v1. Write approximately 220 words explaining how a library catalog helps readers find books. Use ordinary prose. Do not request tools. This fixed public prompt measures generation performance, not reasoning accuracy.';

/** Uses the same queue, hardware admission, local lease, cancellation and durable budget as normal work. */
export async function startCalibration(store:Store,engine:{enqueue:(id:string)=>void},gateway:ProviderGateway,modelId:string,contextTokens:number,protocol:'relay-text-v1'|typeof taskFitProtocol='relay-text-v1') {
  calibrationInput.parse({modelId,contextTokens,protocol});
  const model=(await gateway.listModels()).find(candidate=>candidate.id===modelId);
  if(!model?.local||['offline','error'].includes(model.state))throw new AppError('CALIBRATION_MODEL','Select an available local model for calibration.',409);
  if(model.contextWindow!==null&&contextTokens>model.contextWindow)throw new AppError('CALIBRATION_CONTEXT','Requested context exceeds this model’s limit.',409);
  const options:TaskOptions={depth:'fast',modelId,modelSelection:'required',workspaceId:null,access:'read_only',contextTokens,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},budget:{maxCalls:1,maxIterations:1,maxSeconds:120,maxCostUsd:0,localOnly:true}};
  const conversation=await store.createConversation(`${protocol===taskFitProtocol?'Task probes':'Calibration'} · ${model.name}`);
  const {task}=await store.createTask(conversation.id,protocol===taskFitProtocol?taskFitObjective:objective,options);
  try {
    await store.db.query('INSERT INTO model_calibrations(task_id,model_id,context_tokens,protocol,identity) VALUES ($1,$2,$3,$4,$5)',[task.id,model.id,contextTokens,protocol,JSON.stringify({provider:model.provider,runtime:model.runtime,runtimeVersion:model.details.runtimeVersion??null,digest:model.details.digest??null})]);
    await store.audit(task.id,'MODEL_CALIBRATION_STARTED',{modelId,contextTokens,protocol});
  }catch(error){await store.transition(task.id,'cancelled');throw error;}
  engine.enqueue(task.id);return {taskId:task.id,conversationId:conversation.id};
}

export async function calibrationHistory(store:Store) {
  return (await store.db.query(`SELECT c.task_id,c.model_id,c.context_tokens,c.protocol,c.identity,t.status,t.error,t.conversation_id,t.created_at,t.result,
    (SELECT usage FROM model_calls m WHERE m.task_id=t.id AND m.status='completed' ORDER BY m.started_at DESC LIMIT 1) AS measurement
    FROM model_calibrations c JOIN tasks t ON c.task_id=t.id WHERE t.user_id='owner' ORDER BY t.created_at DESC LIMIT 40`)).map(record=>{
      const {result,...metadata}=record;
      return {...row<{taskId:string;modelId:string;contextTokens:number;protocol:string;identity:Record<string,unknown>;status:string;error:string|null;conversationId:string;createdAt:string;measurement:Record<string,number>|null}>(metadata),...(record.protocol===taskFitProtocol&&record.status==='completed'?{taskFit:evaluateTaskFit(String(result??'')),invalidProbeFormat:evaluateTaskFit(String(result??''))===null}:{})};
    });
}
