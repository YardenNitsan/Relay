# Account task-feed implementation plan

Goal: let web and native agent work lists load bounded, factual task summaries through the existing authenticated Relay Host API. This is the authorized phase-six shared-contract increment, not a new authentication transport.

Contract: `GET /api/tasks?limit=40&before=<opaque cursor>` returns `TaskFeedPage { version: 1, items: TaskSummary[], nextCursor: string | null }`. `TaskSummary` contains only full `id`, `conversationId`, `objective` (at most 200 Unicode code points), `objectiveTruncated`, `status`, nullable `assistantId`, `createdAt`, and `updatedAt`. Default limit 40, inclusive range 1–80; unknown query fields are rejected. All statuses are included. No status filter or new mutation is needed.

Implementation: create `shared/task-feed.ts` and `server/api/task-feed.ts`; add one route registration/import in `server/api/app.ts`. Reuse `server/history/cursor.ts`, with a distinct account-and-view scope. Select only explicit summary columns, bound objective text in SQL, require both task and conversation ownership, and exclude soft-deleted conversations. Order and seek by immutable `(created_at, id)` descending, retaining database microseconds in cursors. Do not fetch options/result/errors or return database objects wholesale. Cursors are navigation positions, not authorization.

1. Add `tests/task-feed.test.ts` using the real app/session/Store with disposable data and no inference. Prove unauthenticated/revoked/origin rejection, account isolation, deleted-conversation exclusion, cursor scoping and malformed cursor rejection, strict bounded query limits, timestamp ties/submillisecond pagination and absent private fields.
2. Run this test file before implementation; verify failures reflect the missing endpoint rather than broken fixtures.
3. Implement the minimal DTO and route. Preserve shared session/security hooks and parameterized SQL; no client-supplied identity or endpoint-specific authentication bypass.
4. Run focused task-feed/history/API tests and diff checks. Record exact outcomes in `api-contracts.md`. Integration owns full checks/build/browser and any later workload-driven indexing; this increment adds no migration, model invocation or deployment.

Review focus: same-time tasks never repeat/vanish across pages; recent updates cannot reorder pagination; cross-account or another-view cursor never broadens scope; Unicode truncation preserves complete code points and full IDs; absent/unknown historical assistant identity maps to null; authorized callers can read only their own live-conversation summaries.
