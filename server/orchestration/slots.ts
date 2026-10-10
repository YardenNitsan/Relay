import {checkSignal} from '../core/errors.js';

export const executionSlotLimit=3;
type Waiter={grant:(release:()=>void)=>void;cancel:()=>void;signal:AbortSignal;reject:(error:Error)=>void};

/** Bounded host execution, separate from account in-flight quotas. Suspended
 * continuations queue ahead of new work; cancellation cannot leak a slot. */
export class TaskSlots {
  private used=0;
  private waiting:Waiter[]=[];
  constructor(private limit=executionSlotLimit){if(!Number.isInteger(limit)||limit<1)throw new Error('Invalid execution slot limit');}
  private token():()=>void{
    this.used++;let released=false;
    return ()=>{if(released)return;released=true;this.used--;this.drain();};
  }
  tryAcquire():(()=>void)|undefined{
    if(this.waiting.length||this.used>=this.limit)return undefined;
    return this.token();
  }
  acquire(signal:AbortSignal):Promise<()=>void>{
    checkSignal(signal);const token=this.tryAcquire();if(token)return Promise.resolve(token);
    return new Promise((grant,reject)=>{
      const waiter:Waiter={grant,reject,signal,cancel:()=>{
        this.waiting=this.waiting.filter(item=>item!==waiter);signal.removeEventListener('abort',waiter.cancel);
        reject(new Error('Execution cancelled while waiting for a task slot'));this.drain();
      }};
      this.waiting.push(waiter);signal.addEventListener('abort',waiter.cancel,{once:true});
      if(signal.aborted)waiter.cancel();
    });
  }
  private drain(){
    while(this.used<this.limit&&this.waiting.length){
      const waiter=this.waiting.shift()!;waiter.signal.removeEventListener('abort',waiter.cancel);
      if(waiter.signal.aborted){waiter.reject(new Error('Execution cancelled while waiting for a task slot'));continue;}
      waiter.grant(this.token());
    }
  }
}

/** A fixed 30-second owner head start, not an unlimited owner-first partition. */
export function orderQueuedTasks<T extends {userId:string;createdAt:string}>(tasks:T[]):T[]{
  const priority=(task:T)=>Date.parse(task.createdAt)-(task.userId==='owner'?30_000:0);
  return [...tasks].sort((a,b)=>priority(a)-priority(b));
}
