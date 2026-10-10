# Staged relocation of private Git worktrees

This increment supplies `relocateManagedWorktrees(stage, finalDataDirectory)` in `server/db/worktree-relocation.ts`. It is a restore transformation for the private managed-snapshot worktrees created by `ManagedWorktrees`, not general Git repair or recovery of original repositories. Integration into encrypted backup restore is a separate caller change.

## Caller contract and ordering

The caller must decrypt and authenticate the entire archive into an exclusively owned, OS-account-protected staging directory before invoking the helper. No service, Git process or other writer may use that directory. The final data directory must be an absent sibling of staging. The encrypted archive and original data directory remain immutable.

1. Authenticate and decrypt all archived files using the existing backup limits and link rejection.
2. Call the relocation helper with the canonical staging directory and the known final `destination/data` path.
3. Finish database restore recovery, invalidate credentials, keep execution stopped and retain the owner-review gate. Include the returned `repaired` count in the restore audit if desired.
4. Publish the complete staging directory through the existing final rename only after every step succeeds.

The helper validates every discovered binding before changing any pointer. It performs no Git calls and does not open SQL. Filesystem registration records and `workspaces.json` are cross-checked; any SQL consistency checks belong to the restore caller. Missing SQL/listing records are not synthesized, and prepared allocations are never promoted.

If a filesystem write fails after validation, staging can contain one rewritten pointer and one original pointer. The helper propagates that failure. The caller must discard the unpublished staging directory, using its existing ownership/identity checks, and start again from the immutable encrypted archive. This function does not promise an atomic pair update or replay partially repaired staging.

## Accepted identities and interrupted state

Repository and workspace identities come from bounded `git-projects/<UUID>/operations/<UUID>.json` prepared receipts. Ready receipts, registration-prepared/registration-published receipts and published workspace metadata are validated when present. Immutable repository, branch, base-commit and ownership metadata must agree. Branch names must be exactly `relay/<workspace UUID>`.

Each copied admin directory is discovered under the corresponding copied bare repository's `worktrees` directory. Its basename is validated as a single portable component; it is not assumed to equal the workspace UUID. The helper requires the expected branch HEAD, `commondir` equal to `../..`, a matching workspace `.git` file, and reciprocal original-root/identity bindings in both pointer strings. Multiple registrations cannot claim the same workspace. Unrecorded workspace pointers, unknown bindings and incomplete registered pairs are rejected.

An interrupted allocation may have a genuine registered worktree and only a prepared receipt. Its two pointers are relocated while all preparation state and content remain unchanged. Empty repositories, prepared allocations that never registered, and empty admin directories are retained without fabricating missing files. A ready or published allocation whose registration is missing is refused for recovery. The original encrypted archive retains all such evidence even when restore refuses publication.

The only rewritten files are `workspaces/<UUID>/files/.git` and the corresponding admin `gitdir`. HEAD, commondir, index, refs, content, locks and every operation journal remain untouched. `repaired` counts changed registrations, not changed files; an identical repeat before publication returns zero.

## Threat boundary and bounds

Original absolute locations are parsed solely as opaque text. They are never resolved or passed to filesystem or Git APIs. Windows drive paths and POSIX absolute paths are understood without requiring the source platform or directory to be available. Both directions must describe the same original root, and every discovered registration must belong to that same root. UNC roots, dot traversal, malformed lines and identity substitutions are refused.

Only paths derived from validated identifiers and enumerated in-stage components are opened. Every traversed component is checked with `lstat` and canonical-path verification. Symlinks, reparse aliases, hardlinked control files, directories masquerading as files, and special files are refused. File handles are checked against observed identities before reads and writes, with no-follow opens where the platform supports them. Writes use existing regular-file handles and synchronize the changed files. Protecting staging from concurrent writers remains a caller responsibility; these checks are not an operating-system sandbox against another process running as the same account.

Discovery visits only fixed-depth control locations, never Git object history or workspace content trees. Limits are 20,000 enumerated control entries, eight internal path components, 8 KiB per control file, 64 KiB per operation receipt, 1 MiB/1,000 entries for `workspaces.json`, and 16 MiB total metadata reads. Original pointer paths are limited to 4,096 characters. Exceeding a limit refuses restoration rather than silently ignoring remaining registrations.

This does not validate arbitrary Git configuration, restore external repositories, execute hooks/filters, remove locks, replay uncertain operations, repair branch contents, grant permissions or resume tasks. It preserves the existing source-publication boundary and the restore owner-review requirement. Native PostgreSQL backup/restore integration remains separate from the embedded encrypted restore caller.

## Focused evidence

Command: `npm.cmd test -- tests/worktree-relocation.test.ts --maxWorkers=1`.

The initial no-op implementation produced **14 failed / 1 passed**. Failures included expected pointer relocation, prepared-only registration handling, malicious binding rejection and the actual Git lifecycle. After implementation, the initial 15 cases passed. Additional bounds, root, unknown-registration, idempotence and injected-write-failure cases then passed in a 20-case focused run. The final focused run passed **22/22**, including unavailable POSIX/Windows source roots and an actual destination containing spaces and Hebrew characters. A targeted strict TypeScript check of the helper and test file also passed (`tsc --ignoreConfig --noEmit` with the repository's ES2023, ESNext/Bundler and strict/no-unused settings).

The real Git case creates two worktrees through `ManagedWorktrees`, makes a dirty edit, copies the private data, and moves the original root out of reach. After relocation and publication, actual Git verifies each distinct HEAD and index, while dirty text and BOM/CRLF content remain exact. Synthetic control fixtures check that only the two intended pointer files change, both directions agree, conflicting metadata is rejected before any write, outside hardlink targets remain unchanged, and write failure produces no final data directory or completion marker.

Full checks, encrypted end-to-end integration, browser tests and native Docker acceptance are deliberately outside this helper increment. No production data or live inference is used by its focused tests.
