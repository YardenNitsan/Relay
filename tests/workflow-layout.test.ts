import {describe,expect,it} from 'vitest';
import type {TaskStep} from '../shared/types';
import {workflowLayout} from '../web/features/workbench/workflow-layout';

const step=(id:string,dependencies:string[]=[]):TaskStep=>({id,dependencies,taskId:'task',role:'worker',title:id,status:'pending',modelId:null,output:null});
describe('workflow dependency presentation',()=>{
  it('shows independent branches together and waits for both before integration without changing stored order',()=>{
    const steps=[step('review',['backend','frontend']),step('frontend',['plan']),step('plan'),step('backend',['plan'])];
    const result=workflowLayout(steps);
    expect(result.levels.map(level=>level.map(node=>node.id))).toEqual([['plan'],['frontend','backend'],['review']]);
    expect(result.unresolved).toEqual([]);
    expect(steps.map(node=>node.id)).toEqual(['review','frontend','plan','backend']);
  });
  it('keeps missing, cyclic, and ambiguous dependencies visible without presenting them as ready',()=>{
    const steps=[step('start'),step('missing',['unknown']),step('a',['b']),step('b',['a']),step('duplicate'),step('duplicate'),step('dependent',['duplicate'])];
    const result=workflowLayout(steps);
    expect(result.levels.map(level=>level.map(node=>node.id))).toEqual([['start']]);
    expect(result.unresolved.map(node=>node.id)).toEqual(['missing','a','b','duplicate','duplicate','dependent']);
  });
});
