import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {ExecutionBudget,claimStepIteration} from '../server/orchestration/budget.js';
import {buildGraph} from '../server/orchestration/lifecycle.js';
import type {TaskOptions} from '../shared/types.js';

const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:8,maxSeconds:30,maxIterations:2,maxCostUsd:0,localOnly:true}};
let store:Store;
const leases:ExecutionBudget[]=[];
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();});
afterEach(async()=>{for(const lease of leases.splice(0))await lease.close();await store.close();});
async function task(){return (await store.createTask((await store.createConversation()).id,'Bound execution across restart',options)).task;}
async function lease(taskId:string,clock:()=>number){const budget=await ExecutionBudget.start(store,taskId,new AbortController(),clock);leases.push(budget);return budget;}

describe('durable execution budgets',()=>{
  it('refuses dispatch when a resume storage write consumes the new reservation',async()=>{
    const record=await task();let now=0;const current=await lease(record.id,()=>now);
    await current.suspend('approval');now=100000;
    const original=store.db.query.bind(store.db);
    store.db.query=async<T extends Record<string,unknown>>(sql:string,parameters?:unknown[])=>{
      const result=await original<T>(sql,parameters);
      if(sql.includes('execution_wait_kind=NULL')&&sql.includes('RETURNING id'))now+=6000;
      return result;
    };
    await expect(current.resume()).rejects.toThrow(/time budget/i);
    expect(()=>current.assertActive()).toThrow();
  });
  it('revokes dispatch immediately when cleanup is queued behind a storage operation',async()=>{
    const record=await task();const current=await lease(record.id,()=>0);
    const original=store.db.query.bind(store.db);let unblock!:()=>void,started!:()=>void;
    const blocked=new Promise<void>(resolve=>{unblock=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
    store.db.query=async<T extends Record<string,unknown>>(sql:string,parameters?:unknown[])=>{
      if(sql.includes('execution_wait_kind=$4')){started();await blocked;}
      return original<T>(sql,parameters);
    };
    const suspending=current.suspend('approval');await entered;
    const closing=current.close();expect(()=>current.assertActive()).toThrow();
    unblock();await suspending;await closing;
  });
  it('settles each wait category once through concurrent suspension changes and cleanup',async()=>{
    const record=await task();let now=0;const current=await lease(record.id,()=>now);
    now=100;await current.suspend('approval');now=1100;
    await Promise.all([current.suspend('resource'),current.suspend('resource')]);
    now=1600;await Promise.all([current.close(),current.close()]);
    const saved=(await store.db.query('SELECT execution_used_ms,approval_wait_ms,resource_wait_ms FROM tasks WHERE id=$1',[record.id]))[0];
    expect(Number(saved.execution_used_ms)).toBe(100);expect(Number(saved.approval_wait_ms)).toBe(1000);expect(Number(saved.resource_wait_ms)).toBe(500);
  });
  it('does not spend active time or retain future reservations during a long approval wait',async()=>{
    const record=await task();let now=0;const current=await lease(record.id,()=>now);
    now=1000;await current.suspend('approval');
    expect(Number((await store.db.query('SELECT execution_reserved_ms FROM tasks WHERE id=$1',[record.id]))[0].execution_reserved_ms)).toBe(1000);
    now+=120000;expect(current.remainingMs()).toBe(29000);
    expect(()=>current.assertActive()).toThrow(/suspended/i);
    await current.resume();current.assertActive();now+=500;await current.close();
    const saved=(await store.db.query('SELECT execution_used_ms,approval_wait_ms,execution_wait_kind FROM tasks WHERE id=$1',[record.id]))[0];
    expect(Number(saved.execution_used_ms)).toBe(1500);expect(Number(saved.approval_wait_ms)).toBe(120000);expect(saved.execution_wait_kind).toBeNull();
  });
  it('separates resource waits and continues enforcing the original active budget after resume',async()=>{
    const record=await task();let now=0;const current=await lease(record.id,()=>now);
    now=500;await current.suspend('resource');now=60500;await current.resume();
    expect(current.remainingMs()).toBe(29500);now+=5001;
    expect(()=>current.assertActive()).toThrow(/time budget/i);
    await current.close();const saved=(await store.db.query('SELECT resource_wait_ms,execution_used_ms FROM tasks WHERE id=$1',[record.id]))[0];
    expect(Number(saved.resource_wait_ms)).toBe(60000);expect(Number(saved.execution_used_ms)).toBe(5500);
  });
  it('recovers a suspended lease without charging the human wait or allowing stale cleanup to clear a new lease',async()=>{
    const record=await task();let now=0;const crashed=await lease(record.id,()=>now);
    now=750;await crashed.suspend('approval');now+=300000;await store.recover();
    const recovered=await lease(record.id,()=>now);expect(recovered.remainingMs()).toBe(29250);
    await expect(crashed.resume()).rejects.toThrow(/reservation|lease/i);
    await crashed.close();expect((await store.db.query('SELECT execution_lease_id FROM tasks WHERE id=$1',[record.id]))[0].execution_lease_id).not.toBeNull();
  });
  it('charges actual active time on orderly pause and preserves it for a new lease',async()=>{
    const record=await task();let now=0;const first=await lease(record.id,()=>now);now=1250;await first.close();
    const second=await lease(record.id,()=>now);expect(second.remainingMs()).toBe(28_750);now+=500;await second.close();
    const saved=(await store.db.query('SELECT execution_used_ms,execution_reserved_ms FROM tasks WHERE id=$1',[record.id]))[0];
    expect(Number(saved.execution_used_ms)).toBe(1750);expect(Number(saved.execution_reserved_ms)).toBe(0);
  });
  it('retains a crashed lease reservation during recovery without counting offline wall time',async()=>{
    const record=await task();const crashed=await lease(record.id,()=>0);
    const reserved=Number((await store.db.query('SELECT execution_reserved_ms FROM tasks WHERE id=$1',[record.id]))[0].execution_reserved_ms);
    expect(reserved).toBeGreaterThan(0);expect(reserved).toBeLessThanOrEqual(5000);
    await store.recover();const recovered=await lease(record.id,()=>0);expect(recovered.remainingMs()).toBe(30_000-reserved);
    await crashed.close(); // stale cleanup cannot refund the recovered lease.
    expect((await store.db.query('SELECT execution_lease_id FROM tasks WHERE id=$1',[record.id]))[0].execution_lease_id).not.toBeNull();
  });
  it('serializes competing reservations and refuses an exhausted task before dispatch',async()=>{
    const record=await task();const outcomes=await Promise.allSettled([lease(record.id,()=>0),lease(record.id,()=>0)]);
    expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await Promise.all(leases.map(lease=>lease.close()));
    await store.db.query('UPDATE tasks SET execution_used_ms=30000 WHERE id=$1',[record.id]);
    await expect(lease(record.id,()=>0)).rejects.toThrow(/time budget/i);
  });
  it('never permits work beyond its durable reservation even if a refresh is delayed',async()=>{
    const record=await task();let now=0;const current=await lease(record.id,()=>now);now=5001;
    expect(()=>current.assertActive()).toThrow(/time budget/i);
    await current.close();expect(Number((await store.db.query('SELECT execution_used_ms FROM tasks WHERE id=$1',[record.id]))[0].execution_used_ms)).toBe(5000);
  });
  it('keeps the unconsumed reservation bounded while extending a long-running attempt',async()=>{
    const record=await task();const current=await ExecutionBudget.start(store,record.id,new AbortController());leases.push(current);
    await new Promise(resolve=>setTimeout(resolve,2200));
    const reserved=Number((await store.db.query('SELECT execution_reserved_ms FROM tasks WHERE id=$1',[record.id]))[0].execution_reserved_ms);
    expect(reserved).toBeGreaterThan(5000);expect(reserved).toBeLessThan(7600);
  });
  it('persists per-step iterations so a pause or repair cannot reset the loop limit',async()=>{
    const record=await task();const graph=buildGraph(record.id,'fast');await store.saveGraph(graph);
    await claimStepIteration(store,graph[0].id,2);await store.recover();await claimStepIteration(store,graph[0].id,2);
    await expect(claimStepIteration(store,graph[0].id,2)).rejects.toThrow(/iteration budget/i);
  });
});
