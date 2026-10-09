import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { HistoryRepository, truncateUtf8 } from '../server/history/repository.js';

let store: Store, history: HistoryRepository;
beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init(); history = new HistoryRepository(store.db);
  await store.db.query("INSERT INTO users(id,name,role,permissions) VALUES ('other','Other','chat','{}')");
});
afterEach(async () => { await store.close(); });
async function message(conversationId: string, content: string, createdAt = '2026-01-01 00:00:00+00') {
  const id = randomUUID();
  await store.db.query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ($1,$2,'user',$3,$4)", [id, conversationId, content, createdAt]);
  return id;
}

describe('authorized persistent conversation history', () => {
  it('walks every conversation with equal timestamps without duplicates and is unaffected by activity reordering', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 7; index++) ids.push((await store.createConversation(`History ${index}`)).id);
    await store.db.query("UPDATE conversations SET created_at='2026-01-01 00:00:00.123456+00'");
    await store.createConversation('Other private title', 'other');
    const first = await history.conversations('owner', { limit: 2 });
    const collected = first.items.map(item => item.id);
    await store.db.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [ids[6]]);
    let cursor = first.nextCursor;
    while (cursor) { const page = await history.conversations('owner', { limit: 2, before: cursor }); collected.push(...page.items.map(item => item.id)); cursor = page.nextCursor; }
    expect(collected).toEqual([...ids].sort().reverse());
    expect(new Set(collected).size).toBe(7);
  });

  it('preserves sub-millisecond message positions and supports older/newer navigation and exact message seeking', async () => {
    const conversation = await store.createConversation();
    const ids = [];
    for (let index = 1; index <= 7; index++) ids.push(await message(conversation.id, `message ${index}`, `2026-01-01 00:00:00.12300${index}+00`));
    const latest = await history.messages('owner', conversation.id, { limit: 3 });
    expect(latest.items.map(item => item.id)).toEqual(ids.slice(4));
    const older = await history.messages('owner', conversation.id, { limit: 3, before: latest.olderCursor! });
    expect(older.items.map(item => item.id)).toEqual(ids.slice(1, 4));
    const oldest = await history.messages('owner', conversation.id, { limit: 3, before: older.olderCursor! });
    expect(oldest.items.map(item => item.id)).toEqual(ids.slice(0, 1)); expect(oldest.olderCursor).toBeNull();
    const newer = await history.messages('owner', conversation.id, { limit: 3, after: older.newerCursor! });
    expect(newer.items.map(item => item.id)).toEqual(ids.slice(4));
    expect((await history.messages('owner', conversation.id, { limit: 2, around: ids[2] })).items.map(item => item.id)).toEqual(ids.slice(1, 3));
    expect((await history.messages('owner', conversation.id, { limit: 2, beforeId: ids[2] })).items.map(item => item.id)).toEqual(ids.slice(0, 2));
    expect((await history.messages('owner', conversation.id, { limit: 2, afterId: ids[2] })).items.map(item => item.id)).toEqual(ids.slice(3, 5));
  });

  it('never exposes other-user message content through pages, search, retrieval or supplied anchors', async () => {
    const own = await store.createConversation('Own'), other = await store.createConversation('Secret', 'other');
    const otherMessage = await message(other.id, 'rarecredential private secret');
    expect((await history.search('owner', { q: 'rarecredential' })).items).toEqual([]);
    await expect(history.messages('owner', other.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(history.search('owner', { q: 'rarecredential', conversationId: other.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(history.retrieve('owner', other.id, 'rarecredential')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(history.messages('owner', own.id, { around: otherMessage })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await history.retrieve('owner', own.id, 'rarecredential'))).toEqual([]);
  });

  it('rejects malformed, cross-user, cross-conversation and cross-search cursors and excessive limits', async () => {
    const a = await store.createConversation(), b = await store.createConversation();
    await message(a.id, 'alpha beta'); await message(a.id, 'alpha beta');
    const cursor = (await history.messages('owner', a.id, { limit: 1 })).olderCursor!;
    await expect(history.messages('owner', b.id, { before: cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(history.messages('other', a.id, { before: cursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(history.messages('owner', a.id, { before: 'not!a-cursor' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const forged = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); forged.at = '2026-02-31 00:00:00+00';
    await expect(history.messages('owner', a.id, { before: Buffer.from(JSON.stringify(forged)).toString('base64url') })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(history.messages('owner', a.id, { limit: 999 })).rejects.toThrow();
    await expect(history.messages('owner', a.id, { beforeId: 'a', afterId: 'b' })).rejects.toMatchObject({ code: 'INVALID_PAGE' });
    const searchCursor = (await history.search('owner', { q: 'alpha', limit: 1 })).nextCursor!;
    await expect(history.search('owner', { q: 'beta', before: searchCursor })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('searches all stored messages and titles, accepting literal malformed query syntax safely', async () => {
    const conversation = await store.createConversation('Authentication architecture');
    const old = await message(conversation.id, 'Refresh token rotation stores the family identifier.');
    for (let index = 0; index < 205; index++) await message(conversation.id, `Later filler ${index}`, '2026-01-02 00:00:00+00');
    const found = await history.search('owner', { q: '"token rotation"' });
    expect(found.items.map(item => item.messageId)).toEqual([old]);
    expect(found.items[0].excerpt).toContain('token rotation');
    expect((await history.conversations('owner', { q: 'authentication' })).items[0].id).toBe(conversation.id);
    expect((await history.search('owner', { q: "'; DROP TABLE messages; --" })).items).toEqual([]);
    expect((await store.db.query('SELECT count(*)::int AS count FROM messages'))[0].count).toBe(206);
  });

  it('paginates equal-time search matches deterministically instead of ambiguous floating rank cursors', async () => {
    const conversation = await store.createConversation();
    const ids = [];
    for (let index = 0; index < 5; index++) ids.push(await message(conversation.id, 'token rotation'));
    const collected: string[] = []; let before: string | undefined;
    do { const page = await history.search('owner', { q: 'token', limit: 2, before }); collected.push(...page.items.map(item => item.messageId)); before = page.nextCursor ?? undefined; } while (before);
    expect(collected).toEqual(ids.sort().reverse());
  });

  it('retrieves same-conversation lexical evidence with source provenance, excludes recent messages and honors the total UTF-8 JSON budget', async () => {
    const own = await store.createConversation(), unrelated = await store.createConversation();
    const older = await message(own.id, 'refreshToken authentication ' + 'שלום 🔒 \\ " '.repeat(250));
    const recent = await message(own.id, 'refreshToken latest');
    await message(unrelated.id, 'refreshToken authentication unrelated private conversation');
    const result = await history.retrieve('owner', own.id, 'Explain refreshToken authentication', { limit: 4, maxBytes: 700, excludeMessageIds: [recent] });
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ messageId: older, conversationId: own.id, trust: 'untrusted_history', source: { kind: 'conversation_message', messageId: older, conversationId: own.id } });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(700);
    expect(result[0].excerpt).not.toContain('\uFFFD');
    expect(await history.retrieve('owner', own.id, 'refreshToken', { maxBytes: 100 })).toEqual([]);
    expect(truncateUtf8('a🔒b', 4)).toBe('a');
  });
});
