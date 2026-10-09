import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { LanInvitations } from '../server/auth/lan';
import { openDatabase } from '../server/db/database';
import { Store } from '../server/db/store';
import { chatPermissions } from '../server/auth/policy';

let store: Store;
let invitations: LanInvitations;
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init();
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)', ['friend', 'chat', JSON.stringify(chatPermissions)]);
  invitations = new LanInvitations(store);
});
afterEach(async () => { await store.close(); });

describe('account-bound LAN invitations', () => {
  it('stores only a token digest and returns a five-minute single-use invitation', async () => {
    const invitation = await invitations.issue('friend');
    expect(invitation.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(invitation.expiresAt) - Date.now()).toBeGreaterThan(290_000);
    expect(Date.parse(invitation.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    const records = await store.db.query('SELECT * FROM lan_invitations');
    expect(records).toHaveLength(1); expect(records[0]).toMatchObject({ token_hash: digest(invitation.token), user_id: 'friend', session_version: 0 });
    expect(JSON.stringify(records)).not.toContain(invitation.token);
    expect(await invitations.redeem(invitation.token)).toEqual({ userId: 'friend', sessionVersion: 0 });
    await expect(invitations.redeem(invitation.token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID', status: 401 });
    const audit = await store.db.query('SELECT operation,metadata FROM audit_events');
    expect(audit.map(record => record.operation)).toEqual(['LAN_INVITATION_CREATED', 'LAN_INVITATION_REDEEMED']);
    expect(JSON.stringify(audit)).not.toContain(invitation.token); expect(JSON.stringify(audit)).not.toContain(digest(invitation.token));
  });
  it('permits exactly one concurrent redemption across broker instances', async () => {
    const { token } = await invitations.issue('friend');
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => new LanInvitations(store).redeem(token)));
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(attempt => attempt.status === 'rejected' && attempt.reason.code === 'LAN_INVITATION_INVALID')).toHaveLength(4);
    expect(await store.db.query('SELECT * FROM lan_invitations')).toEqual([]);
  });
  it('never issues invitations for owner, unknown, disabled or pending accounts', async () => {
    for (const id of ['owner', 'unknown']) await expect(invitations.issue(id)).rejects.toMatchObject({ code: 'LAN_INVITATION_DENIED' });
    await store.db.query("UPDATE users SET enabled=false WHERE id='friend'");
    await expect(invitations.issue('friend')).rejects.toMatchObject({ code: 'LAN_INVITATION_DENIED' });
    await store.db.query("UPDATE users SET enabled=true,registration_status='pending' WHERE id='friend'");
    await expect(invitations.issue('friend')).rejects.toMatchObject({ code: 'LAN_INVITATION_DENIED' });
    expect(await store.db.query('SELECT * FROM lan_invitations')).toEqual([]);
  });
  it('rejects malformed, invented and expired invitations without choosing another account', async () => {
    for (const token of ['', '../escape', 'x'.repeat(2000), 'x'.repeat(43)]) await expect(invitations.redeem(token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID' });
    const expired = await invitations.issue('friend');
    await store.db.query('UPDATE lan_invitations SET expires_at=clock_timestamp()-interval \'1 second\' WHERE token_hash=$1', [digest(expired.token)]);
    await expect(invitations.redeem(expired.token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID' });
    expect(await store.db.query('SELECT id FROM sessions')).toEqual([]);
  });
  it('invalidates unused invitations on account-session revocation', async () => {
    const old = await invitations.issue('friend');
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    await expect(invitations.redeem(old.token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID' });
    const current = await invitations.issue('friend');
    expect(await invitations.redeem(current.token)).toEqual({ userId: 'friend', sessionVersion: 1 });
  });
  it('rechecks account disablement and never revives a consumed invitation', async () => {
    const invitation = await invitations.issue('friend');
    await store.db.query("UPDATE users SET enabled=false WHERE id='friend'");
    await expect(invitations.redeem(invitation.token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID' });
    await store.db.query("UPDATE users SET enabled=true WHERE id='friend'");
    await expect(invitations.redeem(invitation.token)).rejects.toMatchObject({ code: 'LAN_INVITATION_INVALID' });
  });
  it('caps pending invitations atomically per account and preserves already issued codes', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, () => new LanInvitations(store).issue('friend')));
    const issued = attempts.filter(attempt => attempt.status === 'fulfilled');
    expect(issued).toHaveLength(8);
    expect(attempts.filter(attempt => attempt.status === 'rejected' && attempt.reason.code === 'LAN_INVITATION_LIMIT')).toHaveLength(4);
    expect(await store.db.query('SELECT * FROM lan_invitations')).toHaveLength(8);
    if (issued[0].status === 'fulfilled') expect(await invitations.redeem(issued[0].value.token)).toEqual({ userId: 'friend', sessionVersion: 0 });
  });
  it('bounds global storage and cleans expired rows before issuing', async () => {
    await store.db.query("INSERT INTO lan_invitations(token_hash,user_id,session_version,expires_at) SELECT md5(n::text)||md5(n::text),'friend',0,clock_timestamp()+interval '1 minute' FROM generate_series(1,1000) AS n");
    await expect(invitations.issue('friend')).rejects.toMatchObject({ code: 'LAN_INVITATION_LIMIT' });
    await store.db.query("UPDATE lan_invitations SET expires_at=clock_timestamp()-interval '1 second'");
    const next = await invitations.issue('friend');
    expect(await store.db.query('SELECT * FROM lan_invitations')).toHaveLength(1);
    expect(await invitations.redeem(next.token)).toEqual({ userId: 'friend', sessionVersion: 0 });
  });
});
