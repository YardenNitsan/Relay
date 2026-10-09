# Persistent history and local lexical recall

History is stored completely in normalized conversation/message rows. The browser's recent conversation response remains bounded for live activity. Dedicated history endpoints let the user reach older records without sending every saved message or mounting an ever-growing transcript.

## API and ownership

- `GET /api/history/conversations?limit=40&before=…&q=…` lists owned conversations, optionally searching their titles.
- `GET /api/history/conversations/:id/messages?limit=80&before=…` reads an older message page. `after` moves forward; `around`, `beforeId`, or `afterId` resolve an exact authorized message position. Only one anchor may be supplied.
- `GET /api/history/search?q=…&limit=40&before=…` searches all messages owned by the authenticated user. An optional `conversationId` narrows the scope.

All queries enforce user ownership in the backend. Even the local owner cannot use these ordinary history routes to read another user's private conversations. Authentication, origin checks, host validation and request limits apply through the normal API boundary. Limits are capped at 80; search input is capped at 240 characters. Search excerpts are plain text, never trusted HTML.

Pages use keyset cursors over `(created_at, id)`. PostgreSQL's full timestamp precision is encoded as text; converting the cursor through a JavaScript `Date` would lose sub-millisecond precision and could skip messages. Equal timestamps are ordered by unique IDs. Cursors are scoped to the user, view, conversation and query. They are positioning data, not credentials. Each request independently checks ownership.

Conversation pages are ordered by creation time, explicitly labelled in the interface. Updating a conversation does not reorder records between pages. New message pages may include newly appended messages when moving forward. Pagination is not a frozen database snapshot. Deletion returns the history view to page one; deleted rows are excluded from title search, message search, message navigation and context retrieval.

## Creation and deletion

The browser starts a conversation and its first objective in one transaction through `POST /api/conversations/start`. A per-draft request (UUID, objective and execution options) survives a lost response and page reload; repeating the same request returns the original task. Changed payloads cannot reuse an accepted request. Failed task admission rolls back the conversation, so retries do not leave empty duplicates.

Conversation history offers a trash control and a named confirmation. `DELETE /api/conversations/:id` checks ownership and CSRF and serializes with task admission. Unfinished tasks, including paused tasks, must be stopped first. Deleting the selected conversation clears its browser draft and opens the empty composer. Other conversation drafts remain intact.

Deletion is a persistent tombstone, not secure data erasure: the host retains stored messages and execution records for audit, recovery and usage accounting. Normal conversation, history, retrieval and user-scoped task APIs cannot reopen the deleted record. Workspace files and checkpoints are not removed. There is currently no restore or permanent-purge UI.

## Search and model context

PostgreSQL `to_tsvector('simple', …)` and `websearch_to_tsquery('simple', …)` provide local full-text matching. Supported input includes phrases, `OR`, and exclusion terms. The simple dictionary retains words without English-specific stemming; this is lexical search, not semantic similarity, and does not promise language-specific segmentation.

Search results use stable newest-first cursors. Internal `HistoryRepository.retrieve(userId, conversationId, objective, options)` uses lexical rank to find up to four older messages in the **same conversation**. Recent message IDs are excluded by the caller. Results include message/conversation/task source references and `trust: 'untrusted_history'`. The entire serialized result, including metadata and JSON escaping, respects its UTF-8 byte budget. Unicode truncation preserves code points.

The orchestrator remains responsible for model context allocation and cloud-egress policy. Retrieved text cannot authorize tools, change instructions or grant access. Retrieval does not cross into an unrelated conversation merely because the user owns it. No embeddings, generated summaries or external search service are required.

## Browser behavior

History has explicit title/message search, previous/next pages, empty states and retryable failures. Message results open an exact message URL, survive reload, and focus the located message for keyboard users. The conversation reader renders at most 80 saved messages per page; earlier/newer navigation replaces the page. Return to latest restores normal streaming and follow behavior. Old task receipts preserve their associated task record for activity inspection.

At phone widths search inputs occupy their own row, all paging controls retain touch targets, and excerpts wrap. The normal conversation composer remains available. Search and history are progressively disclosed in the existing navigation surface rather than permanently occupying chat space.

## Research and decisions

- PostgreSQL requires a unique deterministic ordering for reliable paginated subsets: [LIMIT and OFFSET](https://www.postgresql.org/docs/current/queries-limit.html). Keyset pagination avoids deep offset scans and activity-induced reordering.
- PostgreSQL documents safe web-style user query parsing and the distinction between lexical ranking and matching: [Controlling text search](https://www.postgresql.org/docs/current/textsearch-controls.html).
- PostgreSQL recommends GIN for full-text search indexes: [Preferred index types](https://www.postgresql.org/docs/current/textsearch-indexes.html). Expression indexes use the same explicit `simple` configuration as queries.
- React recommends deriving state and avoiding duplicated representations: [Choosing the state structure](https://react.dev/learn/choosing-the-state-structure). Query keys own page data; navigation owns only scope/query/cursors and the selected message.
- [TanStack's infinite query guidance](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) describes page retention and refetch costs. Relay uses explicit bounded page replacement to keep long professional transcripts from accumulating an enormous DOM.

## Verification

Repository tests use a real PostgreSQL-compatible PGlite database and exercise equal timestamps, microsecond timestamps, bidirectional pages, exact seeking, cross-user isolation, scoped cursor rejection, malformed search syntax, old messages beyond recent limits and serialized multibyte retrieval budgets. HTTP tests verify pairing, origin restrictions, input caps and guessed private IDs. Browser tests seed clearly labelled test-only historical data and walk past the former 100-conversation/200-message limits, search an old message at 320px, reload its deep link, and check accessibility. These fixtures are never loaded by the production service.
