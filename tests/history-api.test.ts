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

let app: FastifyInstance, store: Store, engine: Engine, dir: string, cookie: string;
const host = '127.0.0.1:4317';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'relay-history-api-')); store = new Store(await openDatabase()); await store.init();
  const providers = new Providers({ fetch: async () => new Response('{}', { status: 503 }), secrets: new SecretManager({ env: {} }) });
  const broker = new ToolBroker(dir, () => engine?.isStopped() ?? false); engine = new Engine(store, providers, broker);
  const pairing = new LocalPairing(dir); app = await createApp({ store, providers, broker, engine, pairing }, { staticRoot: join(dir, 'missing') });
  const issued = await pairing.issue();
  const session = await app.inject({ method: 'POST', url: '/api/session/pair', headers: { host, origin: `http://${host}` }, payload: { token: issued.token } });
  cookie = session.headers['set-cookie']!.toString().split(';')[0];
});
afterEach(async () => { await engine.shutdown(); await app.close(); await store.close(); await rm(dir, { recursive: true, force: true }); });

describe('history HTTP security boundary', () => {
  it('requires a paired session and rejects unbounded or ambiguous queries', async () => {
    const own = await store.createConversation('Owned history');
    const paths = ['/api/history/conversations', '/api/history/search?q=history', `/api/history/conversations/${own.id}/messages`];
    for (const url of paths) expect((await app.inject({ url, headers: { host } })).statusCode).toBe(401);
    for (const url of ['/api/history/conversations?limit=81', '/api/history/search?q=', '/api/history/search?q=history&extra=1', `/api/history/conversations/${own.id}/messages?beforeId=${own.id}&afterId=${own.id}`]) {
      expect((await app.inject({ url, headers: { host, cookie } })).statusCode).toBe(400);
    }
    expect((await app.inject({ url: '/api/history/conversations', headers: { host, cookie, origin: 'https://evil.example' } })).statusCode).toBe(403);
  });

  it('filters private data even when an authenticated owner guesses another user conversation ID', async () => {
    await store.db.query("INSERT INTO users(id,name,role,permissions) VALUES ('other','Other','chat','{}')");
    const own = await store.createConversation('Own history');
    const other = await store.createConversation('Private sentinel', 'other');
    await store.db.query("INSERT INTO messages(id,conversation_id,role,content) VALUES ('11111111-1111-4111-8111-111111111111',$1,'user','private sentinel')", [other.id]);
    const get = (url: string) => app.inject({ url, headers: { host, cookie } });
    expect((await get(`/api/history/conversations/${other.id}/messages`)).statusCode).toBe(404);
    expect((await get(`/api/history/search?q=sentinel&conversationId=${other.id}`)).statusCode).toBe(404);
    expect((await get(`/api/history/conversations/${own.id}/messages?around=11111111-1111-4111-8111-111111111111`)).statusCode).toBe(404);
    expect((await get('/api/history/search?q=sentinel')).json().items).toEqual([]);
    const history = (await get('/api/history/conversations')).json();
    expect(history.items.map((item: { id: string }) => item.id)).toEqual([own.id]);
    expect(JSON.stringify(history)).not.toContain('Private sentinel');
  });
});
