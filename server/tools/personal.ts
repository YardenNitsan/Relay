import { randomUUID } from 'node:crypto';
import { personalOperations, type PersonalRequest } from './personal-schema.js';
export { personalTaskSchema } from './personal-schema.js';
import type { TaskOptions, ToolContext, ToolResult } from '../../shared/types.js';
import { getAssistantDefinition } from '../../shared/assistants.js';
import { authorizeOptions, type User } from '../auth/policy.js';
import { AppError } from '../core/errors.js';
import { row, workspaceScope, type Store } from '../db/store.js';
import type { Sql } from '../db/database.js';
import type { Guard } from './files.js';
import { UncertainToolEffect } from './errors.js';

interface PersonalItem { id: string; title: string; dueAt: string | null; completed: boolean; createdAt: string; updatedAt: string }
const columns = 'id,title,due_at,completed,created_at,updated_at';

/** User identity comes exclusively from the executing host task, never arguments. */
export class PersonalTasks {
  constructor(private readonly store: Store) {}

  async execute(context: ToolContext, input: unknown, guard: Guard): Promise<ToolResult> {
    const request = personalOperations.parse(input);
    if (!context.userId || !Number.isSafeInteger(context.sessionVersion) || context.sessionVersion! < 0 || !context.allowedTools.includes('personal_tasks')) throw new AppError('PERSONAL_SCOPE', 'Personal tasks require an authenticated task and account capability', 403);
    if (request.action !== 'list' && context.access !== 'workspace' && !(context.access === 'supervised' && context.approved)) throw new AppError('PERSONAL_ACCESS', 'Personal task changes need supervised approval or autonomous workspace access', 403);
    let commitStarted = false;
    try {
      const result = await this.store.db.transaction(async tx => {
        guard();
        // Keep the same lock order as task admission, stop and account changes.
        const control = (await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE', ['control']))[0]?.value as { stopped: boolean; generation: number } | undefined;
        const account = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [context.userId]))[0];
        const task = (await tx.query('SELECT * FROM tasks WHERE id=$1 AND user_id=$2 FOR UPDATE', [context.taskId, context.userId]))[0];
        if (!account || !task) throw new AppError('PERSONAL_SCOPE', 'Task ownership could not be verified', 403);
        const user = row<User>(account);
        if (!user.enabled || user.sessionVersion !== context.sessionVersion) throw new AppError('REVOKED', 'This account or task session was revoked', 403);
        if (!control || control.stopped || control.generation !== Number(task.stop_generation) || task.status !== 'executing') throw new AppError('STOPPED', 'The task is not authorized to execute', 409);
        if (!(await tx.query('SELECT id FROM conversations WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL', [task.conversation_id, context.userId])).length) throw new AppError('PERSONAL_SCOPE', 'Task conversation is no longer accessible', 403);
        const options = task.options as TaskOptions;
        if (context.access !== options.access || context.workspaceId !== options.workspaceId) throw new AppError('PERSONAL_SCOPE', 'Requested access differs from the durable task scope', 403);
        authorizeOptions({ user, remote: user.role !== 'owner', sessionId: 'personal-task-tool' }, options, await workspaceScope(tx,options.workspaceId));
        if (options.assistantId && !getAssistantDefinition(options.assistantId)?.allowedTools.includes('personal_tasks')) throw new AppError('PERSONAL_SCOPE', 'This task specialization has no personal task capability', 403);
        guard();
        const result = await this.apply(tx, context.userId!, request);
        await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES ($1,$2,$3)', [context.taskId, 'PERSONAL_TASK_ACTION', JSON.stringify({ userId: context.userId, agentId: context.agentId, action: request.action, ...result.audit })]);
        guard(); // Failure here rolls back both the operation and its audit row.
        commitStarted = request.action !== 'list';
        return result.receipt;
      });
      guard();
      return result;
    } catch (error) {
      // A failed acknowledgement after the transaction callback may follow a
      // committed write. The execution ledger must block automatic replay.
      if (commitStarted) {
        const uncertain = new UncertainToolEffect(error);
        uncertain.message = 'A personal task change may have committed, but its acknowledgement was interrupted. Inspect the personal task list before starting new work; automatic replay is blocked.';
        throw uncertain;
      }
      throw error;
    }
  }

  private async apply(tx: Sql, userId: string, request: PersonalRequest): Promise<{ receipt: ToolResult; audit: Record<string, unknown> }> {
    if (request.action === 'list') {
      if (request.cursor && !(await tx.query('SELECT id FROM personal_tasks WHERE id=$1 AND user_id=$2', [request.cursor, userId])).length) throw new AppError('PERSONAL_CURSOR', 'List cursor is no longer available. Restart the list without a cursor.', 409);
      const limit = request.limit ?? 50;
      // Resolve cursor timestamp in SQL, preserving PostgreSQL microseconds.
      const items = (await tx.query(`SELECT ${columns} FROM personal_tasks WHERE user_id=$1 AND ($2::boolean IS NULL OR completed=$2) AND ($3::text IS NULL OR (created_at,id)>((SELECT created_at FROM personal_tasks WHERE id=$3 AND user_id=$1),$3)) ORDER BY created_at,id LIMIT $4`, [userId, request.completed ?? null, request.cursor ?? null, limit + 1])).map(item => row<PersonalItem>(item));
      const more = items.length > limit; const bounded = items.slice(0, limit);
      return { audit: { count: bounded.length, more }, receipt: { content: JSON.stringify({ action: 'list', items: bounded, nextCursor: more ? bounded.at(-1)!.id : null, trust: 'untrusted', notificationsScheduled: false }), evidence: [{ kind: 'personal_task_list', summary: `Read ${bounded.length} personal task records${more ? ' (more available)' : ''}`, passed: true, details: { count: bounded.length, more, scope: 'current_user' } }] } };
    }
    let record: Record<string, unknown> | undefined;
    if (request.action === 'create') {
      const count = Number((await tx.query('SELECT COUNT(*) AS count FROM personal_tasks WHERE user_id=$1', [userId]))[0].count);
      if (count >= 1000) throw new AppError('PERSONAL_QUOTA', 'The personal task limit is 1000 records. Delete unneeded entries before creating more.', 409);
      record = (await tx.query(`INSERT INTO personal_tasks(id,user_id,title,due_at) VALUES ($1,$2,$3,$4) RETURNING ${columns}`, [randomUUID(), userId, request.title, request.dueAt ?? null]))[0];
    } else if (request.action === 'complete') {
      record = (await tx.query(`UPDATE personal_tasks SET completed=true,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING ${columns}`, [request.id, userId]))[0];
    } else {
      record = (await tx.query(`DELETE FROM personal_tasks WHERE id=$1 AND user_id=$2 RETURNING ${columns}`, [request.id, userId]))[0];
    }
    if (!record) throw new AppError('PERSONAL_NOT_FOUND', 'Personal task not found', 404);
    const item = row<PersonalItem>(record);
    const details = { action: request.action, id: item.id, completed: item.completed, notificationsScheduled: false, scope: 'current_user' };
    return { audit: { id: item.id }, receipt: { content: JSON.stringify({ action: request.action, ...(request.action === 'delete' ? { id: item.id, deleted: true } : { item }), trust: 'untrusted', notificationsScheduled: false }), evidence: [{ kind: 'personal_task_state', summary: request.action === 'create' ? 'Saved one personal task; no notification was scheduled' : request.action === 'complete' ? 'Marked one personal task complete' : 'Deleted one personal task', passed: true, details }] } };
  }
}
