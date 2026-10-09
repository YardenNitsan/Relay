import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { RemoteIdentity, remoteConfig, type RemoteConfig } from '../server/auth/remote';
import { openDatabase } from '../server/db/database';
import { Store } from '../server/db/store';
import { chatPermissions } from '../server/auth/policy';

let store: Store;
let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;
const config: RemoteConfig = { publicOrigin: 'https://relay.example', issuer: 'https://team.cloudflareaccess.com', audience: 'relay', port: 4318, registration: 'approval' };
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'registration-test'; keys = createLocalJWKSet({ keys: [jwk] });
});
beforeEach(async () => { store = new Store(await openDatabase()); await store.init(); });
afterEach(async () => { await store.close(); });
async function token(email = 'new@example.com', subject = 'new-subject') {
  return new SignJWT({ email, type: 'app' }).setProtectedHeader({ alg: 'RS256', kid: 'registration-test' }).setSubject(subject).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
}
const identity = (configuration = config) => new RemoteIdentity(store, configuration, keys);

describe('optional remote requests for owner approval', () => {
  it('keeps invitation-only registration as the default and validates the opt-in setting', async () => {
    const environment = { RELAY_REMOTE_ENABLED: '1', RELAY_REMOTE_ORIGIN: config.publicOrigin, RELAY_ACCESS_ISSUER: config.issuer, RELAY_ACCESS_AUDIENCE: config.audience };
    expect(remoteConfig(environment)?.registration).toBe('invited');
    expect(remoteConfig({ ...environment, RELAY_REMOTE_REGISTRATION: 'approval' })?.registration).toBe('approval');
    expect(() => remoteConfig({ ...environment, RELAY_REMOTE_REGISTRATION: 'public' })).toThrow(/registration/i);
    await expect(identity({ ...config, registration: undefined }).authenticate(await token())).rejects.toMatchObject({ code: 'NOT_INVITED' });
    expect(await store.db.query("SELECT id FROM users WHERE role<>'owner'")).toEqual([]);
  });
  it('creates one disabled subject-bound account with no grants, session or model work', async () => {
    const assertion = await token('New@Example.com');
    await expect(identity().authenticate(assertion)).rejects.toMatchObject({ code: 'REMOTE_PENDING', status: 403 });
    await expect(identity().authenticate(assertion)).rejects.toMatchObject({ code: 'REMOTE_PENDING' });
    const users = await store.db.query("SELECT * FROM users WHERE role<>'owner'"); expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'new@example.com', role: 'chat', enabled: false, registration_status: 'pending', external_subject: `${config.issuer}|new-subject` });
    expect(users[0].permissions).toMatchObject({ providers: [], workspaceIds: [], maxAccess: 'read_only', dailyCloudBudgetUsd: 0, maxNetworkAccess: 'deny', mcpServerIds: [] });
    expect(users[0].access_requested_at).toBeTruthy();
    expect(await store.db.query('SELECT id FROM sessions')).toEqual([]);
    expect(await store.db.query('SELECT id FROM tasks')).toEqual([]);
    expect(await store.db.query("SELECT id FROM audit_events WHERE operation='REMOTE_ACCESS_REQUESTED'")).toHaveLength(1);
  });
  it('admits the same bound identity only after explicit approval and denies subsequent disablement', async () => {
    const assertion = await token(); await expect(identity().authenticate(assertion)).rejects.toMatchObject({ code: 'REMOTE_PENDING' });
    await store.db.query("UPDATE users SET registration_status='approved',enabled=true,permissions=$1 WHERE email=$2", [JSON.stringify(chatPermissions), 'new@example.com']);
    const id = await identity().authenticate(assertion); expect(id).toBeTruthy();
    await store.db.query("UPDATE users SET enabled=false,registration_status='denied' WHERE id=$1", [id]);
    await expect(identity().authenticate(assertion)).rejects.toMatchObject({ code: 'REMOTE_DENIED' });
    expect((await store.db.query('SELECT enabled,registration_status FROM users WHERE id=$1', [id]))[0]).toEqual({ enabled: false, registration_status: 'denied' });
  });
  it('does not turn a disabled invited account into another pending request', async () => {
    await store.db.query('INSERT INTO users(id,name,email,role,enabled,permissions) VALUES ($1,$2,$3,$4,false,$5)', ['disabled', 'Disabled', 'new@example.com', 'chat', JSON.stringify(chatPermissions)]);
    await expect(identity().authenticate(await token())).rejects.toMatchObject({ code: 'REMOTE_DENIED' });
    expect((await store.db.query("SELECT registration_status,external_subject FROM users WHERE id='disabled'"))[0]).toEqual({ registration_status: 'approved', external_subject: null });
  });
  it('rejects changed subjects before or after approval and never links a remote owner', async () => {
    await expect(identity().authenticate(await token())).rejects.toMatchObject({ code: 'REMOTE_PENDING' });
    await expect(identity().authenticate(await token('new@example.com', 'changed'))).rejects.toMatchObject({ code: 'IDENTITY_CHANGED' });
    await store.db.query("UPDATE users SET email='owner@example.com' WHERE id='owner'");
    await expect(identity().authenticate(await token('owner@example.com'))).rejects.toMatchObject({ code: 'NOT_INVITED' });
    expect((await store.db.query("SELECT external_subject FROM users WHERE id='owner'"))[0].external_subject).toBeNull();
  });
  it('commits only one pending account and audit record during concurrent first requests', async () => {
    const assertion = await token();
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => identity().authenticate(assertion)));
    expect(attempts.every(attempt => attempt.status === 'rejected' && attempt.reason.code === 'REMOTE_PENDING')).toBe(true);
    expect(await store.db.query("SELECT id FROM users WHERE role<>'owner'")).toHaveLength(1);
    expect(await store.db.query("SELECT id FROM audit_events WHERE operation='REMOTE_ACCESS_REQUESTED'")).toHaveLength(1);
  });
  it('requires a valid bounded signed identity before creating any record', async () => {
    const assertion = await token();
    for (const value of [undefined, `${assertion.slice(0, -5)}wrong`, await token('not-an-email'), await token('x@example.com', 'x'.repeat(513))]) {
      await expect(identity().authenticate(value)).rejects.toMatchObject({ code: 'REMOTE_AUTH' });
    }
    expect(await store.db.query("SELECT id FROM users WHERE role<>'owner'")).toEqual([]);
  });
  it.each([{ count: 100, state: 'pending' }, { count: 1000, state: 'approved' }])('bounds registration when $count accounts are $state', async ({ count, state }) => {
    await store.db.query("INSERT INTO users(id,name,email,role,enabled,permissions,registration_status) SELECT 'capacity-'||n,'Capacity','capacity-'||n||'@example.com','chat',false,$1,$2 FROM generate_series(1,$3) AS n", [JSON.stringify(chatPermissions), state, count]);
    await expect(identity().authenticate(await token())).rejects.toMatchObject({ code: 'REMOTE_REGISTRATION_LIMIT', status: 429 });
    expect(await store.db.query("SELECT id FROM users WHERE email='new@example.com'")).toEqual([]);
  });
});
