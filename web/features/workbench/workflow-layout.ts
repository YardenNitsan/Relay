import type {TaskStep} from '../../../shared/types';

/** Presentation only: a dependency level is not a claim of parallel execution. */
export function workflowLayout(steps:TaskStep[]):{levels:TaskStep[][];unresolved:TaskStep[]} {
  const remaining=[...steps];
  const completed=new Set<string>();
  const levels:TaskStep[][]=[];
  const duplicates=new Set(steps.filter((step,index)=>steps.findIndex(other=>other.id===step.id)!==index).map(step=>step.id));
  while(remaining.length) {
    const level=remaining.filter(step=>!duplicates.has(step.id)&&step.dependencies.every(id=>completed.has(id)));
    if(!level.length)break;
    levels.push(level);
    for(const step of level) {completed.add(step.id);remaining.splice(remaining.indexOf(step),1);}
  }
  return {levels,unresolved:remaining};
}
