# API contract

All browser requests same origin, `credentials: same-origin`. GET `/api/session` returns `{csrfToken,user,remote,hostName}` for an authenticated session; an unpaired local browser receives `401 PAIRING_REQUIRED`. Native loopback access does not grant owner authority. POST `/api/session/pair` exchanges a five-minute, one-use OS-account-delivered `{token}` for an HttpOnly local session cookie; an exact local Origin is required and the remote listener rejects this endpoint. Send `x-relay-csrf` on subsequent mutations. The remote listener requires a valid signed gateway identity, an invited enabled user and matching session identity. API errors are `{error, code}`. Shared execution types live in `shared/types.ts`; account policy is defined in `server/auth/policy.ts`. Dates ISO UTC, sizes bytes, utilization 0..100, null means unknown.

- GET `/api/status` -> SystemStatus; POST `/api/stop` -> SystemStatus; POST `/api/resume` clears global stop only. Global controls require the local owner.
- GET `/api/conversations` -> Conversation[]; POST body `{title?}` -> Conversation.
- GET `/api/conversations/:id` -> ConversationDetail with snapshot cursor.
- POST `/api/conversations/:id/messages` body `{content, options: TaskOptions}` -> `{task, message}`. No user message is lost if provider unavailable; task records failure.
- GET `/api/tasks/:id` -> TaskDetail. POST `/api/tasks/:id/cancel`, `/api/tasks/:id/resume` -> TaskRecord.
- GET `/api/events?after=0` -> SSE named `activity`, JSON ActivityEvent, numeric `id`; sends persisted incremental records with heartbeat. Remote streams are ownership-filtered by the backend. The client additionally selects the visible conversation and deduplicates IDs. `Last-Event-ID` supports reconnect. Streams are bounded to four per user and 32 per host across both listeners.
- GET `/api/models` -> `{models: ModelProfile[], providers: ProviderStatus[]}`. POST `/api/providers/:id/key` body `{key, persist: boolean}` -> `{saved, storage}`; DELETE clears stored key. Never returns key.
- POST `/api/providers/:id/verify` checks reachability; POST `/api/providers/:id/enabled` body `{enabled}` changes availability. Each authenticated user manages their own permitted provider connections; credentials and discovery are account-scoped. Host configuration remains local-owner-only.
- GET `/api/hardware` -> HardwareSnapshot. POST `/api/models/assess` body `{modelId, contextTokens}` -> Admission.
- GET `/api/hardware/policy` -> `{policy,profiles,bounds}`; POST accepts the policy object itself and returns the updated state. All presets retain hard minimum reserves; subsequent model admission reads the saved policy.
- GET `/api/models/resident` -> runtime-reported residency with observed/unavailable/disabled state, timestamp and optional allocation/context fields. Missing measurements are null. Both resource administration endpoints require the local owner.
- GET `/api/workspaces` -> authorized Workspace[]. POST body `{name, sourcePath?, personal?}` -> Workspace. Remote accounts create private workspaces; the local owner can request `personal: true` or import a host source into a managed copy. Personal ownership is immutable, and personal imports cannot specify host source paths.
- GET `/api/workspaces/:id/files` -> `{files: string[]}`. POST `/api/workspaces/:id/files` body `{path, content}` uploads UTF-8 text into managed workspace; bounded body.
- POST `/api/approvals/:id` body `{decision: 'allow_once'|'allow_task'|'denied'}` -> Approval.
- GET `/api/tasks/:id/changes` -> FileChange[]. POST `/api/tasks/:id/revert` body `{checkpointId}` -> `{reverted: true}` (expected content checked).

The local owner can explicitly confirm `unrestricted` with `hostAccessConfirmed: true` for bounded direct host-file operations. It does not authorize arbitrary host commands. Workspace autonomy covers managed files and available isolated commands; imported source remains untouched. Owned personal workspaces allow their users to choose read-only, supervised or autonomous agent access independently of shared-folder grants. No demo/fake metrics appear on the production path. Unknown cloud pricing is explicitly shown; a strict cost cap may reject unpriced cloud calls.

