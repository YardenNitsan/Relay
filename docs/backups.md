# Offline encrypted backups

Relay's first backup format supports an **offline embedded PGlite data directory**. It does not back up a running service or a native PostgreSQL database. Shut down Relay completely before creating a backup; pausing agents alone is insufficient. PostgreSQL documents why ordinary file copies require shutdown and the complete database cluster, and PGlite exposes an asynchronous `close()` for its filesystem database: [PostgreSQL filesystem backups](https://www.postgresql.org/docs/current/backup-file.html), [PGlite API](https://pglite.dev/docs/api).

## Command-line workflow

Build Relay first with `npm run build`; the offline tool is `dist-server/backup.js`. These examples use placeholders: choose explicit paths for your installation. The CLI has no implicit production data-directory selection.

```text
node dist-server/backup.js keygen --key-dir <new-private-key-directory>
node dist-server/backup.js create --data-dir <fully-stopped-data-directory> --backup-dir <new-encrypted-backup-directory> --key-file <private-key-directory>/backup.key
node dist-server/backup.js verify --backup-dir <encrypted-backup-directory> --key-file <private-key-directory>/backup.key
node dist-server/backup.js restore --backup-dir <encrypted-backup-directory> --restore-dir <new-restore-container> --key-file <private-key-directory>/backup.key
```

Quote paths that contain spaces. `keygen` requires a new directory, protects it for the current OS account, and writes a random key into `backup.key`; it prints only the path, never the key. Store that file separately from encrypted backups and retain a secure recovery copy. Never supply the key's contents in command arguments, logs or chat.

For creation, use the exact data directory from Relay's configuration/startup pairing information and shut down that instance. Do not infer it from the shell's current directory: development, installed and custom `RELAY_DATA_DIR` paths can differ. Restore prints the exact `dataDirectory` to use. Set `RELAY_DATA_DIR` to that returned `.../data` path for a separately reviewed startup; leave the original data directory intact. Pair a fresh local owner session and finish the restored-data review in Machine before resuming execution. Remote listener activation after review requires a restart and the relevant configuration.

## Module contract

`server/db/backup.ts` exports three asynchronous operations:

- `createBackup({sourceDir, backupDir, passphrase, limits?})`: create a new encrypted directory outside the source. The source must contain `backend.json` with exactly `{ "format": 1, "backend": "embedded" }`.
- `verifyBackup({backupDir, passphrase, limits?})`: authenticate the manifest and every listed file and validate paths, bounds, sizes and SHA-256 digests. Verification does not open or migrate the database. Successful verification establishes encrypted-file integrity; a restore separately checks that this Relay version can open and initialize the database.
- `restoreBackup({backupDir, destinationDir, passphrase, limits?})`: reserve a new private destination container and return the actual restored `dataDirectory`, **`destinationDir/data`**. Configure Relay to use that returned path, not the container. Existing destinations are refused, even when empty. Restore never replaces the currently configured data directory or starts Relay.

All paths must be absolute, local filesystem paths. Network/UNC paths, filesystem roots and overlapping source/destination trees are refused. `passphrase` must be a Buffer containing 12–1024 bytes. The caller owns and should erase that Buffer after use; the module erases its own derived key and passphrase copy. Use a strong, unique passphrase and keep it separate from the backup. There is no passphrase recovery mechanism.

The optional `limits` object can lower `maxFiles` (20,000), `maxBytes` (8 GiB total plaintext) and `maxFileBytes` (2 GiB). It cannot raise these ceilings. Directories have a separate 20,000-entry ceiling (also lowered by `maxFiles`), and the manifest is limited to 8 MiB. Data is copied in 64 KiB chunks; no plaintext archive is created. Before creating a backup or restore destination, free-space preflight requires the full snapshot size, encryption/manifest overhead and an additional 5 GiB reserve. This is a point-in-time check, not a disk reservation against other applications; database migration growth and filesystem allocation overhead can still cause a safe failure.

## Contents and encryption

The snapshot includes the entire data directory, including embedded PostgreSQL files, workspaces, artifacts, managed checkpoints, baselines and host checkpoints. Unlike a model-visible workspace snapshot, this encrypted backup does **not** filter secret-looking filenames, Git state or generated files. A secret stored inside the data directory can therefore be present inside the encrypted backup.

