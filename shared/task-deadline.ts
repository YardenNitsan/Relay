import type {TaskRecord} from './types.js';

export const defaultMaxElapsedSeconds=86400;
export const maximumMaxElapsedSeconds=604800;

/** Admission time never changes on resume. Missing duration means a historical
 * task with no overall deadline; invalid persisted values remain invalid. */
export function taskDeadlineMs(task:Pick<TaskRecord,'createdAt'|'options'>):number|null {
  const seconds=task.options.budget.maxElapsedSeconds;
  if(seconds===undefined)return null;
  if(!Number.isInteger(seconds)||seconds<30||seconds>maximumMaxElapsedSeconds)return NaN;
  return Date.parse(task.createdAt)+seconds*1000;
}
