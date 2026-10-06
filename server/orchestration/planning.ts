import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TaskRecord, TaskStep } from '../../shared/types.js';
import { event, Store } from '../db/store.js';

const proposalSchema=z.object({
  specialists:z.array(z.enum(['architect','security_reviewer','researcher'])).max(3),
  acceptance:z.array(z.string().trim().min(1).max(300)).min(1).max(6),
  reason:z.string().trim().min(1).max(1000),
}).strict();

// The planner selects from bounded roles. It never supplies capabilities,
// executable code, arbitrary graph edges, security policy or revised budgets.
export async function adaptPlan(store:Store,task:TaskRecord,steps:TaskStep[]):Promise<TaskStep[]> {
  const planner=steps.find(step=>step.role==='planner');
  if(!planner?.output||planner.status!=='completed'||steps.some(step=>step.id!==planner.id&&step.status!=='pending'))return steps;
  return store.db.transaction(async tx=>{
    const current=(await tx.query('SELECT plan_decision FROM tasks WHERE id=$1 FOR UPDATE',[task.id]))[0];
    if(current.plan_decision!==null)return steps;
    let proposal:z.infer<typeof proposalSchema>|undefined;
    try{
      if(planner.output!.length>16000)throw new Error('Oversized proposal');
      const candidate=proposalSchema.parse(JSON.parse(planner.output!.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1')));
      if(new Set(candidate.specialists).size!==candidate.specialists.length)throw new Error('Repeated role');
      if(task.options.depth!=='maximum'&&candidate.specialists.includes('researcher'))throw new Error('Role exceeds depth');
      proposal=candidate;
    }catch{/* The bounded default graph remains authoritative. */}
    const decision=proposal?{accepted:true,...proposal}:{accepted:false,reason:'Planner output did not match the bounded plan schema; retained the default graph.'};
    await tx.query('UPDATE tasks SET plan_decision=$1 WHERE id=$2',[JSON.stringify(decision),task.id]);
    let result=steps;
    if(proposal){
      const selected=proposal.specialists.map(role=>({id:randomUUID(),taskId:task.id,role,title:role==='architect'?'Analyze approach and dependencies':role==='security_reviewer'?'Review security and boundaries':'Examine an independent alternative',dependencies:[planner.id],status:'pending' as const,modelId:null,output:null}));
      const worker:TaskStep={id:randomUUID(),taskId:task.id,role:'worker',title:'Execute the accepted objective',dependencies:selected.length?selected.map(step=>step.id):[planner.id],status:'pending',modelId:null,output:null};
      const reviewer:TaskStep={id:randomUUID(),taskId:task.id,role:'reviewer',title:'Review result and recorded evidence',dependencies:[worker.id],status:'pending',modelId:null,output:null};
      await tx.query("DELETE FROM task_steps WHERE task_id=$1 AND status='pending'",[task.id]);
      result=[planner,...selected,worker,reviewer];
      for(const [index,step] of result.entries()){
        if(step.id===planner.id)continue;
        await tx.query('INSERT INTO task_steps(id,task_id,role,title,dependencies,status,ordinal) VALUES ($1,$2,$3,$4,$5,$6,$7)',[step.id,task.id,step.role,step.title,JSON.stringify(step.dependencies),step.status,index]);
      }
    }
    await event(tx,task.id,'PLAN_ADAPTED',{...decision,steps:result});
    return result;
  });
}
