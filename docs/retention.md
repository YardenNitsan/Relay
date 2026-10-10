# Explicit database retention — Phase 1

Retention is optional and disabled by default. This module never schedules cleanup or touches production data on startup. Applying a preview is destructive for the selected payloads and cannot be undone without a backup. This is bounded database maintenance, not complete account erasure or a guarantee that disk space is immediately reclaimed.

## Integration contract

Create one `RetentionService(database)` instance per host process. Its methods are:

- `preview({id, sessionVersion}, policy)` returns a one-use token, expiry, normalized policy, fixed cutoff, category counts, protected-task count and a batch-limit indicator. It does not mutate database records or return retained payloads, credential hashes, or selected row identifiers.
- `apply({id, sessionVersion}, token)` accepts only the server-issued preview token. It returns the applied counts, policy, cutoff and application time after the transaction commits. It does not accept a replacement policy or client-selected records.

Both methods verify the current durable actor is enabled, approved, has the owner role, and has the authenticated session version. The API must additionally require a **local owner session**, its usual Host/origin/CSRF checks, and an explicit confirmation action. Do not derive the actor from the request body. The database module cannot distinguish a local browser from a remote browser by user ID alone.

The process retains at most 16 outstanding previews. Tokens expire after ten minutes and are invalid after restart. An apply attempt consumes its token before awaiting the database, including failed attempts. An expired, stale, busy, unauthorized or failed operation requires a fresh preview. Do not automatically retry an apply or substitute a new preview for an approved one.

## Policy and counts

`retentionPolicySchema` rejects unknown keys and normalizes these settings:

| Field | Default | Accepted values |
| --- | --- | --- |
| `expiredCredentials` | `false` | Boolean |
| `terminalPayloads` | `false` | Boolean |
| `olderThanDays` | `90` | Integer, 1–3650 |
| `batchSize` | `100` | Integer, 1–500 |

The cutoff is derived from the database clock at preview. Credentials qualify only when their expiration timestamp precedes that cutoff. Payload eligibility uses the task's last-updated timestamp, not an individual payload timestamp. The cutoff does not advance between preview and apply.

Each of the six categories is independently capped at `batchSize`, so one apply affects at most 3,000 payload/credential rows. `limited` means at least one category has additional eligible records beyond this batch. It is not a total storage estimate. `protectedTasks` counts tasks older than the cutoff that failed the payload safety checks; it is zero when terminal-payload cleanup is disabled. It does not count recent tasks or credential references. Counts are row counts, not bytes or exact reclaimed storage.

| Category | Change on explicit apply |
| --- | --- |
| `sessions` | Delete sufficiently expired browser sessions. |
| `lanInvitations` | Delete sufficiently expired invitation hashes. |
| `inferenceTokens` | Delete sufficiently expired tokens only when no `inference_requests` row references their ID. |
| `stepContexts` | Set eligible terminal `task_steps.context` to NULL. Preserve step identity, output, status, model and dependencies. |
| `callContexts` | Replace eligible terminal `model_calls.context` with an empty array. Preserve call identity, status, usage, costs, reservations and errors. |
| `modelTextEvents` | Clear only the `text` payload of eligible `MODEL_TEXT` events, adding a retention marker. Preserve event ID, type, timestamp, task and all other data fields. |

No task, conversation, message, model-call, tool-call, event or audit identity is deleted. Conversation messages, objectives, final results, step outputs, tool arguments/results, verification, findings, approvals, permissions and audit metadata remain intact. Inference usage history remains intact.

## Protected work and references

Only `completed`, `failed` and `cancelled` tasks can qualify. Active, paused, queued, waiting-for-user and waiting-for-approval tasks are never payload candidates. A terminal task is also excluded if it has:

- An execution lease, reserved execution time, or wait marker.
- A running step, a running/unfinished agent, or a running/unfinished call.
- Any model call whose cost state is not settled, including legacy unknown costs.
- A running, uncertain or unfinished tool call, or a pending approval.
- Any checkpoint, artifact or calibration reference.
- A workspace option, unrestricted host access, or any tool invocation outside the explicit read-only tool list. Actual managed/host recovery checkpoints are filesystem records, so absence of a SQL checkpoint row is not sufficient evidence that cleanup is safe.

Protecting a task excludes its contexts and streamed-text payloads together. This intentionally leaves more data than an aggressive cleanup might. Tool receipts and mutation arguments remain authoritative evidence and are never redacted in Phase 1. Filesystem artifacts, snapshots, host-operation recovery files, provider credentials and OAuth secrets are outside this module.

## Transaction and race behavior

Preview uses a repeatable-read transaction and fingerprints bounded candidate identities and payloads privately. Apply follows the control-plane lock order (global control, then durable owner), then requests exclusive table locks with `NOWAIT` over the relevant task, credential, reference and payload tables. It reselects candidates using the original policy/cutoff and rejects a changed fingerprint before any mutation. Changes to task eligibility, selected payloads, or protected references therefore require another preview. Extra eligible rows beyond the selected batch do not expand the approved operation.

Table locks cover insertions as well as updates, including tables whose cross-record references lack foreign-key constraints. A busy native PostgreSQL host may refuse an apply instead of waiting for ongoing work. Ordinary unlocked reads remain possible under this lock mode. All changes and one `RETENTION_APPLIED` audit receipt commit together; any failure rolls them back. The receipt contains actor identity/version, policy, cutoff and counts, not deleted content or token secrets. Statement and lock timeouts bound database work.

The lock semantics follow [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html). The embedded implementation uses the repository's transaction wrapper over the [PGlite transaction API](https://pglite.dev/docs/api). PGlite tests verify transactions and application races; they do not establish multi-client native PostgreSQL lock performance.

API/UI integration should invalidate cached maintenance/activity queries after apply. This module does not broadcast replacement events or erase content already held in a browser's memory, backups, WAL, external provider storage or existing exports. There is no physical vacuum, disk compaction, filesystem garbage collection, audit purging, tool-result redaction or scheduled policy application in this phase.

## Verification

Run `npm.cmd test -- tests/retention.test.ts --maxWorkers=1` against the isolated in-memory PGlite fixtures. Tests cover read-only preview, selective redaction, preserved cost/evidence records, protected work, stale state/payload/reference checks, expired credentials, token history references, current owner authorization, one-use concurrent apply, bounded batches/preview cache, expiry and transaction rollback on audit failure. No real user data or live inference is required.
