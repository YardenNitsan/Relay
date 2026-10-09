import { randomUUID } from 'node:crypto';
import type { Depth, TaskStatus, TaskStep, AgentRole, TaskOptions } from '../../shared/types.js';
import { AppError } from '../core/errors.js';

export const terminalStates: TaskStatus[] = ['completed', 'failed', 'cancelled'];
const transitions: Record<TaskStatus, TaskStatus[]> = {
  created: ['analyzing','cancelled','paused','failed'], analyzing: ['planning','failed','paused','cancelled'],
  planning: ['executing','failed','paused','cancelled'], executing: ['verifying','waiting_for_approval','waiting_for_user','replanning','failed','paused','cancelled'],
  verifying: ['completed','replanning','failed','paused','cancelled','waiting_for_user'],
  waiting_for_approval: ['executing','paused','cancelled','failed'], waiting_for_user: ['executing','paused','cancelled','failed'],
  replanning: ['executing','failed','paused','cancelled'], paused: ['analyzing','executing','cancelled'],
  completed: [], failed: [], cancelled: [],
};
export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!transitions[from].includes(to)) throw new AppError('INVALID_TRANSITION', `Cannot move task from ${from} to ${to}`,409);
}
export function buildGraph(taskId: string, depth: Depth): TaskStep[] {
  const steps: TaskStep[] = [];
  const add = (role: AgentRole,title:string,dependencies:string[]) => {
    const step: TaskStep = {id:randomUUID(),taskId,role,title,dependencies,status:'pending',modelId:null,output:null}; steps.push(step); return step.id;
  };
  if (depth==='fast') { add('worker','Work on your objective',[]); return steps; }
  if (depth==='balanced') { const work=add('worker','Work on your objective',[]); add('reviewer','Review result and evidence',[work]); return steps; }
  const plan=add('planner','Plan and identify acceptance checks',[]);
  const architecture=add('architect','Independent approach and constraints',[plan]);
  const security=add('security_reviewer','Independent risk and boundary review',[plan]);
  const inputs=[architecture,security];
  if(depth==='maximum') inputs.push(add('researcher','Independent alternative and counterexamples',[plan]));
  const work=add('worker','Synthesize findings and execute',inputs);
  add('reviewer','Critique result against original objective',[work]);
  return steps;
}
export function buildTaskGraph(taskId:string,options:TaskOptions):TaskStep[] {
  // Depth is a budget preference, not a requirement to critique every greeting.
  // Only ordinary Balanced conversation omits review. Any specialist, tool scope
  // or explicit verification retains the existing graph and its safety checks.
  const ordinaryConversation=options.depth==='balanced'&&!options.assistantId&&!options.workspaceId&&
    options.access!=='unrestricted'&&!options.hostAccessConfirmed&&
    (!options.network||options.network.mode==='deny')&&!options.mcpServerIds?.length&&!options.verification?.requiredReads.length;
  return buildGraph(taskId,ordinaryConversation?'fast':options.depth);
}
export function readySteps(steps:TaskStep[]):TaskStep[] {
  const completed=new Set(steps.filter(s=>s.status==='completed').map(s=>s.id));
  return steps.filter(s=>s.status==='pending'&&s.dependencies.every(d=>completed.has(d)));
}
