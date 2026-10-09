// Explicit browser-test data. Never imported by the production service.
import { randomUUID } from 'node:crypto';
import type { Store } from '../server/db/store.js';

export const historyConversationId = '6a010001-1111-4111-8111-111111111111';
export const historyMessageId = '6a010002-1111-4111-8111-111111111111';
export const historyTaskId = '6a010003-1111-4111-8111-111111111111';
export async function seedHistoryFixture(store: Store) {
  await store.db.query("INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES ($1,'owner','Long history browser fixture','2020-01-01','2020-01-01')", [historyConversationId]);
  const options = { depth: 'fast', modelId: null, access: 'read_only', workspaceId: null, contextTokens: 8192, cloudPolicy: 'local_only', budget: { maxCalls: 4, maxSeconds: 60, maxIterations: 2, maxCostUsd: null, localOnly: true } };
  for (let index = 0; index < 101; index++) {
    await store.db.query("INSERT INTO tasks(id,conversation_id,objective,status,options,created_at) VALUES ($1,$2,$3,'cancelled',$4,'2020-01-01'::timestamptz + $5::int * interval '1 second')", [index === 0 ? historyTaskId : randomUUID(), historyConversationId, `Cancelled browser-test history task ${index}`, JSON.stringify(options), index]);
  }
  for (let index = 0; index < 225; index++) {
    const content = index === 0 ? 'Archive sentinel: the original refresh-token decision used family rotation. This is explicit browser-test data.' : `Saved history message ${index}. This is explicit browser-test data.`;
    await store.db.query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ($1,$2,'user',$3,'2020-01-01'::timestamptz + $4::int * interval '1 second')", [index === 0 ? historyMessageId : randomUUID(), historyConversationId, content, index]);
  }
  await store.db.query('UPDATE messages SET task_id=$1 WHERE id=$2', [historyTaskId, historyMessageId]);
  for (let index = 0; index < 105; index++) {
    await store.db.query("INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES ($1,'owner',$2,'2021-01-01'::timestamptz + $3::int * interval '1 second','2021-01-01')", [randomUUID(), `Paged conversation browser fixture ${index}`, index]);
  }
}
