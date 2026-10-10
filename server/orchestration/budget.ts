import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import type {TaskOptions} from '../../shared/types.js';
import {AppError,checkSignal} from '../core/errors.js';
import type {Store} from '../db/store.js';

export type ExecutionWait='approval'|'resource';
const quantumMs=5000;
const exhausted=()=>new AppError('TIME_BUDGET','Task execution time budget is exhausted. Start a new objective with an appropriate budget.',409);

/** Reserve before executing. A crash consumes only the outstanding slice, not
 * time while the host is offline. An old lease can never refund a newer lease. */
export class ExecutionBudget {
  private readonly started:number;
  private closed=false;
  private expiry:ReturnType<typeof setTimeout>|undefined;
  private refresh:ReturnType<typeof setTimeout>|undefined;
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
  private paused:{kind:ExecutionWait;at:number}|undefined;
  private pausedMs=0;
  private serial:Promise<void>=Promise.resolve();
  private closing:Promise<void>|undefined;
  private elapsed(){return Math.max(0,Math.ceil((this.paused?.at??this.now())-this.started-this.pausedMs));}
  remainingMs(){return Math.max(0,this.available-this.elapsed());}
  assertActive():void{
    if(this.closed||this.closing||this.elapsed()>=this.reserved&&!this.paused){this.controller.abort('time_budget');throw exhausted();}
    checkSignal(this.controller.signal);
    if(this.paused)throw new AppError('BUDGET_SUSPENDED','Execution reservation is suspended while waiting.',409);
  }
  private enqueue(operation:()=>Promise<void>):Promise<void>{
    const result=this.serial.then(operation);
    this.serial=result.catch(()=>{});
    return result;
  }
  private clearTimers(){clearTimeout(this.expiry);clearTimeout(this.refresh);}
  private schedule(){
    this.clearTimers();
    if(this.closed||this.paused||this.closing)return;
    const left=this.reserved-this.elapsed();
    this.expiry=setTimeout(()=>this.controller.abort('time_budget'),Math.max(0,left));this.expiry.unref();
    if(this.reserved<this.available){
      this.refresh=setTimeout(()=>{
        void this.enqueue(()=>this.extend()).catch(()=>this.controller.abort('budget_storage'));
      },Math.max(1,Math.min(2000,Math.floor(left/2))));this.refresh.unref();
    }
  }
  private async extend(){
    if(this.closed||this.paused||this.closing)return;
    this.assertActive();
    const extra=Math.min(Math.max(0,quantumMs-(this.reserved-this.elapsed())),this.available-this.reserved);
    const saved=await this.store.db.query('UPDATE tasks SET execution_reserved_ms=execution_reserved_ms+$1 WHERE id=$2 AND execution_lease_id=$3 RETURNING execution_reserved_ms',[extra,this.taskId,this.id]);
    if(!saved.length)throw new AppError('BUDGET_REVOKED','Execution reservation no longer belongs to this run.',409);
    this.reserved=Number(saved[0].execution_reserved_ms);
    this.schedule();
  }
  private waitCharges(at:number){
    const duration=this.paused?Math.max(0,Math.ceil(at-this.paused.at)):0;
    return [this.paused?.kind==='approval'?duration:0,this.paused?.kind==='resource'?duration:0];
  }
  suspend(kind:ExecutionWait):Promise<void>{return this.enqueue(async()=>{
    if(this.closed||this.closing)throw new AppError('BUDGET_REVOKED','Execution lease is closing.',409);
    checkSignal(this.controller.signal);
    if(this.paused?.kind===kind)return;
    if(!this.paused)this.assertActive();
    const at=this.now(),consumed=this.elapsed(),charges=this.waitCharges(at),previous=this.paused;
    this.clearTimers();
    this.paused={kind,at};
    if(previous)this.pausedMs+=Math.max(0,at-previous.at);
    try {
      const saved=await this.store.db.query(`UPDATE tasks SET execution_reserved_ms=$1,
        approval_wait_ms=approval_wait_ms+$2,resource_wait_ms=resource_wait_ms+$3,
        execution_wait_kind=$4,execution_wait_started_at=now()
        WHERE id=$5 AND execution_lease_id=$6 RETURNING id`,[consumed,...charges,kind,this.taskId,this.id]);
      if(!saved.length)throw new AppError('BUDGET_REVOKED','Execution reservation no longer belongs to this run.',409);
      this.reserved=consumed;
    }catch(error){this.controller.abort('budget_storage');throw error;}
  });}
  resume():Promise<void>{return this.enqueue(async()=>{
    if(this.closed||this.closing)throw new AppError('BUDGET_REVOKED','Execution lease is closing.',409);
    checkSignal(this.controller.signal);
    if(!this.paused){this.assertActive();return;}
    const at=this.now(),consumed=this.elapsed(),charges=this.waitCharges(at);
    const reserved=Math.min(this.available,consumed+quantumMs);
    if(reserved<=consumed)throw exhausted();
    try{
      const saved=await this.store.db.query(`UPDATE tasks SET execution_reserved_ms=$1,
        approval_wait_ms=approval_wait_ms+$2,resource_wait_ms=resource_wait_ms+$3,
        execution_wait_kind=NULL,execution_wait_started_at=NULL
        WHERE id=$4 AND execution_lease_id=$5 RETURNING id`,[reserved,...charges,this.taskId,this.id]);
      if(!saved.length)throw new AppError('BUDGET_REVOKED','Execution reservation no longer belongs to this run.',409);
      this.pausedMs+=Math.max(0,at-this.paused.at);this.paused=undefined;this.reserved=reserved;
      this.assertActive();this.schedule();
    }catch(error){this.controller.abort('budget_storage');throw error;}
  });}
  close():Promise<void>{
    if(this.closing)return this.closing;
    this.clearTimers();
    this.closing=this.enqueue(async()=>{
      this.closed=true;this.clearTimers();
      const consumed=Math.min(this.reserved,this.elapsed()),charges=this.waitCharges(this.now());
      await this.store.db.query(`UPDATE tasks SET execution_used_ms=execution_used_ms+$1,
        approval_wait_ms=approval_wait_ms+$2,resource_wait_ms=resource_wait_ms+$3,
        execution_reserved_ms=0,execution_lease_id=NULL,execution_wait_kind=NULL,execution_wait_started_at=NULL
        WHERE id=$4 AND execution_lease_id=$5`,[consumed,...charges,this.taskId,this.id]);
    });
    return this.closing;
  }
}

export async function claimStepIteration(store:Store,stepId:string,limit:number):Promise<void>{
  if(!Number.isInteger(limit)||limit<1||limit>16)throw new AppError('ITERATION_BUDGET','Invalid agent iteration budget.');
  const changed=await store.db.query('UPDATE task_steps SET iterations_used=iterations_used+1 WHERE id=$1 AND iterations_used<$2 RETURNING id',[stepId,limit]);
  if(!changed.length)throw new AppError('ITERATION_BUDGET','Agent iteration budget is exhausted across execution attempts. Start a new objective to continue.',409);
}
