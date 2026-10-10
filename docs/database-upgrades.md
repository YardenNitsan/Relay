# Database upgrades

`Store.init()` runs `server/db/migrations.ts` before the service accepts work. PGlite remains the default; the runner uses the shared transaction interface for optional PostgreSQL.

Versions 1–3 were historical markers attached to cumulative initialization SQL. Version 4 reconciles those installations once and records a SHA-256 checksum and migration name. It preserves conversations, tasks and user policy. The historical pre-v3 owner-only xAI/DeepSeek grant still applies once; an installation already at v3 does not receive revoked grants again. Remote accounts receive no new provider grants.

Version 5 adds approval/resource wait counters and a paired current-wait marker without changing existing active-budget values. Versions 6, 7 and 8 add configuration-bound evaluations, approved memory and durable schedules respectively. Subsequent upgrades must append consecutive versions starting at 9. Never edit a shipped migration, including the SQL snapshot imported by version 4. Checksums normalize CRLF/LF so Windows and Unix checkouts agree. A fixed transaction-scoped advisory lock serializes upgrades; lock waits have a five-second timeout. All pending migration SQL and history commit together. Unknown newer schemas, missing history versions and changed checksums stop startup. Do not delete ledger rows to force startup or bypass a failed upgrade.

## Before upgrading a real host

An offline encrypted embedded backup/restore CLI is now available; see [backups](backups.md). It requires the backend identity marker introduced by this release, so an older installation without that marker still needs a deliberate stopped-data preservation step before its first upgrade. Do not start the upgraded application merely to create a marker before preserving valuable data. Native PostgreSQL needs its supported backup tooling. Preserve a recoverable copy before upgrading:

See the [platform data-location table](operations.md) and verify any configured override before copying files.

1. Stop the setup-managed service with `setup.cmd --stop` (Windows) or `sh setup.sh --stop`. A manually launched or service-managed instance must be stopped through its own manager. Confirm no tasks or other writers remain. Browser **Stop all** alone does not close the database.
2. Locate the running host's actual data directory first. `RELAY_DATA_DIR` overrides it; source checkouts default to `.data`, while packaged launches use the platform data directory. For embedded storage, preserve that entire directory while stopped, including workspaces, artifacts, checkpoints and settings. Do not assume a checkout's `.data` belongs to a packaged host, and do not copy a live database directory. Keep the prior application and lockfile as well.
3. For native PostgreSQL, use PostgreSQL's supported consistent backup tooling and preserve Relay's associated data directory from the same quiesced point. A SQL backup alone cannot restore referenced files.
4. Protect backups as private data. Provider credentials may depend on this host's OS credential store; copying files is not a portable credential migration. Review account/provider setup separately when moving hosts.
5. Test restoration into an isolated copy before relying on it. Restore database and referenced files together with a compatible application. No automatic downgrade exists, and older releases that predate this runner cannot enforce its newer-schema refusal.

For a failed migration, preserve the original database and investigate a private copy. Error messages intentionally omit SQL and private row values. Never solve a migration failure by dropping user tables or discarding task state.

## Verified boundary

Tests cover fresh/repeated initialization, the actual `9c29d1b` historical schema, cumulative marker-3 compatibility, retained user policy/history, checksum/history refusal, transaction rollback, multi-version failure/retry and concurrent PGlite initialization. Independent native PostgreSQL connections and native restore drills still require acceptance; a PGlite test does not prove PostgreSQL locking under production contention.
