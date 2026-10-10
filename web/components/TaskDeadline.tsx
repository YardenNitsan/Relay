import type {TaskRecord} from '../../shared/types';
import {taskDeadlineMs} from '../../shared/task-deadline';

export default function TaskDeadline({task}:{task:TaskRecord}) {
  const deadline=taskDeadlineMs(task);
  if(deadline===null)return <p className="hint">Overall deadline: not set for this historical task.</p>;
  if(!Number.isFinite(deadline))return <p className="hint">Overall deadline is invalid. Execution is blocked.</p>;
  const date=new Date(deadline);
  return <p className="hint task-deadline">Overall deadline: <time dateTime={date.toISOString()}>{date.toLocaleString()}</time>. Includes queue, approval and offline time.</p>;
}