## 0.1.1 additions

- POST `/api/conversations/start` atomically admits the first message/task with `{requestId,content,options}`. Retrying the same idempotent request does not create a second conversation.
- DELETE `/api/conversations/:id` hides the owned conversation from history/search; unfinished work prevents deletion. Audit records and workspace files remain.
- GET `/api/models?refreshLocal=1` requests coalesced, rate-limited local-runtime discovery. It does not scan arbitrary network addresses or expose another account's cloud models.
- GET `/api/assistants` returns role capabilities and explicit integration limitations. Role definitions never grant authority.
- GET `/api/usage` returns the signed-in account's recorded usage and provider-reported rate observations, not invented subscription balances.
- GET `/api/workspaces/:id/file?path=...` reads content and SHA-256. PUT/DELETE on the file route require the current expected hash. Manual private-file management is separate from the agent's selected access mode.
- POST `/api/workspaces/:id/documents` accepts `{name,contentBase64}` for PDF/DOCX extraction (8 MiB original, 12 MiB JSON envelope, 240 KiB extracted text). Returns `{uploaded,path,format,originalStored:false}`. Authorization precedes parsing and is rechecked before commit; only one upload/parser runs across listeners.
- GET/PUT `/api/admin/google-oauth` inspects/configures the owner OAuth application; saved secrets are never returned. GET `/api/providers/gemini/google` returns the current user's connection state. POST `/start` with `{origin}` and POST `/complete` with `{state,code? ,error?}` use the same prefix; DELETE disconnects. Exchanges are session-bound, PKCE-protected and CSRF-checked. See [owner setup](google-connection-setup.md).
- Task options accept `efficiency: 'efficient'|'standard'` and `budget.maxOutputTokens` from 256 to 8192. Context, model output limits and resource admission can impose a lower allowance. Output truncation pauses and never dispatches partial tool proposals.

External-client protocols, account tokens and metadata-only retention are documented separately in [external clients](external-clients.md). They do not share browser owner cookies.

Task options may include `verification: {requiredReads: [{path, expectedSha256}]}`. Supply one to eight unique permitted relative paths (at most 512 characters each) and lowercase 64-digit SHA-256 hashes. An authorized workspace is required. Completion requires actual successful `file_read` receipts with those hashes after the latest workspace change; assertions in model text do not qualify. The contract adds no permissions, cannot be changed by agents, and persists across recovery. Missing proof triggers bounded continuation or a pause, never a fabricated read event. This advanced contract is currently exposed through the API; it is not inferred from natural-language prompts.

## Local owner administration

- GET/POST `/api/admin/users` lists accounts or creates `{name,email,role,permissions?}`. New accounts default to local AI, no workspaces or cloud spending. This records an allow-list entry; it does not send an email.
- POST `/api/admin/users/:id` replaces `{enabled,permissions}` and revokes existing sessions/work. POST `/api/admin/users/:id/revoke` ends sessions and cancels that user's work. The owner cannot be disabled through these routes.
- GET `/api/admin/sessions` returns active browser-session metadata without bearer cookies. POST `/api/admin/sessions/:id/revoke` ends that session; use user revocation to cancel all associated work as well.
- GET `/api/admin/tasks` lists active task metadata. POST `/api/admin/remote/stop` stops invited users' tasks while retaining local-owner work.
- GET `/api/admin/remote` returns configured/enabled/listening state, public origin, host identity and setup requirements. POST `/api/admin/remote/enabled` body `{enabled}` operates only on a configured listener. Disabling revokes remote sessions and work.

Conversations, tasks, approvals, diffs and events enforce ownership on the backend. Workspace file reads/uploads require a current workspace grant; reverting also rechecks current write authority. Creation and resume atomically recheck session version, current policy, quota and conversation occupancy. No client-supplied user ID or UI restriction grants authority.