Only root-level `service.lock`, `.backup.lock`, `auth/` and `startup/` are excluded. Pairing and setup delivery files must be regenerated. Files outside the data directory, OS-keyring credentials, environment variables, installed models, Docker images, the application executable and external host workspaces are not included. Filesystem metadata such as original timestamps, permissions, ownership and extended attributes is not restored; restored storage is private to the current OS account. Persisted absolute paths are preserved, not rewritten to another machine's paths.

Each file uses a random blob name, a fresh 96-bit nonce and AES-256-GCM authentication, with its blob identity bound as associated data. An encrypted manifest records portable relative paths, sizes and SHA-256 digests. A fresh 256-bit salt and scrypt (`N=32768`, `r=8`, `p=1`) derive the encryption key. Only the fixed format/KDF header and salt are plaintext; blob counts and ciphertext sizes remain observable. The implementation uses [Node's authenticated encryption and scrypt APIs](https://nodejs.org/api/crypto.html). There is no compression or deduplication.

Links, hardlinked files, special files, detected redirected/reparse paths, path traversal, reserved Windows names, case/Unicode-normalization collisions and unsafe portable filenames are rejected. These checks protect ordinary local storage; they do not establish an isolation boundary against an administrator or another process running as the same OS account that actively changes filesystem objects during the operation.

## Offline locking and failures

Creation first acquires `.backup.lock` exclusively, then acquires an absent `service.lock`, writing a numeric PID to both. It refuses every existing service lock, including a stale one, and never automatically removes another operation's backup guard. Relay startup checks the backup guard both before service-lock recovery and after acquiring its own service lock. Source inventories and lock ownership are checked during copying. Only locks still owned by the backup operation are removed on exit.

After an interrupted backup, establish that both Relay and the backup process have exited before manually removing an abandoned `.backup.lock`. Once the guard is cleared, Relay's normal startup/shutdown may clear a valid stale service PID; a malformed lock requires manual review. Do not delete a lock merely because a backup request reports one. A backup created by this implementation requires a Relay startup version that honors the backup guard; an older executable or unrelated database opener cannot be coordinated by these locks.

A completed snapshot receives `backup.json` last. Interrupted creation can leave an encrypted, incomplete destination; a later attempt must use a new destination. Verification will reject a missing completion marker or damaged/missing blob. This is not a filesystem power-loss guarantee: verification should be run after copying or transporting a backup.

Restore authenticates the manifest before creating its destination. It decrypts files into a private staging directory, authenticates all files, opens the isolated PGlite database, runs supported migrations and recovery, and closes the database before publishing the `data/` directory. Failed restoration removes only its own validated staging tree and may leave an empty destination container. A process crash can leave private staging files; they are never automatically selected as a live data directory. No restored directory is published after a failed integrity or initialization check.

## Restored access and execution

Before publication, restore deletes sessions, inference tokens and LAN invitations, increments every user's session version, disables all five cloud provider connections globally and per user, sets `remote_enabled=false` and `restoration_pending=true`, and raises the global stop generation with execution stopped. Standard recovery preserves recorded activity and pauses interrupted work; uncertain side effects are not retried. A `BACKUP_RESTORED` audit event records the restoration boundary. Task identities, provider grants, accounting and historical audit records remain present.

Startup must honor `restoration_pending` by suppressing remote/LAN/external inference listeners and automatic runtime startup until the local owner reviews the restored installation. Clearing this review gate does not itself enable cloud connections or resume agents. Existing keyring credentials on the destination machine are not deleted by restore; disabled connections and the review gate prevent automatic use. Pair a fresh owner session, review workspace paths, permissions, provider configuration and pending work, then explicitly enable the desired access and scheduling.

Native PostgreSQL requires its own supported backup/restore workflow plus a coordinated copy of Relay's non-database files. The encrypted manifest records the producing Relay version and the supported PGlite version (currently 0.5.8). Other PGlite versions are refused; dependency changes require deliberate compatibility work. Cross-platform portability and recovery of unavailable external files are not guaranteed by format version 1. Keep the Relay/PGlite version used for the snapshot available and test restoration to a new directory before relying on a backup.
