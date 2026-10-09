import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Principal } from '../auth/policy.js';
import type { Store } from '../db/store.js';
import { HistoryRepository } from '../history/repository.js';

const cursor = z.string().min(1).max(1600).optional();
const limit = z.coerce.number().int().min(1).max(80).optional();
const id = z.string().uuid();
export function registerHistoryRoutes(app: FastifyInstance, store: Store, principal: (request: FastifyRequest) => Principal) {
  const history = new HistoryRepository(store.db);
  app.get('/api/history/conversations', request => history.conversations(principal(request).user.id, z.object({ limit, before: cursor, q: z.string().max(240).optional() }).strict().parse(request.query)));
  app.get('/api/history/conversations/:id/messages', request => {
    const conversationId = z.object({ id }).parse(request.params).id;
    const query = z.object({ limit, before: cursor, after: cursor, beforeId: id.optional(), afterId: id.optional(), around: id.optional() }).strict().parse(request.query);
    return history.messages(principal(request).user.id, conversationId, query);
  });
  app.get('/api/history/search', request => history.search(principal(request).user.id, z.object({ q: z.string().trim().min(1).max(240), conversationId: id.optional(), limit, before: cursor }).strict().parse(request.query)));
}
