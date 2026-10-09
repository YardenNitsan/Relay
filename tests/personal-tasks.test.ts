import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db/store.js';
import { openDatabase, type Database } from '../server/db/database.js';
import { ToolBroker } from '../server/tools/index.js';
import { PersonalTasks, personalTaskSchema } from '../server/tools/personal.js';
import { chatPermissions } from '../server/auth/policy.js';
import type { TaskOptions, ToolContext, ToolRequest } from '../shared/types.js';

let store: Store, broker: ToolBroker, directory: string, stopped: boolean;
const request = (arguments_: Record<string, unknown>): ToolRequest => ({ id: randomUUID(), name: 'personal_tasks', arguments: arguments_ });
const options: TaskOptions = { depth: 'fast', modelId: null, access: 'workspace', workspaceId: null, contextTokens: 8192, budget: { maxCalls: 8, maxSeconds: 60, maxIterations: 5, maxCostUsd: null, localOnly: true } };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'relay-personal-'));
  store = new Store(await openDatabase()); await store.init(); stopped = false;
  for (const id of ['alice', 'bob']) await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$2,$3,$4)', [id, id, 'trusted', JSON.stringify({ ...chatPermissions, maxAccess: 'workspace', maxConcurrentTasks: 4 })]);
  broker = new ToolBroker(directory, () => stopped, undefined, store);
});
afterEach(async () => { await broker?.stopAll(); await store?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

async function context(userId = 'alice', access: ToolContext['access'] = 'workspace'): Promise<ToolContext> {
  const conversation = await store.createConversation('Personal task tool tests', userId);
  const { task } = await store.createTask(conversation.id, 'Organize my personal task list', { ...options, access }, userId, 0);
  await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1", [task.id]);
  return { userId, sessionVersion: 0, taskId: task.id, agentId: randomUUID(), workspaceId: null, access, allowedTools: ['personal_tasks'], signal: new AbortController().signal, approved: false };
}
async function execute(scope: ToolContext, arguments_: Record<string, unknown>) { return JSON.parse((await broker.execute(scope, request(arguments_))).content); }

describe('durable personal task tools', () => {
  it('creates, lists, completes and deletes actual account-owned records without a workspace', async () => {
    const scope = await context();
    const created = await execute(scope, { action: 'create', title: 'Plan the weekend', dueAt: '2026-12-12T09:30:00Z' });
    expect(created.item).toMatchObject({ title: 'Plan the weekend', dueAt: '2026-12-12T09:30:00.000Z', completed: false });
    expect(created.notificationsScheduled).toBe(false);
    expect((await execute(scope, { action: 'list' })).items).toHaveLength(1);
    const complete = await broker.execute(scope, request({ action: 'complete', id: created.item.id }));
    expect(JSON.parse(complete.content).item.completed).toBe(true);
    expect(complete.evidence).toEqual([expect.objectContaining({ kind: 'personal_task_state', passed: true, details: expect.objectContaining({ id: created.item.id, action: 'complete', notificationsScheduled: false }) })]);
    expect((await execute(scope, { action: 'list', completed: true })).items).toHaveLength(1);
    await execute(scope, { action: 'delete', id: created.item.id });
    expect((await execute(scope, { action: 'list' })).items).toEqual([]);
    expect((await store.db.query('SELECT * FROM audit_events WHERE task_id=$1 AND operation=$2', [scope.taskId, 'PERSONAL_TASK_ACTION'])).length).toBe(6);
  });

  it('keeps another user’s records inaccessible and rejects a forged user/task pairing', async () => {
    const alice = await context(), bob = await context('bob');
    const created = await execute(alice, { action: 'create', title: 'Alice private plan' });
    expect((await execute(bob, { action: 'list' })).items).toEqual([]);
    for (const action of ['complete', 'delete']) await expect(execute(bob, { action, id: created.item.id })).rejects.toThrow(/not found/i);
    await expect(execute({ ...alice, userId: 'bob' }, { action: 'list' })).rejects.toThrow(/task|owner|scope/i);
    expect((await execute(alice, { action: 'list' })).items[0].completed).toBe(false);
  });

  it('never accepts user IDs, approval flags or grants in model arguments', async () => {
    const scope = await context();
    for (const extra of [{ userId: 'bob' }, { approved: true }, { access: 'workspace' }, { sessionVersion: 0 }]) {
      const call = request({ action: 'create', title: 'Injected grant', ...extra });
      expect(broker.decide(scope, call).decision).toBe('deny');
      await expect(broker.execute(scope, call)).rejects.toThrow();
    }
    expect((await store.db.query('SELECT * FROM personal_tasks')).length).toBe(0);
  });

  it('requires supervised approval and denies read-only mutation even when approved', async () => {
    const readOnly = await context('alice', 'read_only'), supervised = await context('bob', 'supervised');
    const write = request({ action: 'create', title: 'Requires permission' });
    expect(broker.decide(readOnly, request({ action: 'list' })).decision).toBe('allow');
    expect(broker.decide({ ...readOnly, approved: true }, write).decision).toBe('deny');
    expect(broker.decide(supervised, write).decision).toBe('approval');
    await expect(broker.execute(supervised, write)).rejects.toThrow(/approval/i);
    await expect(broker.execute({ ...supervised, approved: true }, write)).resolves.toMatchObject({ evidence: [expect.objectContaining({ passed: true })] });
    await expect(broker.execute({ ...readOnly, access: 'workspace' }, write)).rejects.toThrow(/scope|access/i);
  });

  it.each(['disabled', 'revoked', 'cancelled', 'deleted', 'stopped'])('rechecks durable authority when %s', async mode => {
    const scope = await context();
    if (mode === 'disabled') await store.db.query('UPDATE users SET enabled=false WHERE id=$1', ['alice']);
    if (mode === 'revoked') await store.db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', ['alice']);
    if (mode === 'cancelled') await store.db.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [scope.taskId]);
    if (mode === 'deleted') await store.db.query('UPDATE conversations SET deleted_at=now() WHERE id=(SELECT conversation_id FROM tasks WHERE id=$1)', [scope.taskId]);
    if (mode === 'stopped') await store.setStopped(true);
    await expect(execute(scope, { action: 'create', title: 'Must not commit' })).rejects.toThrow();
    expect((await store.db.query('SELECT * FROM personal_tasks')).length).toBe(0);
  });

  it('invalidates queued work after emergency stop and rejects aborted tasks', async () => {
    const scope = await context(); stopped = true;
    await expect(execute(scope, { action: 'create', title: 'Stopped' })).rejects.toThrow(/stop/i);
    stopped = false; const controller = new AbortController(); controller.abort();
    await expect(execute({ ...scope, signal: controller.signal }, { action: 'create', title: 'Cancelled' })).rejects.toThrow(/cancel/i);
  });

  it('rolls back a mutation if the final stop guard fails before transaction commit', async () => {
    const scope = await context();
    let stopRequested = false;
    const database: Database = { ...store.db, transaction: callback => store.db.transaction(tx => callback({ ...tx, query: async <T extends Record<string, unknown>>(sql: string, parameters?: unknown[]) => { const result = await tx.query<T>(sql, parameters); if (sql.startsWith('INSERT INTO personal_tasks')) stopRequested = true; return result; } })) };
    const guard = () => { if (stopRequested) throw new Error('Emergency stop before commit'); };
    await expect(new PersonalTasks(new Store(database)).execute(scope, { action: 'create', title: 'Rollback candidate' }, guard)).rejects.toThrow(/stop/i);
    expect((await store.db.query('SELECT * FROM personal_tasks')).length).toBe(0);
    expect((await store.db.query('SELECT * FROM audit_events WHERE operation=$1', ['PERSONAL_TASK_ACTION'])).length).toBe(0);
  });

  it('bounds list output and paginates identically timestamped records without crossing accounts', async () => {
    const scope = await context(), bob = await context('bob');
    const ids = Array.from({ length: 5 }, () => randomUUID()).sort();
    for (const id of ids) await store.db.query("INSERT INTO personal_tasks(id,user_id,title,created_at) VALUES ($1,'alice',$2,'2026-10-09T12:00:00.123456Z')", [id, id]);
    await execute(bob, { action: 'create', title: 'Bob data' });
    const seen: string[] = []; let cursor: string | undefined;
    do { const result = await execute(scope, { action: 'list', limit: 2, ...(cursor ? { cursor } : {}) }); seen.push(...result.items.map((item: { id: string }) => item.id)); cursor = result.nextCursor ?? undefined; } while (cursor);
    expect(seen).toEqual(ids);
    await expect(execute(bob, { action: 'list', cursor: ids[0] })).rejects.toThrow(/cursor/i);
  });

  it('enforces a per-user 1000-record quota while another user can still create', async () => {
    const scope = await context(), bob = await context('bob');
    await store.db.query("INSERT INTO personal_tasks(id,user_id,title) SELECT 'quota-'||g,'alice','existing' FROM generate_series(1,999) AS g");
    const competing = new ToolBroker(directory, () => false, undefined, store);
    const admitted = await Promise.allSettled([broker.execute(scope, request({ action: 'create', title: 'Last slot' })), competing.execute(scope, request({ action: 'create', title: 'Concurrent last slot' }))]);
    expect(admitted.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(admitted.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(Number((await store.db.query('SELECT COUNT(*) AS count FROM personal_tasks WHERE user_id=$1', ['alice']))[0].count)).toBe(1000);
    await expect(execute(scope, { action: 'create', title: 'Too many' })).rejects.toThrow(/limit|quota/i);
    expect((await execute(bob, { action: 'create', title: 'Separate quota' })).item.title).toBe('Separate quota');
  });

  it('rechecks durable role and live access grants instead of accepting a broader caller context', async () => {
    const scope = await context();
    await store.db.query('UPDATE tasks SET options=$1 WHERE id=$2', [JSON.stringify({ ...options, assistantId: 'coding' }), scope.taskId]);
    await expect(execute(scope, { action: 'create', title: 'Outside specialist scope' })).rejects.toThrow(/specialization|capability/i);
    await store.db.query('UPDATE tasks SET options=$1 WHERE id=$2', [JSON.stringify(options), scope.taskId]);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2', [JSON.stringify(chatPermissions), 'alice']);
    await expect(execute(scope, { action: 'create', title: 'Downgraded account' })).rejects.toThrow(/access|policy/i);
    expect((await store.db.query('SELECT * FROM personal_tasks')).length).toBe(0);
  });

  it.each(['2026-10-09T12:00:00+02:00', '2026-02-30T12:00:00Z', 'tomorrow', '2026-10-09'])('requires an actual UTC due time, rejecting %s', dueAt => {
    expect(personalTaskSchema.safeParse({ action: 'create', title: 'Due time', dueAt }).success).toBe(false);
  });

  it('rejects empty/oversized/control-character titles and undeclared database capabilities', async () => {
    for (const title of [' ', 'x'.repeat(501), 'bad\0title']) expect(personalTaskSchema.safeParse({ action: 'create', title }).success).toBe(false);
    const scope = await context();
    await expect(execute({ ...scope, userId: undefined }, { action: 'list' })).rejects.toThrow();
    await expect(execute({ ...scope, sessionVersion: undefined }, { action: 'list' })).rejects.toThrow();
    const withoutStore = new ToolBroker(directory, () => false);
    expect(withoutStore.definitions().some(tool => tool.name === 'personal_tasks')).toBe(false);
    await expect(withoutStore.execute(scope, request({ action: 'list' }))).rejects.toThrow(/unavailable/i);
  });

  it('does not misreport a committed result when a connection fails after commit', async () => {
    const scope = await context();
    const database: Database = { ...store.db, transaction: async callback => { await store.db.transaction(callback); throw new Error('Commit acknowledgement lost'); } };
    await expect(new PersonalTasks(new Store(database)).execute(scope, { action: 'create', title: 'Committed before disconnect' }, () => {})).rejects.toMatchObject({ code: 'UNCERTAIN_TOOL_EFFECT' });
    expect((await store.db.query('SELECT * FROM personal_tasks')).length).toBe(1);
  });
});
