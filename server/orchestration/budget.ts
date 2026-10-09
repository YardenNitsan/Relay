import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {TaskOptions} from '../../shared/types.js';
import {AppError,checkSignal} from '../core/errors.js';
import type {Store} from '../db/store.js';

const quantumMs=5000;
const exhausted=()=>new AppError('TIME_BUDGET','Task execution time budget is exhausted. Start a new objective with an appropriate budget.',409);

/** Reserve before executing. A crash consumes only the outstanding slice, not
 * time while the host is offline. An old lease can never refund a newer lease. */
export class ExecutionBudget {
  private readonly started:number;
  private closed=false;
  private expiry:ReturnType<typeof setTimeout>|undefined;
  private refresh:ReturnType<typeof setTimeout>|undefined;
  private pending:Promise<void>|undefined;
  private constructor(private store:Store,private taskId:string,private id:string,private controller:AbortController,private now:()=>number,private reserved:number,private available:number){this.started=now();this.schedule();}

  static async start(store:Store,taskId:string,controller:AbortController,now:()=>number=()=>performance.now()):Promise<ExecutionBudget>{
    const id=randomUUID();
    const state=await store.db.transaction(async tx=>{
      const task=(await tx.query('SELECT options,execution_used_ms,execution_reserved_ms,execution_lease_id FROM tasks WHERE id=$1 FOR UPDATE',[taskId]))[0];
      if(!task)throw new AppError('NOT_FOUND','Task not found',404);
      if(task.execution_lease_id)throw new AppError('BUDGET_BUSY','This task already owns an active execution reservation.',409);
      const available=(task.options as TaskOptions).budget.maxSeconds*1000-Number(task.execution_used_ms)-Number(task.execution_reserved_ms);
      if(!Number.isFinite(available)||available<=0)throw exhausted();
      const reserved=Math.min(quantumMs,available);
      await tx.query('UPDATE tasks SET execution_lease_id=$1,execution_reserved_ms=$2 WHERE id=$3',[id,reserved,taskId]);
      return {available,reserved};
    });
    return new ExecutionBudget(store,taskId,id,controller,now,state.reserved,state.available);
  }
  private elapsed(){return Math.max(0,Math.ceil(this.now()-this.started));}
  remainingMs(){return Math.max(0,this.available-this.elapsed());}
  assertActive():void{
    if(this.closed||this.elapsed()>=this.reserved){this.controller.abort('time_budget');throw exhausted();}
    checkSignal(this.controller.signal);
  }
  private schedule(){
    if(this.closed)return;
    clearTimeout(this.expiry);clearTimeout(this.refresh);
    const left=this.reserved-this.elapsed();
    this.expiry=setTimeout(()=>this.controller.abort('time_budget'),Math.max(0,left));this.expiry.unref();
    if(this.reserved<this.available){
      this.refresh=setTimeout(()=>{
        this.pending=this.extend().catch(()=>this.controller.abort('budget_storage')).finally(()=>{this.pending=undefined;});
      },Math.max(1,Math.min(2000,Math.floor(left/2))));this.refresh.unref();
    }
  }
  private async extend(){
    this.assertActive();
    const extra=Math.min(Math.max(0,quantumMs-(this.reserved-this.elapsed())),this.available-this.reserved);
    const saved=await this.store.db.query('UPDATE tasks SET execution_reserved_ms=execution_reserved_ms+$1 WHERE id=$2 AND execution_lease_id=$3 RETURNING execution_reserved_ms',[extra,this.taskId,this.id]);
    if(!saved.length)throw new AppError('BUDGET_REVOKED','Execution reservation no longer belongs to this run.',409);
    this.reserved=Number(saved[0].execution_reserved_ms);
    if(!this.closed)this.schedule();
  }
  async close():Promise<void>{
    if(this.closed)return;this.closed=true;clearTimeout(this.expiry);clearTimeout(this.refresh);
    await this.pending;
    const consumed=Math.min(this.reserved,this.elapsed());
    await this.store.db.query('UPDATE tasks SET execution_used_ms=execution_used_ms+$1,execution_reserved_ms=0,execution_lease_id=NULL WHERE id=$2 AND execution_lease_id=$3',[consumed,this.taskId,this.id]);
  }
}

export async function claimStepIteration(store:Store,stepId:string,limit:number):Promise<void>{
  if(!Number.isInteger(limit)||limit<1||limit>16)throw new AppError('ITERATION_BUDGET','Invalid agent iteration budget.');
  const changed=await store.db.query('UPDATE task_steps SET iterations_used=iterations_used+1 WHERE id=$1 AND iterations_used<$2 RETURNING id',[stepId,limit]);
  if(!changed.length)throw new AppError('ITERATION_BUDGET','Agent iteration budget is exhausted across execution attempts. Start a new objective to continue.',409);
}
