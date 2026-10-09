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
