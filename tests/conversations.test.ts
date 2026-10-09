import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { HistoryRepository } from '../server/history/repository.js';
import type { TaskOptions } from '../shared/types.js';

let store: Store;
const options: TaskOptions = { depth: 'fast', modelId: null, access: 'read_only', workspaceId: null, contextTokens: 8192, cloudPolicy: 'local_only', budget: { maxCalls: 4, maxSeconds: 60, maxIterations: 2, maxCostUsd: null, localOnly: true } };
beforeEach(async () => { store = new Store(await openDatabase()); await store.init(); });
afterEach(async () => { await store.close(); });

it('rolls back first-conversation creation when task admission fails', async () => {
  await store.setStopped(true);
  const id = randomUUID();
  await expect(store.createTask(id, 'Hello', options, 'owner', undefined, true)).rejects.toThrow(/stop/i);
  expect(await store.conversations()).toEqual([]);
});

it('coalesces concurrent first-message retries and refuses changed reuse', async () => {
  const id = randomUUID();
  const results = await Promise.all([1, 2].map(() => store.createTask(id, 'Hello', options, 'owner', undefined, true)));
  expect(results[0].task.id).toBe(results[1].task.id);
  expect(await store.conversations()).toHaveLength(1);
  expect((await store.conversation(id)).messages).toHaveLength(1);
  await expect(store.createTask(id, 'Different', options, 'owner', undefined, true)).rejects.toThrow(/different/i);
});

it('deletes only owned finished conversations, hides all history and retains usage records', async () => {
  const conversation = await store.createConversation('Deletion sentinel');
  const { task } = await store.createTask(conversation.id, 'Deletion sentinel', options);
  await expect(store.deleteConversation(conversation.id, 'someone-else')).rejects.toMatchObject({ status: 404 });
  await expect(store.deleteConversation(conversation.id, 'owner')).rejects.toMatchObject({ status: 409 });
  await store.transition(task.id, 'cancelled');
  await store.deleteConversation(conversation.id, 'owner');
  expect(await store.conversations()).toEqual([]);
  await expect(store.conversation(conversation.id)).rejects.toMatchObject({ status: 404 });
  await expect(store.task(task.id, 'owner')).rejects.toMatchObject({ status: 404 });
  expect((await store.task(task.id)).status).toBe('cancelled');
  const history = new HistoryRepository(store.db);
  expect((await history.conversations('owner')).items).toEqual([]);
  expect((await history.search('owner', { q: 'Deletion sentinel' })).items).toEqual([]);
  await expect(history.messages('owner', conversation.id)).rejects.toMatchObject({ status: 404 });
  await expect(history.retrieve('owner', conversation.id, 'sentinel')).rejects.toMatchObject({ status: 404 });
  await expect(store.createTask(conversation.id, 'Hello', options)).rejects.toMatchObject({ status: 404 });
  expect(await store.events(0, 300, 'owner')).toEqual([]);
});
