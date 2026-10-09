import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Conversation, Message, TaskRecord } from '../../shared/types.js';
import type { ConversationPage, HistoryMatch, HistorySearchPage, MessagePage, RetrievedHistory } from '../../shared/history.js';
import type { Database, Sql } from '../db/database.js';
import { row } from '../db/store.js';
import { AppError } from '../core/errors.js';
import { decodeCursor, encodeCursor, type Position } from './cursor.js';

const limitSchema = z.number().int().min(1).max(80);
const querySchema = z.string().trim().max(240);
const scope = (...values: string[]) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const position = (record: Record<string, unknown>): Position => ({ at: String(record.cursor_at), id: String(record.id) });
const plain = <T>(record: Record<string, unknown>): T => { const { cursor_at: _position, ...result } = record; return row<T>(result); };
const invalidDirection = () => new AppError('INVALID_PAGE', 'Choose one history direction or a message to locate.', 400);

export function truncateUtf8(value: string, bytes: number): string {
  let result = '', used = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character);
    if (used + size > bytes) break;
    result += character; used += size;
  }
  return result;
}
function excerpt(content: string, query: string, budget = 600): string {
  const words = query.match(/[\p{L}\p{N}_]{2,}/gu) ?? [];
  const lower = content.toLocaleLowerCase();
  const indexes = words.map(word => lower.indexOf(word.toLocaleLowerCase())).filter(index => index >= 0);
  let start = indexes.length ? Math.max(0, Math.min(...indexes) - 90) : 0;
  // A context prefix measured in UTF-16 units must not split a surrogate pair.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(content[start])) start--;
  return truncateUtf8(`${start ? '…' : ''}${content.slice(start)}`, budget);
}
async function ownsConversation(sql: Sql, userId: string, conversationId: string) {
  if (!(await sql.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2', [conversationId, userId])).length) throw new AppError('NOT_FOUND', 'Conversation not found', 404);
}

export class HistoryRepository {
  constructor(private readonly db: Database) {}

  async conversations(userId: string, options: { limit?: number; before?: string; q?: string } = {}): Promise<ConversationPage> {
    const limit = limitSchema.parse(options.limit ?? 40), q = querySchema.parse(options.q ?? '');
    const cursorScope = scope(userId, 'conversations', q), before = decodeCursor(options.before, cursorScope);
    const records = await this.db.query(`SELECT c.*,c.created_at::text AS cursor_at FROM conversations c
      WHERE c.user_id=$1 AND ($2='' OR to_tsvector('simple',c.title) @@ websearch_to_tsquery('simple',$2))
      AND ($3::timestamptz IS NULL OR (c.created_at,c.id)<($3::timestamptz,$4::text))
      ORDER BY c.created_at DESC,c.id DESC LIMIT $5`, [userId, q, before?.at ?? null, before?.id ?? null, limit + 1]);
    const selected = records.slice(0, limit);
    return { items: selected.map(record => plain<Conversation>(record)), nextCursor: records.length > limit ? encodeCursor(cursorScope, position(selected[selected.length - 1])) : null };
  }

  async messages(userId: string, conversationId: string, options: { limit?: number; before?: string; after?: string; beforeId?: string; afterId?: string; around?: string } = {}): Promise<MessagePage> {
    const limit = limitSchema.parse(options.limit ?? 80);
    if ([options.before, options.after, options.beforeId, options.afterId, options.around].filter(Boolean).length > 1) throw invalidDirection();
    const cursorScope = scope(userId, 'messages', conversationId);
    let anchor = decodeCursor(options.before ?? options.after, cursorScope);
    const forward = Boolean(options.after || options.afterId);
    return this.db.transaction(async tx => {
      await ownsConversation(tx, userId, conversationId);
      const anchorId = options.beforeId ?? options.afterId ?? options.around;
      if (anchorId) {
        const found = (await tx.query('SELECT id,created_at::text AS cursor_at FROM messages WHERE id=$1 AND conversation_id=$2', [anchorId, conversationId]))[0];
        if (!found) throw new AppError('NOT_FOUND', 'Message not found in this conversation', 404);
        anchor = position(found);
      }
      const operator = forward ? '>' : options.around ? '<=' : '<';
      const order = forward ? 'ASC' : 'DESC';
      const records = await tx.query(`SELECT m.*,m.created_at::text AS cursor_at FROM messages m JOIN conversations c ON c.id=m.conversation_id
        WHERE c.user_id=$1 AND m.conversation_id=$2 AND ($3::timestamptz IS NULL OR (m.created_at,m.id)${operator}($3::timestamptz,$4::text))
        ORDER BY m.created_at ${order},m.id ${order} LIMIT $5`, [userId, conversationId, anchor?.at ?? null, anchor?.id ?? null, limit]);
      if (!forward) records.reverse();
      if (!records.length) return { items: [], tasks: [], olderCursor: null, newerCursor: null };
      const first = position(records[0]), last = position(records[records.length - 1]);
      const bounds = (await tx.query(`SELECT
        EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND (created_at,id)<($2::timestamptz,$3::text)) AS older,
        EXISTS(SELECT 1 FROM messages WHERE conversation_id=$1 AND (created_at,id)>($4::timestamptz,$5::text)) AS newer`, [conversationId, first.at, first.id, last.at, last.id]))[0];
      const taskIds = [...new Set(records.map(record => record.task_id).filter(value => typeof value === 'string'))];
      const tasks = taskIds.length ? (await tx.query('SELECT * FROM tasks WHERE conversation_id=$1 AND user_id=$2 AND id=ANY($3::text[])', [conversationId, userId, taskIds])).map(record => row<TaskRecord>(record)) : [];
      return { items: records.map(record => plain<Message>(record)), tasks, olderCursor: bounds.older ? encodeCursor(cursorScope, first) : null, newerCursor: bounds.newer ? encodeCursor(cursorScope, last) : null };
    });
  }

  async search(userId: string, options: { q: string; conversationId?: string; limit?: number; before?: string }): Promise<HistorySearchPage> {
    const q = querySchema.min(1).parse(options.q), limit = limitSchema.parse(options.limit ?? 20);
    const cursorScope = scope(userId, 'search', options.conversationId ?? '', q), before = decodeCursor(options.before, cursorScope);
    if (options.conversationId) await ownsConversation(this.db, userId, options.conversationId);
    const records = await this.db.query(`SELECT m.*,c.title AS conversation_title,m.created_at::text AS cursor_at FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.user_id=$1 AND ($2::text IS NULL OR c.id=$2) AND to_tsvector('simple',m.content) @@ websearch_to_tsquery('simple',$3)
      AND ($4::timestamptz IS NULL OR (m.created_at,m.id)<($4::timestamptz,$5::text)) ORDER BY m.created_at DESC,m.id DESC LIMIT $6`, [userId, options.conversationId ?? null, q, before?.at ?? null, before?.id ?? null, limit + 1]);
    const selected = records.slice(0, limit);
    const items = selected.map(record => {
      const message = row<Message>(record);
      return { messageId: message.id, conversationId: message.conversationId, taskId: message.taskId, role: message.role, createdAt: message.createdAt, conversationTitle: String(record.conversation_title), excerpt: excerpt(message.content, q) } satisfies HistoryMatch;
    });
    return { items, nextCursor: records.length > limit ? encodeCursor(cursorScope, position(selected[selected.length - 1])) : null };
  }

  /** Same-conversation lexical recall. Callers retain egress checks and context budgets. */
  async retrieve(userId: string, conversationId: string, query: string, options: { limit?: number; maxBytes?: number; excludeMessageIds?: string[] } = {}): Promise<RetrievedHistory[]> {
    const limit = z.number().int().min(1).max(8).parse(options.limit ?? 4);
    const maxBytes = z.number().int().min(0).max(16384).parse(options.maxBytes ?? 2000);
    const excluded = z.array(z.string().max(200)).max(200).parse(options.excludeMessageIds ?? []);
    await ownsConversation(this.db, userId, conversationId);
    // Treat objective words as literals, never as authored tsquery operators.
    const words = [...new Set((query.match(/[\p{L}\p{N}_]{3,}/gu) ?? []).map(word => word.toLocaleLowerCase()))].slice(0, 16);
    if (!words.length || maxBytes < 128) return [];
    const lexical = words.map(word => `"${word.slice(0, 60)}"`).join(' OR ');
    const records = await this.db.query(`SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.user_id=$1 AND c.id=$2 AND NOT(m.id=ANY($3::text[])) AND to_tsvector('simple',m.content) @@ websearch_to_tsquery('simple',$4)
      ORDER BY ts_rank_cd(to_tsvector('simple',m.content),websearch_to_tsquery('simple',$4)) DESC,m.created_at DESC,m.id DESC LIMIT $5`, [userId, conversationId, excluded, lexical, limit]);
    const selected: RetrievedHistory[] = [];
    for (const record of records) {
      const message = row<Message>(record);
      const source: RetrievedHistory = { messageId: message.id, conversationId, role: message.role, createdAt: message.createdAt, excerpt: '', source: { kind: 'conversation_message', messageId: message.id, conversationId, taskId: message.taskId }, trust: 'untrusted_history' };
      const overhead = Buffer.byteLength(JSON.stringify([...selected, source]));
      if (overhead >= maxBytes) break;
      source.excerpt = excerpt(message.content, lexical, Math.min(900, maxBytes - overhead));
      // JSON escaping can cost more than the original UTF-8 text.
      while (source.excerpt && Buffer.byteLength(JSON.stringify([...selected, source])) > maxBytes) source.excerpt = Array.from(source.excerpt).slice(0, -1).join('');
      if (source.excerpt) selected.push(source);
    }
    return selected;
  }
}
