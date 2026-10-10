import {checkSignal} from '../core/errors.js';
import type {ExecutionWait} from './budget.js';

type Phase=ExecutionWait|null;
interface Budget {suspend(kind:ExecutionWait):Promise<void>;resume():Promise<void>}

/** Whole-task idle time only. A waiting branch never gives its active siblings
 * free execution time. Register a complete ready wave before starting branches. */
export class ExecutionActivity {
  private branches:Map<string,Phase>;
  private phase:Phase=null;
  private serial:Promise<void>=Promise.resolve();
  constructor(ids:string[],private budget:Budget,private signal:AbortSignal,private onPhase:(phase:Phase)=>Promise<void>){
    this.branches=new Map(ids.map(id=>[id,null]));
  }
  private reconcile():Promise<void>{
    const states=[...this.branches.values()];
    const next:Phase=!states.length||states.includes(null)?null:states.includes('resource')?'resource':'approval';
    const changed=this.serial.then(async()=>{
      checkSignal(this.signal);
      if(next===this.phase)return;
      if(next)await this.budget.suspend(next);
      // Reacquiring a slot after human approval is resource waiting, not human
      // latency. Keep execution suspended until admission has actually returned.
      else if(this.phase==='approval')await this.budget.suspend('resource');
      await this.onPhase(next);
      checkSignal(this.signal);
      if(!next)await this.budget.resume();
      this.phase=next;
    });
    // Failure poisons the wave: another branch must not dispatch after a failed
    // durable transition. Promise.allSettled in Engine joins their cancellation.
    this.serial=changed;return changed;
  }
  async wait<T>(id:string,kind:ExecutionWait,operation:()=>Promise<T>,discard?:(result:T)=>void):Promise<T>{
    if(!this.branches.has(id))throw new Error('Unknown execution branch');
    this.branches.set(id,kind);await this.reconcile();
    checkSignal(this.signal);
    let result:T;let acquired=false;
    try{
      result=await operation();acquired=true;
      this.branches.set(id,null);await this.reconcile();
      checkSignal(this.signal);return result;
    }catch(error){
      if(acquired)discard?.(result!);
      this.branches.set(id,null);
      // Propagate failure before trying to regain capacity. Engine aborts the
      // wave, then joins finish(); a revoked task must not queue to fail.
      throw error;
    }
  }
  async finish(id:string):Promise<void>{
    this.branches.delete(id);
    if(!this.signal.aborted)await this.reconcile();
  }
}
