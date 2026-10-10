import {describe,expect,it} from 'vitest';
import {independentlyGradeTree,targetPaths,visibleTestPath} from '../scripts/coding-fixture';

const original=()=>new Map<string,string>([[targetPaths[0],'deadline before'],[targetPaths[1],'activity before'],[visibleTestPath,'unchanged assertions'],['README.md','unchanged documentation']]);
const repaired=()=>new Map(original()).set(targetPaths[0],'deadline after').set(targetPaths[1],'activity after');
describe('coding acceptance scope cannot be satisfied by changing the grader',()=>{
  it('allows exactly the two intended implementation changes for behavioral grading',()=>{
    expect(()=>independentlyGradeTree(original(),repaired())).not.toThrow();
  });
  it.each([visibleTestPath,'README.md'])('rejects unrelated modifications to %s',path=>{
    expect(()=>independentlyGradeTree(original(),repaired().set(path,'bypassed'))).toThrow(/Unrelated/);
  });
  it('rejects additions, missing targets and equal-sized path substitution',()=>{
    expect(()=>independentlyGradeTree(original(),repaired().set('extra.ts','extra'))).toThrow();
    const replaced=repaired();replaced.delete(targetPaths[0]);replaced.set('replacement.ts','pretend');
    expect(()=>independentlyGradeTree(original(),replaced)).toThrow(/Missing/);
  });
  it('rejects incomplete repair even if a prior terminal result passed',()=>{
    expect(()=>independentlyGradeTree(original(),new Map(original()).set(targetPaths[0],'fixed one'))).toThrow(/not repaired/);
  });
});
