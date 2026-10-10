import type {AgentRole,ModelProfile,TaskRecord} from '../../shared/types.js';
import type {ReasoningEffort} from '../../shared/model-controls.js';
import {taskDemand} from '../models/task-demand.js';
import {validateReasoning} from '../providers/reasoning.js';

export function resolveTaskReasoning(model:ModelProfile,task:TaskRecord,role:AgentRole,maxOutputTokens:number,demand?:ReturnType<typeof taskDemand>):{effort?:ReasoningEffort;reason:string} {
  const requested=task.options.reasoning??'auto';
  if(requested==='default')return {reason:'Reasoning: provider default requested; its internal token use can vary.'};
  if(requested!=='auto'){
    validateReasoning(model,requested,maxOutputTokens);
    return {effort:requested,reason:`Reasoning: ${requested}, explicitly selected; output ceiling unchanged.`};
  }
  const levels=model.reasoning?.levels;
  if(model.local||!levels?.length)return {reason:'Reasoning: runtime default; supported effort controls are not advertised for this model/transport.'};
  const classified=demand??taskDemand(task.objective);
  const complex=classified.complexity==='complex'||['architect','security_reviewer'].includes(role);
  const preferred:ReasoningEffort[]=complex?(maxOutputTokens>=4096?['medium','low','minimal','none']:['low','minimal','none','medium']):['none','minimal','low','medium'];
  const effort=preferred.find(level=>levels.includes(level));
  // Never silently choose expensive high/max merely because no economical level exists.
  if(!effort)return {reason:'Reasoning: provider default; no supported economical effort control. Token ceiling remains enforced.'};
  validateReasoning(model,effort,maxOutputTokens);
  return {effort,reason:`Reasoning: ${effort}, economical Auto choice for ${classified.complexity} work with the configured ${maxOutputTokens} output-token allowance unchanged.`};
}
