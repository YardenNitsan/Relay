import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';
import { LocalPairing } from '../server/auth/pairing.js';
import { chatPermissions } from '../server/auth/policy.js';

let app: FastifyInstance, store: Store, engine: Engine, directory: string, cookie: string;
const host = '127.0.0.1:4317';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'relay-task-feed-'));
  store = new Store(await openDatabase()); await store.init();
  const providers = new Providers({ fetch: async () => new Response('{}', { status: 503 }), secrets: new SecretManager({ env: {} }) });
  const broker = new ToolBroker(directory, () => engine?.isStopped() ?? false); engine = new Engine(store, providers, broker);
  const pairing = new LocalPairing(directory);
  app = await createApp({ store, providers, broker, engine, pairing }, { staticRoot: join(directory, 'missing') });
  const issued = await pairing.issue();
  const response = await app.inject({ method: 'POST', url: '/api/session/pair', headers: { host, origin: `http://${host}` }, payload: { token: issued.token } });
  cookie = response.headers['set-cookie']!.toString().split(';')[0];
});
afterEach(async () => { await engine.shutdown(); await app.close(); await store.close(); await rm(directory, { recursive: true, force: true }); });

async function account() {
  await store.db.query("INSERT INTO users(id,name,role,permissions) VALUES ('other','Other','chat',$1)", [JSON.stringify(chatPermissions)]);
  const token = randomBytes(32).toString('base64url');
  await store.db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ($1,'other','fixture',false,'test',0,now()+interval '1 hour')", [createHash('sha256').update(token).digest('hex')]);
  return `relay_local=${token}`;
}
async function task(options: { userId?: string; conversationId?: string; objective?: string; at?: string; assistantId?: string } = {}) {
  const userId = options.userId ?? 'owner', conversationId = options.conversationId ?? (await store.createConversation('Task list fixture', userId)).id;
  const id = randomUUID();
  await store.db.query(`INSERT INTO tasks(id,conversation_id,user_id,objective,status,options,result,error,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'completed',$5,'PRIVATE_RESULT','PRIVATE_ERROR',$6,$6)`,
  [id, conversationId, userId, options.objective ?? 'Check project files', JSON.stringify({ assistantId: options.assistantId, privateSentinel: 'PRIVATE_OPTIONS' }), options.at ?? '2026-01-01 00:00:00.123456+00']);
  return { id, conversationId };
}
const get = (query = '', session = cookie) => app.inject({ url: `/api/tasks${query}`, headers: { host, cookie: session } });

