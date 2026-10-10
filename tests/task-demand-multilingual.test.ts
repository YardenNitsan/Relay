import {describe,expect,it} from 'vitest';
import {taskDemand} from '../server/models/task-demand.js';
import {taskCategory} from '../server/models/task-fit.js';
import type {TaskRecord} from '../shared/types.js';
import {phraseDemand} from '../benchmarks/task-intent/candidates.js';
import {readFileSync} from 'node:fs';

describe('bounded advisory multilingual demand',()=>{
  it('recognizes software repair without the word debug and does not treat physical repairs as coding',()=>{
    expect(taskDemand('The app stops responding after sign in. Find the cause and repair it.').categories).toEqual(expect.arrayContaining(['debugging','coding']));
    expect(taskDemand('My bicycle brakes are broken. Help me fix them.').categories).not.toContain('debugging');
    expect(taskDemand('The restaurant has a dress code; compare the two outfits.').categories).not.toContain('coding');
  });
  it('handles Hebrew prefixes, niqqud and overlapping requirements',()=>{
    expect(taskDemand('האפליקציה קורסת אחרי כניסה. מצא את הסיבה ותקן אותה.').categories).toEqual(expect.arrayContaining(['debugging','coding']));
    expect(taskDemand('שנה את השרת והממשק בכמה קבצים והריץ את בדיקות הרגרסיה.').categories).toEqual(expect.arrayContaining(['coding','multi_file_implementation','tool_driven','review_verification']));
    expect(taskDemand('הַסְבֵּר מהי פוטוסינתזה.').categories).toContain('factual_explanation');
  });
  it('preserves the exact frozen candidate on the development corpus',()=>{
    const data=JSON.parse(readFileSync('benchmarks/task-intent/development-v1.json','utf8')) as {cases:{objective:string}[]};
    for(const test of data.cases)expect(taskDemand(test.objective)).toEqual(phraseDemand(test.objective));
  });
  it('bounds classification input and remains deterministic',()=>{
    const prefix='z'.repeat(16_384),objective=prefix+' debug code';
    expect(taskDemand(objective)).toEqual(taskDemand(prefix));
    expect(taskDemand('Hello').complexity).toBe('simple');
    expect(taskDemand('Audit security vulnerabilities').complexity).toBe('complex');
  });
  it('shares demand with coarse task-fit routing while preserving explicit specialist selection',()=>{
    const task={objective:'האפליקציה קורסת אחרי כניסה. מצא את הסיבה ותקן אותה.',options:{}} as Pick<TaskRecord,'objective'|'options'>;
    expect(taskCategory(task,'worker')).toBe('coding');
    task.objective='חשב את האינטגרל';expect(taskCategory(task,'worker')).toBe('reasoning');
    task.objective='Hello';expect(taskCategory(task,'worker')).toBe('general');
    expect(taskCategory(task,'architect')).toBe('coding');
    task.options.assistantId='coding';expect(taskCategory(task,'worker')).toBe('coding');
  });
});
