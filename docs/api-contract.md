# API contract

All browser requests same origin, `credentials: same-origin`. GET `/api/session` returns `{csrfToken,user,remote,hostName}` and sets an HttpOnly session cookie. Send `x-relay-csrf` on mutations. The remote listener additionally requires a valid signed gateway identity, an invited enabled user and matching session identity. API errors are `{error, code}`. Shared execution types live in `shared/types.ts`; account policy is defined in `server/auth/policy.ts`. Dates ISO UTC, sizes bytes, utilization 0..100, null means unknown.

- GET `/api/status` -> SystemStatus; POST `/api/stop` -> SystemStatus; POST `/api/resume` clears global stop only. Global controls require the local owner.
- GET `/api/conversations` -> Conversation[]; POST body `{title?}` -> Conversation.
- GET `/api/conversations/:id` -> ConversationDetail with snapshot cursor.
- POST `/api/conversations/:id/messages` body `{content, options: TaskOptions}` -> `{task, message}`. No user message is lost if provider unavailable; task records failure.
- GET `/api/tasks/:id` -> TaskDetail. POST `/api/tasks/:id/cancel`, `/api/tasks/:id/resume` -> TaskRecord.
- GET `/api/events?after=0` -> SSE named `activity`, JSON ActivityEvent, numeric `id`; sends persisted incremental records with heartbeat. Remote streams are ownership-filtered by the backend. The client additionally selects the visible conversation and deduplicates IDs. `Last-Event-ID` supports reconnect. Streams are bounded to four per user and 32 per host across both listeners.
- GET `/api/models` -> `{models: ModelProfile[], providers: ProviderStatus[]}`. POST `/api/providers/:id/key` body `{key, persist: boolean}` -> `{saved, storage}`; DELETE clears stored key. Never returns key.
- POST `/api/providers/:id/verify` checks reachability; POST `/api/providers/:id/enabled` body `{enabled}` changes availability. Provider administration and credentials require the local owner; remote model discovery is filtered by provider grants.
- GET `/api/hardware` -> HardwareSnapshot. POST `/api/models/assess` body `{modelId, contextTokens}` -> Admission.
- GET `/api/workspaces` -> Workspace[]. POST body `{name, sourcePath?}` -> Workspace (managed copy, source untouched).
- GET `/api/workspaces/:id/files` -> `{files: string[]}`. POST `/api/workspaces/:id/files` body `{path, content}` uploads UTF-8 text into managed workspace; bounded body.
- POST `/api/approvals/:id` body `{decision: 'allow_once'|'allow_task'|'denied'}` -> Approval.
- GET `/api/tasks/:id/changes` -> FileChange[]. POST `/api/tasks/:id/revert` body `{checkpointId}` -> `{reverted: true}` (expected content checked).

The UI may present four access levels, but `unrestricted` is disabled/unavailable until a tested host broker exists. Workspace autonomy covers managed files and available isolated commands; imported source remains untouched. No demo/fake metrics on the production path. Unknown cloud pricing is explicitly shown; a strict cost cap may reject unpriced cloud calls.

## Local owner administration

- GET/POST `/api/admin/users` lists accounts or creates `{name,email,role,permissions?}`. New accounts default to local AI, no workspaces or cloud spending. This records an allow-list entry; it does not send an email.
- POST `/api/admin/users/:id` replaces `{enabled,permissions}` and revokes existing sessions/work. POST `/api/admin/users/:id/revoke` ends sessions and cancels that user's work. The owner cannot be disabled through these routes.
- GET `/api/admin/sessions` returns active browser-session metadata without bearer cookies. POST `/api/admin/sessions/:id/revoke` ends that session; use user revocation to cancel all associated work as well.
- GET `/api/admin/tasks` lists active task metadata. POST `/api/admin/remote/stop` stops invited users' tasks while retaining local-owner work.
- GET `/api/admin/remote` returns configured/enabled/listening state, public origin, host identity and setup requirements. POST `/api/admin/remote/enabled` body `{enabled}` operates only on a configured listener. Disabling revokes remote sessions and work.

Conversations, tasks, approvals, diffs and events enforce ownership on the backend. Workspace file reads/uploads require a current workspace grant; reverting also rechecks current write authority. Creation and resume atomically recheck session version, current policy, quota and conversation occupancy. No client-supplied user ID or UI restriction grants authority.