describe('authenticated task summary feed', () => {
  it('requires a live session and preserves origin protection', async () => {
    expect((await app.inject({ url: '/api/tasks', headers: { host } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/tasks', headers: { host, cookie, origin: 'https://evil.example' } })).statusCode).toBe(403);
    expect((await get()).statusCode).toBe(200);
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");
    expect((await get()).statusCode).toBe(401);
  });

  it('scopes both tasks and conversations to the session account and excludes deleted conversations', async () => {
    const otherCookie = await account();
    const own = await task(), other = await task({ userId: 'other', objective: 'OTHER_ACCOUNT_PRIVATE' });
    const deleted = await task({ objective: 'DELETED_PRIVATE' });
    await store.db.query('UPDATE conversations SET deleted_at=now() WHERE id=$1', [deleted.conversationId]);
    await task({ userId: 'other', conversationId: own.conversationId, objective: 'MISMATCHED_TASK_OWNER' });
    await task({ userId: 'owner', conversationId: other.conversationId, objective: 'MISMATCHED_CONVERSATION_OWNER' });
    const ownerResponse = await get(), otherResponse = await get('', otherCookie);
    expect(ownerResponse.statusCode).toBe(200); expect(otherResponse.statusCode).toBe(200);
    expect(ownerResponse.json().items.map((item: { id: string }) => item.id)).toEqual([own.id]);
    expect(otherResponse.json().items.map((item: { id: string }) => item.id)).toEqual([other.id]);
    expect(ownerResponse.body).not.toMatch(/OTHER_ACCOUNT_PRIVATE|DELETED_PRIVATE|MISMATCHED/);
    expect((await get('?userId=other')).statusCode).toBe(400);
  });

  it('returns only the versioned summary contract with Unicode-safe objective bounds and full IDs', async () => {
    const created = await task({ objective: '🧪'.repeat(201), assistantId: 'coding' });
    const response = await get(); expect(response.statusCode).toBe(200);
    const page = response.json(); expect(Object.keys(page).sort()).toEqual(['items', 'nextCursor', 'version']);
    expect(page.version).toBe(1); expect(page.nextCursor).toBeNull(); expect(page.items).toHaveLength(1);
    const summary = page.items[0];
    expect(Object.keys(summary).sort()).toEqual(['assistantId', 'conversationId', 'createdAt', 'id', 'objective', 'objectiveTruncated', 'status', 'updatedAt']);
    expect(summary).toMatchObject({ ...created, objective: '🧪'.repeat(200), objectiveTruncated: true, status: 'completed', assistantId: 'coding' });
    expect(summary.createdAt).toBe('2026-01-01T00:00:00.123Z'); expect(summary.updatedAt).toBe(summary.createdAt);
    expect(response.body).not.toMatch(/PRIVATE_OPTIONS|PRIVATE_RESULT|PRIVATE_ERROR/);
  });

  it('reports complete short objectives and absent or unknown historical specialist IDs as null', async () => {
    await task({ objective: 'Short' }); await task({ objective: 'Unknown profile', assistantId: 'retired-profile' });
    const response = await get(); expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    for (const item of response.json().items) { expect(item.assistantId).toBeNull(); expect(item.objectiveTruncated).toBe(false); }
  });

  it('paginates timestamp ties without duplicates despite task updates and newer arrivals', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index++) ids.push((await task()).id);
    const first = await get('?limit=2'); expect(first.statusCode).toBe(200);
    const collected = first.json().items.map((item: { id: string }) => item.id);
    await store.db.query('UPDATE tasks SET updated_at=now() WHERE id=$1', [ids[0]]);
    const newer = await task({ at: '2026-01-02 00:00:00+00' });
    let before: string | null = first.json().nextCursor;
    while (before) { const response = await get(`?limit=2&before=${encodeURIComponent(before)}`); expect(response.statusCode).toBe(200); const page = response.json(); collected.push(...page.items.map((item: { id: string }) => item.id)); before = page.nextCursor; }
    expect(collected).toEqual([...ids].sort().reverse()); expect(new Set(collected).size).toBe(7); expect(collected).not.toContain(newer.id);
  });

  it('retains submillisecond cursor precision and rejects malformed, foreign-account and other-view cursors', async () => {
    const otherCookie = await account(), ids: string[] = [];
    for (let index = 1; index <= 3; index++) ids.push((await task({ at: `2026-01-01 00:00:00.12300${index}+00` })).id);
    const first = await get('?limit=1'); expect(first.statusCode).toBe(200);
    const before = first.json().nextCursor as string;
    const second = await get(`?limit=1&before=${before}`); expect(second.statusCode).toBe(200); expect(second.json().items[0].id).toBe(ids[1]);
    expect((await get(`?before=${before}`, otherCookie)).json().code).toBe('INVALID_CURSOR');
    const history = await app.inject({ url: '/api/history/conversations?limit=1', headers: { host, cookie } });
    expect((await get(`?before=${history.json().nextCursor}`)).json().code).toBe('INVALID_CURSOR');
    for (const value of ['bad!cursor', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(before, 'base64url').toString()), at: '2026-02-31 00:00:00+00' })).toString('base64url')]) {
      const response = await get(`?before=${encodeURIComponent(value)}`); expect(response.statusCode).toBe(400); expect(response.json().code).toBe('INVALID_CURSOR');
    }
  });

  it('bounds defaults and explicit limits and rejects ambiguous or unsupported query fields', async () => {
    for (let index = 0; index < 41; index++) await task();
    const page = await get(); expect(page.statusCode).toBe(200); expect(page.json().items).toHaveLength(40); expect(page.json().nextCursor).toEqual(expect.any(String));
    const maximum = await get('?limit=80'); expect(maximum.statusCode).toBe(200); expect(maximum.json().items).toHaveLength(41); expect(maximum.json().nextCursor).toBeNull();
    for (const query of ['?limit=0', '?limit=-1', '?limit=81', '?limit=1.5', '?limit=no', '?limit=', '?limit=1&limit=2', '?before=', '?before=' + 'a'.repeat(1601), '?status=completed']) expect((await get(query)).statusCode, query).toBe(400);
  });
});
