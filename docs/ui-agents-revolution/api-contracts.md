# Shared client contracts

Status: initial task-feed increment implemented locally on 2026-10-12; not deployed. This document covers the new summary feed and its existing security boundary, not completion of native authentication, every client API, or the full revolution milestone.

## Task feed v1

`GET /api/tasks?limit=40&before=<opaque cursor>` returns [TaskFeedPage](../../shared/task-feed.ts). The endpoint is read-only and includes every task status for the authenticated account, excluding tasks in deleted conversations. It adds no execution, approval or workspace authority.

```ts
interface TaskSummary {
  id: string;
  conversationId: string;
  objective: string;
  objectiveTruncated: boolean;
  status: TaskStatus;
  assistantId: AssistantId | null;
  createdAt: string;
  updatedAt: string;
}
interface TaskFeedPage {
  version: 1;
  items: TaskSummary[];
  nextCursor: string | null;
}
```

`TaskStatus` and `AssistantId` are the existing shared unions; clients should display an understandable fallback for future values. `assistantId: null` means no recognized selected specialist, including historical unknown values. A task's profile is distinct from its internal agent graph and selected model.

`objective` is an untrusted plain-text preview of at most 200 Unicode code points. `objectiveTruncated` explicitly distinguishes a shortened preview. Render it as text, preserve full IDs, and open the existing authorized task/conversation detail flow for full content. The feed never returns task options, model context, result, private error text, calls, permissions, user identity, credentials, tool arguments or logs. The database projection selects only summary fields and bounds the objective before transferring rows to application code.

`limit` defaults to 40 and accepts integers 1–80. `before` is optional, nonempty and limited to 1600 characters. Unknown query keys, repeated ambiguous values, out-of-range limits and invalid cursors are rejected. No `userId`, arbitrary filters, sort field, status selection or offsets are supported.

Items are newest-first by immutable `(created_at, id)`, both descending. The cursor retains database timestamp precision, including microseconds, while display timestamps use the existing ISO timestamp serialization. Equal creation timestamps use the full task ID as a stable tie-breaker. `updatedAt` changes do not move tasks between pages. `nextCursor: null` means no further rows at that read; clients must not synthesize or edit cursors. A new first-page refresh discovers newer tasks. Deletions and other concurrent updates can change later page contents; this is keyset navigation, not a multi-request snapshot guarantee.

## Authentication and isolation

The route uses the existing `createApp` session/Host/Origin/Fetch Metadata hooks and obtains identity only from the authenticated principal. Both `tasks.user_id` and `conversations.user_id` must match that principal, and the conversation must have `deleted_at IS NULL`. The owner sees their own task feed; this is not an owner-wide task administration API. No client-selected account identifier can broaden the query.

Cursors use the existing strict [history cursor codec](../../server/history/cursor.ts), with a separate hashed account/view scope. A cursor from another account or history view is rejected. Cursors are unsigned navigation positions; possession or modification cannot grant data access because every query repeats the account constraints. They must not be treated as bearer credentials or durable authorization.

The [Cloudflare Worker](../../deploy/cloudflare/worker.ts) already permits the canonical `/api/tasks` collection path under its existing authenticated API path rule. No Worker production code, generic route wildcard, public hostname, binding, listener or deployment configuration changed. A dedicated test verifies this path/query is forwarded only after Access validation and that absent Access identity and foreign Origin are rejected; the host remains responsible for its session and account checks. This evidence is a local fixture, not a hosted deployment acceptance result.

Native enrollment/session integration remains its own workstream. This feed does not turn an external inference token, Google provider consent, an unpaired native client or mere host reachability into browser API access.

## Errors and recovery

The existing response envelope is `{ error: string, code: string }`. This route adds no alternate error channel. Missing/expired/revoked sessions return 401; origin/security rejection retains 403. Invalid query shape/limit uses 400 `VALIDATION_ERROR`; malformed or wrong-scope cursor uses 400 `INVALID_CURSOR`. Existing rate limits and backend failures remain authoritative.

On `INVALID_CURSOR`, a client may discard its saved navigation position and explicitly refresh the first page. On account/session change, discard the prior account's summary cache and cursors. Keep last successful data distinguishable from a failed refresh; do not fabricate task completion from transport errors or disappearance from a page. Mutations and live events continue using their existing contracts.

## Implementation and evidence

Plan: [task-feed-plan.md](task-feed-plan.md). Files: [DTO](../../shared/task-feed.ts), [route](../../server/api/task-feed.ts), minimal registration in [app.ts](../../server/api/app.ts), [task-feed tests](../../tests/task-feed.test.ts), and the targeted case in [Worker tests](../../tests/cloudflare-worker.test.ts). No database schema migration was added; the response size is bounded, but no large-history latency claim is made.

Test-first red: `npm.cmd test -- tests/task-feed.test.ts --maxWorkers=1` produced **7 expected failures**, exit 1, 9.18 seconds. Each reached the real authenticated app and failed because the new collection route returned 404 instead of 200. Existing unauthenticated/origin checks already rejected those requests.

Focused green: `npm.cmd test -- tests/task-feed.test.ts tests/history.test.ts tests/history-api.test.ts tests/cloudflare-worker.test.ts --maxWorkers=1` produced **64 passed across 4 files**, exit 0, 19.29 seconds. Coverage includes live-session revocation, other-account tasks/cursors, mismatched task/conversation owners, deleted conversations, exact allowed response keys, Unicode limits, complete IDs, unknown profile fallback, timestamp ties, submillisecond positions, updates/new arrivals, default/max limits, malformed dates/cursors and unsupported query keys. `git diff --check` passed.

All data was disposable fixture data. No live model, cloud account, public deployment, full suite, build or browser fixture ran in this increment. Broader integration verification remains with the integrating agent.
