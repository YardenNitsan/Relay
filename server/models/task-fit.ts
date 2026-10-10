import {z} from 'zod';
import type {AgentRole,ModelProfile,TaskRecord} from '../../shared/types.js';
import type {Store} from '../db/store.js';
import {taskDemand} from './task-demand.js';

export type TaskCategory='coding'|'reasoning'|'general';
export const taskFitProtocol='relay-task-fit-v1';
export const taskFitObjective=`Fixed public Relay task-fit probes, version 1. Return one JSON object only, with keys coding, reasoning, general. Each value must be an array of two answers. No tools, prose or markdown.
coding: (1) What array does JavaScript [1,2,3].map(x => x*2) produce? Return an array. (2) What string does JavaScript typeof undefined return?
reasoning: (1) Calculate 17*23-19. Return a number. (2) Three identical workers take six hours to complete a job. With perfectly divisible work and equal rates, how many hours would nine workers take? Return a number.
general: (1) Extract the color from 'The green door is open'. Return the lowercase color only. (2) Extract the names in order from 'Ada spoke before Lin'. Return an array of names.
This checks only these small tasks, not broad model intelligence.`;
const score=z.object({passed:z.number().int().min(0).max(2),total:z.literal(2)}).strict();
const scores=z.object({coding:score,reasoning:score,general:score}).strict();
const evidenceSchema=z.object({protocol:z.literal(taskFitProtocol),digest:z.string().min(1).max(512),runtimeVersion:z.string().nullable(),measuredAt:z.iso.datetime(),scores}).strict();
export function evaluateTaskFit(result:string):z.infer<typeof scores>|null {
  if(result.length>16000)return null;
  let data:unknown;try{data=JSON.parse(result);}catch{return null;}
  const parsed=z.object({coding:z.array(z.unknown()).length(2),reasoning:z.array(z.unknown()).length(2),general:z.array(z.unknown()).length(2)}).strict().safeParse(data);
  if(!parsed.success)return null;
  const expected={coding:[[2,4,6],'undefined'],reasoning:[372,2],general:['green',['Ada','Lin']]};
  return Object.fromEntries((['coding','reasoning','general'] as const).map(category=>[category,{passed:parsed.data[category].reduce<number>((sum,value,index)=>sum+Number(JSON.stringify(value)===JSON.stringify(expected[category][index])),0),total:2}])) as z.infer<typeof scores>;
}
/** A disclosed heuristic, not semantic understanding or a cloud classifier. */
export function taskCategory(task:Pick<TaskRecord,'objective'|'options'>,role:AgentRole):TaskCategory {
  if(['coder','architect','security_reviewer'].includes(role)||['coding','computer','files'].includes(task.options.assistantId??''))return 'coding';
  const demand=taskDemand(task.objective);
  if(demand.categories.some(category=>['coding','debugging','repository_architecture','multi_file_implementation'].includes(category)))return 'coding';
  if(demand.categories.some(category=>['mathematics','complex_reasoning'].includes(category)))return 'reasoning';
  return 'general';
}
export function taskFitEvidence(model:ModelProfile,category:TaskCategory):{passed:number;total:number;measuredAt:string}|null {
  const parsed=evidenceSchema.safeParse(model.details.taskFit);
  if(!parsed.success||parsed.data.digest!==model.details.digest||parsed.data.runtimeVersion!==(model.details.runtimeVersion??null)||Date.parse(parsed.data.measuredAt)>Date.now()+5000)return null;
  return {...parsed.data.scores[category],measuredAt:parsed.data.measuredAt};
}
/** Attach only completed owner-run fixed probes for the currently discovered artifact. */
export async function decorateTaskFit(store:Store,models:ModelProfile[]):Promise<void> {
  const samples=await store.db.query(`SELECT c.model_id,c.identity,t.result,t.created_at FROM model_calibrations c JOIN tasks t ON t.id=c.task_id WHERE c.protocol=$1 AND t.user_id='owner' AND t.status='completed' ORDER BY t.created_at DESC LIMIT 200`,[taskFitProtocol]);
  for(const model of models){
    if(!model.local||typeof model.details.digest!=='string'||!model.details.digest)continue;
    for(const sample of samples){
      const identity=z.record(z.string(),z.unknown()).safeParse(sample.identity);
      if(!identity.success||!Number.isFinite(Date.parse(String(sample.created_at))))continue;
      const artifact=identity.data;
      if(sample.model_id!==model.id||artifact.digest!==model.details.digest||artifact.provider!==model.provider||artifact.runtime!==model.runtime||artifact.runtimeVersion!==(model.details.runtimeVersion??null))continue;
      const measured=evaluateTaskFit(String(sample.result??''));
      // Invalid format is a failed fixed probe, not an absent positive observation.
      model.details.taskFit={protocol:taskFitProtocol,digest:artifact.digest,runtimeVersion:artifact.runtimeVersion,measuredAt:new Date(sample.created_at as string).toISOString(),scores:measured??{coding:{passed:0,total:2},reasoning:{passed:0,total:2},general:{passed:0,total:2}}};
      break;
    }
  }
}
