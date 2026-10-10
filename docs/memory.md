# Approved personal and project memory

Relay stores explicit notes created and confirmed by the signed-in user. A note with `workspaceId: null` is a personal preference; a note with a workspace ID is private to that user and relevant to that project. Project notes are not automatically shared with other workspace members. There is no model-authored promotion, background collection, embedding generation, vector service or cross-account retrieval.

Each account can keep at most 128 notes, including disabled notes. Titles allow 120 characters and content allows 4,096; empty values and NUL characters are rejected. Creating and updating through the browser API requires `confirm: true`. Notes retain a stable ID, timestamps and an increasing revision. Updates and deletes must supply the revision the user reviewed; a competing change returns `MEMORY_CONFLICT` instead of overwriting it. Scope and ownership cannot be changed by editing a note.

`MemoryRepository` reloads and locks durable account authorization for every operation. Disabled or pending accounts and revoked session versions fail closed. Project reads, writes and context retrieval recheck current workspace ownership and grants under a workspace lock. Listing and exporting exclude project notes the account can no longer read. A user can still delete their own note by known ID and revision after project access is revoked; that deletion returns no private content. Another account, including the local owner, cannot inspect or delete someone else's memory through these APIs. A local owner still controls the host and database itself.

The API is registered behind Relay's existing session, origin, CSRF and request-limit protections:

| Operation | Request |
| --- | --- |
| List accessible notes | `GET /api/memory` |
| Inspect a note | `GET /api/memory/:id` |
| Export accessible notes | `GET /api/memory/export` returns `{version:1,notes:[...]}` |
| Create | `POST /api/memory` with `{workspaceId,title,content,enabled,confirm:true}` |
| Update | `PUT /api/memory/:id` with `{revision,title,content,enabled,confirm:true}` |
| Delete | `DELETE /api/memory/:id` with `{revision}` |

The engine-facing `context(principal, workspaceId)` returns at most 2 KiB of UTF-8 user-message text. It selects enabled notes for the current project and personal preferences, prioritizes project notes and recent edits, and includes at most four attributable excerpts of up to 600 Unicode codepoints each. Excerpts identify note ID, revision and scope; truncation and omitted counts are explicit. This is deterministic bounded selection, not a relevance benchmark or semantic search. Disabled notes remain inspectable and exportable but are excluded from newly prepared context.

Memory is untrusted reference data, never a system instruction, permission grant or verified fact. The caller must include the whole wrapper in prompt-budget accounting and may drop optional memory before mandatory task/recovery context. Existing task authorization, cloud-sharing policy and final inference-boundary revocation checks still apply. Memory can contain private information; it should be sent to a cloud provider only within that task's already authorized context-sharing policy.

Migration 7 creates `memory_notes` with user/workspace foreign keys, length checks and revision constraints. Account-row locking serializes concurrent quota checks and edits. The database backup includes this table; memory is ordinary sensitive stored content, not an encrypted credential vault. Disabling or deleting a note affects future retrieval; it does not rewrite prior conversation messages, saved model-call contexts, checkpoints or exported backups. Their normal retention and deletion policies still apply. Project revocation hides content rather than automatically deleting it.

Deterministic PGlite tests cover account isolation, current workspace grants, session revocation, disabled/pending accounts, concurrent capacity and revision conflicts, deletion after revocation, bounded Unicode-safe user context and explicit API confirmation. Live provider use, native PostgreSQL concurrency and browser interaction require their separate integration checks. Personal/project memory does not establish external email/calendar connectors or autonomous scheduling.
