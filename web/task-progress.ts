import type {ActivityEvent,TaskRecord} from '../shared/types';

/** Factual host activity, never model reasoning or reviewer prose. */
export function taskProgress(task:TaskRecord,events:ActivityEvent[]):string {
  if(task.status==='waiting_for_approval')return 'Waiting for your approval.';
  if(task.status==='verifying')return 'Checking the result.';
  if(task.status==='replanning')return 'Updating the approach.';
  if(task.status==='created'||task.status==='analyzing')return 'Understanding your request.';
  if(task.status==='planning')return 'Planning the work.';
  for(let index=events.length-1;index>=0;index--){
    const event=events[index];if(event.taskId!==task.id)continue;
    if(event.type==='TOOL_STARTED'){
      const labels:Record<string,string>={file_read:'Reading authorized files.',file_list:'Inspecting the workspace.',file_search:'Searching the workspace.',file_write:'Writing a workspace file.',file_delete:'Deleting an authorized workspace file.',terminal:'Running an isolated command.',git_status:'Inspecting workspace changes.',git_diff:'Inspecting the file diff.',http_get:'Reading an authorized web source.',mcp_call:'Calling an approved external tool.'};
      return labels[String(event.data.tool)]??'Running an authorized tool.';
    }
    if(event.type==='AGENT_STARTED')return event.data.role==='reviewer'?'Checking the answer.':event.data.role==='worker'?'Preparing your answer.':'Analyzing the request.';
  }
  return 'Working on your request.';
}
