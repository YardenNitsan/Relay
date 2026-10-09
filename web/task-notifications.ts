import type {ActivityEvent,TaskRecord} from '../shared/types';

const activeStatuses=new Set(['created','analyzing','planning','executing','verifying','replanning','waiting_for_approval']);
/** A historical completion alone cannot create a notification. The task must
 * first have been observed as active through the authenticated task query. */
export class CompletionTracker {
  private tracked=new Set<string>(); private completed=new Set<string>(); private cursor=0;
  private unannounced=new Set<string>();private pending=new Set<string>();
  /** Only call for a successful task admission performed in this tab. */
  track(taskId:string):void {
    if(this.unannounced.delete(taskId))this.pending.add(taskId);
    else if(!this.completed.has(taskId))this.tracked.add(taskId);
    while(this.tracked.size>500)this.tracked.delete(this.tracked.values().next().value!);
  }
  observe(tasks:Pick<TaskRecord,'id'|'status'>[]):void {
    for(const task of tasks)if(activeStatuses.has(task.status)&&!this.completed.has(task.id))this.tracked.add(task.id);
    while(this.tracked.size>500)this.tracked.delete(this.tracked.values().next().value!);
  }
  consume(events:ActivityEvent[]):string[] {
    const finished:string[]=[...this.pending];this.pending.clear();
    for(const event of [...events].sort((a,b)=>a.id-b.id)){
      if(!Number.isSafeInteger(event.id)||event.id<=this.cursor)continue;this.cursor=event.id;
      if(!event.taskId||!['TASK_COMPLETED','TASK_FAILED','TASK_CANCELLED'].includes(event.type))continue;
      if(event.type==='TASK_COMPLETED'&&this.tracked.has(event.taskId)&&!this.completed.has(event.taskId))finished.push(event.taskId);
      else if(event.type==='TASK_COMPLETED'&&!this.completed.has(event.taskId))this.unannounced.add(event.taskId);
      this.tracked.delete(event.taskId);this.completed.add(event.taskId);
    }
    while(this.completed.size>1000)this.completed.delete(this.completed.values().next().value!);
    while(this.unannounced.size>1000)this.unannounced.delete(this.unannounced.values().next().value!);
    return finished;
  }
}
export const completionMessage='A task you were following has finished. Open Relay to review the result.';
export function notificationSupport():boolean {return typeof window!=='undefined'&&window.isSecureContext&&typeof window.Notification==='function'&&typeof window.Notification.requestPermission==='function';}
