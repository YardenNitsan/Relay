import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { Sessions } from '../server/auth/sessions';
import { AppError } from '../server/core/errors';
import { openDatabase } from '../server/db/database';
import { Store } from '../server/db/store';
import { chatPermissions } from '../server/auth/policy';

let store: Store;
const applications: FastifyInstance[] = [];
beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init();
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)', ['friend', 'chat', JSON.stringify(chatPermissions)]);
});
afterEach(async () => { await Promise.all(applications.splice(0).map(app => app.close())); await store.close(); vi.restoreAllMocks(); });
async function fixture(remote = true, userId = 'friend') {
  const sessions = new Sessions(store, remote);
  const app = Fastify(); await app.register(cookie); applications.push(app);
  app.setErrorHandler((error, _request, reply) => { reply.code(error instanceof AppError ? error.status : 500).send({ code: error instanceof AppError ? error.code : 'TEST_ERROR' }); });
  // Trusted test routes stand in for verified identity/pairing, never exposed by Relay.
  app.get('/open', (request, reply) => sessions.open(request, reply, userId, true));
  app.get('/existing', (request, reply) => sessions.open(request, reply, userId, false));
  app.get('/who', async request => { const principal = await sessions.principal(request, userId); return { id: principal.user.id, sessionId: principal.sessionId }; });
  app.post('/logout', async (request, reply) => { const principal = await sessions.principal(request, userId); await sessions.close(request, reply, principal); return { loggedOut: true }; });
  return { app, sessions };
}
function sessionCookie(response: Awaited<ReturnType<FastifyInstance['inject']>>): string {
  return response.headers['set-cookie']!.toString().split(';')[0];
}

describe('browser session lifecycle', () => {
  it.each([true, false])('logs out only the current browser and clears the matching remote=%s cookie', async remote => {
    const { app } = await fixture(remote); const first = await app.inject('/open'); const second = await app.inject('/open');
    const firstCookie = sessionCookie(first); const secondCookie = sessionCookie(second);
    const logout = await app.inject({ method: 'POST', url: '/logout', headers: { cookie: firstCookie, 'x-relay-csrf': first.json().csrfToken } });
    expect(logout.statusCode).toBe(200); expect(logout.json()).toEqual({ loggedOut: true });
    expect(logout.headers['set-cookie']).toContain(`${remote ? '__Host-relay_remote' : 'relay_local'}=;`);
    expect(logout.headers['set-cookie']).toContain('Path=/'); expect(logout.headers['set-cookie']).toContain('HttpOnly');
    expect(logout.headers['set-cookie']).toContain('SameSite=Strict');
    if (remote) expect(logout.headers['set-cookie']).toContain('Secure');
    expect((await app.inject({ url: '/who', headers: { cookie: firstCookie } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/who', headers: { cookie: secondCookie } })).statusCode).toBe(200);
    expect(await store.db.query('SELECT id FROM sessions')).toHaveLength(1);
  });
  it('requires current-session CSRF to log out and leaves other sessions unchanged', async () => {
    const { app } = await fixture(); const opened = await app.inject('/open'); const currentCookie = sessionCookie(opened);
    expect((await app.inject({ method: 'POST', url: '/logout', headers: { cookie: currentCookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/logout', headers: { cookie: currentCookie, 'x-relay-csrf': 'wrong' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/who', headers: { cookie: currentCookie } })).statusCode).toBe(200);
  });
  it('admits exactly twenty concurrent new browsers without evicting or rotating existing sessions', async () => {
    const a = await fixture(); const b = await fixture();
    const results = await Promise.all(Array.from({ length: 25 }, (_, index) => (index % 2 ? a.app : b.app).inject('/open')));
    const accepted = results.filter(result => result.statusCode === 200); const denied = results.filter(result => result.statusCode === 429);
    expect(accepted).toHaveLength(20); expect(denied).toHaveLength(5);
    expect(denied.every(result => result.json().code === 'SESSION_LIMIT' && !result.headers['set-cookie'])).toBe(true);
    expect(await store.db.query('SELECT id FROM sessions')).toHaveLength(20);
    const reused = await a.app.inject({ url: '/existing', headers: { cookie: sessionCookie(accepted[0]) } });
    expect(reused.statusCode).toBe(200); expect(reused.json().csrfToken).toBe(accepted[0].json().csrfToken); expect(reused.headers['set-cookie']).toBeUndefined();
    const another = await fixture(false, 'owner'); expect((await another.app.inject('/open')).statusCode).toBe(200);
  });
  it('does not count expired or version-revoked records against active capacity', async () => {
    const { app } = await fixture();
    await store.db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) SELECT 'old-'||n,'friend','csrf',true,'old',0,now()-interval '1 second' FROM generate_series(1,20) AS n");
    expect((await app.inject('/open')).statusCode).toBe(200);
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    expect((await app.inject('/open')).statusCode).toBe(200);
    expect(await store.db.query("SELECT id FROM sessions WHERE user_id='friend'")).toHaveLength(1);
  });
  it('refuses a revoked account version between the initial read and durable admission lock', async () => {
    const { app, sessions } = await fixture(); const original = sessions.user.bind(sessions);
    vi.spyOn(sessions, 'user').mockImplementationOnce(async id => {
      const observed = await original(id); await store.db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', [id]); return observed;
    });
    const result = await app.inject('/open'); expect(result.statusCode).toBe(401); expect(result.json().code).toBe('SESSION_REVOKED');
    expect(result.headers['set-cookie']).toBeUndefined(); expect(await store.db.query('SELECT id FROM sessions')).toEqual([]);
  });
  it('rechecks disablement under the same durable admission lock', async () => {
    const { app, sessions } = await fixture(); const original = sessions.user.bind(sessions);
    vi.spyOn(sessions, 'user').mockImplementationOnce(async id => {
      const observed = await original(id); await store.db.query('UPDATE users SET enabled=false WHERE id=$1', [id]); return observed;
    });
    const result = await app.inject('/open'); expect(result.statusCode).toBe(403); expect(result.json().code).toBe('USER_DISABLED');
    expect(await store.db.query('SELECT id FROM sessions')).toEqual([]);
  });
  it('rejects a consumed invitation when revocation preceded the session admission read', async () => {
    const { app, sessions } = await fixture();
    const invitationVersion = 0;
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    app.get('/redeemed-invitation', (request, reply) => sessions.open(request, reply, 'friend', true, invitationVersion));
    const result = await app.inject('/redeemed-invitation');
    expect(result.statusCode).toBe(401); expect(result.json().code).toBe('SESSION_REVOKED'); expect(result.headers['set-cookie']).toBeUndefined();
    expect(await store.db.query('SELECT id FROM sessions')).toEqual([]);
  });
});
