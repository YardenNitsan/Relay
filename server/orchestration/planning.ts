import {compileWorkflow,type CompiledWorkflow} from './workflow.js';
import type { TaskRecord, TaskStep } from '../../shared/types.js';
import { event, row, Store } from '../db/store.js';

// Proposals contain task data only. The compiler owns roles, graph bounds and
// the sole mutation-capable worker; permission checks remain in the broker.
export async function adaptPlan(store:Store,task:TaskRecord,steps:TaskStep[]):Promise<TaskStep[]> {
  const planner=steps.find(step=>step.role==='planner');
  if(!planner?.output||planner.status!=='completed'||steps.some(step=>step.id!==planner.id&&step.status!=='pending'))return steps;
  return store.db.transaction(async tx=>{
    const current=(await tx.query('SELECT plan_decision,calls_used,status FROM tasks WHERE id=$1 FOR UPDATE',[task.id]))[0];
    if(!current||current.plan_decision!==null||current.status!=='executing')return steps;
    let proposal:CompiledWorkflow|undefined;
    try{
      if(planner.output!.length>16000)throw new Error('Oversized proposal');
      const candidate=JSON.parse(planner.output!.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1'));
      const freshSteps=(await tx.query('SELECT * FROM task_steps WHERE task_id=$1 ORDER BY ordinal',[task.id])).map(item=>row<TaskStep>(item));
      proposal=compileWorkflow({...task,callsUsed:Number(current.calls_used)},freshSteps,candidate);
    }catch{/* The bounded default graph remains authoritative. */}
    const decision=proposal?{accepted:true,format:proposal.format,reason:proposal.reason,acceptance:proposal.acceptance,stepInstructions:proposal.stepInstructions}:{accepted:false,reason:'Planner output did not match the bounded plan schema; retained the default graph.'};
    await tx.query('UPDATE tasks SET plan_decision=$1 WHERE id=$2',[JSON.stringify(decision),task.id]);
    let result=steps;
    if(proposal){
      await tx.query("DELETE FROM task_steps WHERE task_id=$1 AND status='pending'",[task.id]);
      result=proposal.steps;
      for(const [index,step] of result.entries()){
        if(step.id===planner.id)continue;
        await tx.query('INSERT INTO task_steps(id,task_id,role,title,dependencies,status,ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)',[step.id,task.id,step.role,step.title,JSON.stringify(step.dependencies),step.status,index]);
      }
    }
    await event(tx,task.id,'PLAN_ADAPTED',{...decision,steps:result});
    return result;
  });
}
