import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getAssistantDefinition } from '../../shared/assistants.js';
import type { TaskFeedPage, TaskSummary } from '../../shared/task-feed.js';
import type { Principal } from '../auth/policy.js';
import { row, type Store } from '../db/store.js';
import { decodeCursor, encodeCursor } from '../history/cursor.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(80).default(40),
  before: z.string().min(1).max(1600).optional(),
}).strict();

export function registerTaskFeedRoutes(app: FastifyInstance, store: Store, principal: (request: FastifyRequest) => Principal) {
  app.get('/api/tasks', async (request): Promise<TaskFeedPage> => {
    const userId = principal(request).user.id;
    const { limit, before } = querySchema.parse(request.query);
    const scope = createHash('sha256').update(JSON.stringify([userId, 'task-feed-v1'])).digest('hex');
    const position = decodeCursor(before, scope);
    const records = await store.db.query(`SELECT t.id,t.conversation_id,left(t.objective,200) AS objective,
      char_length(t.objective)>200 AS objective_truncated,t.status,t.options->>'assistantId' AS assistant_id,
      t.created_at,t.updated_at,t.created_at::text AS cursor_at
      FROM tasks t JOIN conversations c ON c.id=t.conversation_id
      WHERE t.user_id=$1 AND c.user_id=$1 AND c.deleted_at IS NULL
      AND ($2::timestamptz IS NULL OR (t.created_at,t.id)<($2::timestamptz,$3::text))
      ORDER BY t.created_at DESC,t.id DESC LIMIT $4`, [userId, position?.at ?? null, position?.id ?? null, limit + 1]);
    const selected = records.slice(0, limit), last = selected[selected.length - 1];
    return {
      version: 1,
      items: selected.map(record => {
        const { cursor_at: _cursor, ...summary } = record;
        return { ...row<TaskSummary>(summary), assistantId: getAssistantDefinition(String(record.assistant_id ?? ''))?.id ?? null };
      }),
      nextCursor: records.length > limit ? encodeCursor(scope, { at: String(last.cursor_at), id: String(last.id) }) : null,
    };
  });
}
