import { checkSignal } from '../core/errors.js';
export class LocalLease {
  private tail:Promise<void>=Promise.resolve();
  async acquire(signal:AbortSignal):Promise<()=>void> {
    checkSignal(signal);
    const previous=this.tail;
    let release!:()=>void;
    const current=new Promise<void>(resolve=>{release=resolve;});
    this.tail=previous.then(()=>current);
    try {
      await new Promise<void>((resolve,reject)=>{
        const cancel=()=>{cleanup();reject(new Error('Execution cancelled while queued'));};
        const cleanup=()=>signal.removeEventListener('abort',cancel);
        signal.addEventListener('abort',cancel,{once:true});
        previous.then(()=>{cleanup();resolve();},reject);
        if(signal.aborted) cancel();
      });
      checkSignal(signal);return release;
    } catch(error) {release();throw error;}
  }
}
