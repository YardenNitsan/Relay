import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import type { TaskOptions } from '../shared/types.js';

const options: TaskOptions = { depth:'fast', modelId:null, access:'read_only', workspaceId:null, contextTokens:4096, budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true} };
let store: Store;
afterEach(async () => { if(store) await store.close(); });
describe('PostgreSQL persistence', () => {
  it('creates normalized message/task atomically and replays monotonically ordered events', async () => {
    store = new Store(await openDatabase());
    await store.init();
    const conversation = await store.createConversation('Work');
    const created = await store.createTask(conversation.id, 'Inspect repository', options);
    const detail = await store.conversation(conversation.id);
    expect(detail.messages.map(m=>m.content)).toEqual(['Inspect repository']);
    expect(detail.messages[0].taskId).toBe(created.task.id);
    expect(detail.tasks[0].status).toBe('created');
    await store.transition(created.task.id,'analyzing');
    const events = await store.events(0);
    expect(events.map(e=>e.type)).toContain('TASK_CREATED');
    const last = events.at(-1)!;
    expect(await store.events(last.id)).toEqual([]);
    expect(new Set(events.map(e=>e.id)).size).toBe(events.length);
  });
  it('recovery pauses interrupted work and invalidates outstanding approvals', async () => {
    store = new Store(await openDatabase()); await store.init();
    const c = await store.createConversation('Recover');
    const {task} = await store.createTask(c.id,'Write once',options);
    await store.transition(task.id,'analyzing');
    await store.transition(task.id,'planning');
    await store.transition(task.id,'executing');
    await store.recover();
    expect((await store.task(task.id)).status).toBe('paused');
    expect((await store.events(0)).some(e=>e.type==='RECOVERY_REQUIRED')).toBe(true);
  });
  it('stop is persisted and rejects new objectives until explicitly resumed', async () => {
    store = new Store(await openDatabase()); await store.init();
    const c = await store.createConversation('Stop');
    await store.setStopped(true);
    await expect(store.createTask(c.id,'Should not run',options)).rejects.toThrow(/stop/i);
    expect((await store.control()).generation).toBe(1);
    await store.setStopped(false);
    expect((await store.control()).generation).toBe(1);
    expect((await store.createTask(c.id,'Now allowed',options)).task.status).toBe('created');
  });
});
