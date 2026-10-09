import {describe,it,expect} from 'vitest';
import {CompletionTracker,completionMessage} from './task-notifications';
import type {ActivityEvent} from '../shared/types';
const event=(id:number,type='TASK_COMPLETED',taskId='task'):ActivityEvent=>({id,type,taskId,createdAt:new Date().toISOString(),data:{result:'secret answer',objective:'private objective'}});
describe('persisted task completion notifications',()=>{
  it('tracks successful admission even when the task finishes before the first query or POST receipt',()=>{
    const tracker=new CompletionTracker();tracker.track('task');expect(tracker.consume([event(1)])).toEqual(['task']);
    const fast=new CompletionTracker();expect(fast.consume([event(1)])).toEqual([]);fast.track('task');expect(fast.consume([event(1)])).toEqual(['task']);fast.track('task');expect(fast.consume([event(2)])).toEqual([]);
  });
  it('does not notify historical or replay-only completions',()=>{const tracker=new CompletionTracker();expect(tracker.consume([event(1,'TASK_CREATED'),event(2)])).toEqual([]);tracker.observe([{id:'task',status:'completed'}]);expect(tracker.consume([event(3)])).toEqual([]);});
  it('notifies only a task observed active and only once through reconnect/replay',()=>{const tracker=new CompletionTracker();tracker.observe([{id:'task',status:'executing'}]);expect(tracker.consume([event(1,'MODEL_TEXT'),event(2)])).toEqual(['task']);expect(tracker.consume([event(1),event(2),event(3)])).toEqual([]);});
  it('does not confuse agent/model completion with task completion',()=>{const tracker=new CompletionTracker();tracker.observe([{id:'task',status:'verifying'}]);expect(tracker.consume([event(1,'MODEL_CALL_COMPLETED'),event(2,'AGENT_COMPLETED')])).toEqual([]);expect(tracker.consume([event(3)])).toEqual(['task']);});
  it('retains active tasks when conversation navigation changes the query',()=>{const tracker=new CompletionTracker();tracker.observe([{id:'task',status:'executing'}]);tracker.observe([{id:'other',status:'completed'}]);expect(tracker.consume([event(2)])).toEqual(['task']);});
  it('does not send a success alert for cancelled or failed tasks',()=>{for(const status of ['TASK_FAILED','TASK_CANCELLED']){const tracker=new CompletionTracker();tracker.observe([{id:'task',status:'executing'}]);expect(tracker.consume([event(1,status),event(2)])).toEqual([]);}});
  it('ignores stale rows after a terminal receipt and keeps notifications generic',()=>{const tracker=new CompletionTracker();tracker.observe([{id:'task',status:'executing'}]);tracker.consume([event(1)]);tracker.observe([{id:'task',status:'executing'}]);expect(tracker.consume([event(2)])).toEqual([]);expect(completionMessage).not.toMatch(/secret answer|private objective/);});
  it('does not share observed task state across user trackers',()=>{const alice=new CompletionTracker(),bob=new CompletionTracker();alice.observe([{id:'task',status:'executing'}]);expect(bob.consume([event(1)])).toEqual([]);expect(alice.consume([event(1)])).toEqual(['task']);});
});
