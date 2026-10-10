import type {TaskOptions,TaskRecord} from '../../shared/types.js';
import {defaultMaxElapsedSeconds,maximumMaxElapsedSeconds,taskDeadlineMs} from '../../shared/task-deadline.js';
import {AppError} from '../core/errors.js';

export const deadlineExceeded=()=>new AppError('TASK_DEADLINE','The overall task deadline has expired, including queue, approval and offline time. Inspect recorded outcomes and start a new objective to continue.',409);
export function assertTaskDeadline(task:Pick<TaskRecord,'createdAt'|'options'>,now=Date.now()):void {
  const deadline=taskDeadlineMs(task);
  if(deadline!==null&&(!Number.isFinite(deadline)||deadline<=now))throw deadlineExceeded();
}
export function withAdmissionDeadline(options:TaskOptions):TaskOptions {
  const maxElapsedSeconds=options.budget.maxElapsedSeconds===undefined?defaultMaxElapsedSeconds:options.budget.maxElapsedSeconds;
  if(!Number.isInteger(maxElapsedSeconds)||maxElapsedSeconds<30||maxElapsedSeconds>maximumMaxElapsedSeconds)throw new AppError('INVALID_DEADLINE','Overall elapsed time must be 30 to 604800 whole seconds.');
  return {...options,budget:{...options.budget,maxElapsedSeconds}};
}
