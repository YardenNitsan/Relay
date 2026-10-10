import {describe,expect,it} from 'vitest';
import {ExecutionActivity} from '../server/orchestration/activity.js';
import {TaskSlots,orderQueuedTasks} from '../server/orchestration/slots.js';

function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
describe('whole-task activity accounting',()=>{
  it('keeps charging active siblings, then suspends when the last active sibling finishes',async()=>{
    const events:string[]=[];const signal=new AbortController().signal;
    const activity=new ExecutionActivity(['a','b'],{suspend:async kind=>{events.push(kind);},resume:async()=>{events.push('active');}},signal,async phase=>{events.push(`phase:${phase}`);});
    const gate=deferred();const waiting=activity.wait('a','approval',()=>gate.promise);
    await flush();expect(events).toEqual([]);
    await activity.finish('b');expect(events).toEqual(['approval','phase:approval']);
    gate.resolve();await waiting;expect(events).toEqual(['approval','phase:approval','resource','phase:null','active']);
  });
  it('classifies mixed waits as resource time and resumes before returning a resource',async()=>{
    const events:string[]=[];const activity=new ExecutionActivity(['a','b'],{suspend:async kind=>{events.push(kind);},resume:async()=>{events.push('active');}},new AbortController().signal,async()=>{});
    const human=deferred(),resource=deferred();
    const first=activity.wait('a','approval',()=>human.promise),second=activity.wait('b','resource',()=>resource.promise);
    await flush();expect(events).toEqual(['resource']);
    resource.resolve();await second;expect(events.at(-1)).toBe('active');
    await activity.finish('b');expect(events.at(-1)).toBe('approval');
    human.resolve();await first;
  });
  it('disposes an acquired resource if cancellation prevents returning to execution',async()=>{
    const controller=new AbortController();let disposed=0,resumed=0;
    const activity=new ExecutionActivity(['a'],{suspend:async()=>{},resume:async()=>{resumed++;}},controller.signal,async()=>{});
    await expect(activity.wait('a','resource',async()=>{controller.abort();return ()=>{disposed++;};},release=>release())).rejects.toThrow();
    expect(disposed).toBe(1);expect(resumed).toBe(0);
  });
});
describe('bounded execution slots',()=>{
  it('gives waiting resumptions priority over new work and releases exactly once',async()=>{
    const slots=new TaskSlots(1),first=slots.tryAcquire()!;expect(slots.tryAcquire()).toBeUndefined();
    const next=slots.acquire(new AbortController().signal);first();first();
    expect(slots.tryAcquire()).toBeUndefined();const second=await next;second();
    expect(slots.tryAcquire()).toBeTypeOf('function');
  });
  it('removes cancelled waiters without losing capacity',async()=>{
    const slots=new TaskSlots(1),first=slots.tryAcquire()!,controller=new AbortController();
    const cancelled=slots.acquire(controller.signal);controller.abort();await expect(cancelled).rejects.toThrow();first();
    expect(slots.tryAcquire()).toBeTypeOf('function');
  });
  it('bounds owner preference so older remote work cannot starve',()=>{
    const tasks=[{id:'new-owner',userId:'owner',createdAt:'2026-01-01T00:01:00Z'},{id:'remote',userId:'other',createdAt:'2026-01-01T00:00:00Z'},{id:'owner',userId:'owner',createdAt:'2026-01-01T00:00:05Z'}];
    expect(orderQueuedTasks(tasks).map(task=>task.id)).toEqual(['owner','remote','new-owner']);
  });
});
