import {describe,it,expect} from 'vitest';
import {evaluateTaskFit,taskCategory,taskFitEvidence} from '../server/models/task-fit.js';
import type {ModelProfile,TaskRecord} from '../shared/types.js';

describe('bounded task-fit evidence',()=>{
  it('grades fixed probes, not response length or a model claim of correctness',()=>{
    expect(evaluateTaskFit('{"coding":[[2,4,6],"undefined"],"reasoning":[372,2],"general":["green",["Ada","Lin"]]}')).toEqual({coding:{passed:2,total:2},reasoning:{passed:2,total:2},general:{passed:2,total:2}});
    expect(evaluateTaskFit('I am excellent at every task.')).toBeNull();
    expect(evaluateTaskFit('{"coding":[[],"object"],"reasoning":[391,3],"general":["blue",[]]}')?.reasoning.passed).toBe(0);
  });
  it('uses the explicit specialist before its disclosed keyword fallback',()=>{
    const task={objective:'Calculate a number',options:{assistantId:'coding'}} as TaskRecord;
    expect(taskCategory(task,'worker')).toBe('coding');
    delete task.options.assistantId;expect(taskCategory(task,'worker')).toBe('reasoning');
    task.objective='Fix a repository bug';expect(taskCategory(task,'worker')).toBe('coding');
    task.objective='Tell me about your day';expect(taskCategory(task,'worker')).toBe('general');
  });
  it('rejects fabricated or stale benchmark metadata instead of ranking it as evidence',()=>{
    const model={id:'ollama/a',details:{digest:'new',runtimeVersion:'1',taskFit:{protocol:'relay-task-fit-v1',digest:'old',runtimeVersion:'1',scores:{coding:{passed:2,total:2}},measuredAt:new Date().toISOString()}}} as unknown as ModelProfile;
    expect(taskFitEvidence(model,'coding')).toBeNull();
    model.details.taskFit={protocol:'relay-task-fit-v1',digest:'new',runtimeVersion:'1',scores:{coding:{passed:9,total:2}},measuredAt:new Date().toISOString()};
    expect(taskFitEvidence(model,'coding')).toBeNull();
  });
});
