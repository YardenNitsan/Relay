# Direct host file access

The local owner can select **Unrestricted · host files** and confirm **Enable host access**. This grants direct operations on real host text files for the submitted task, without repeated action approvals. It does not require importing a managed copy. Use an absolute native path in your objective.

Confirmation clears the selected managed-copy workspace so the task begins with the host-file tool scope. This prevents an automatically prepared workspace from silently adding a second tool catalog and overflowing the default context. Select a managed workspace again explicitly if the objective also needs its tools; larger combined catalogs may require a larger context budget and must still pass memory admission.

Available operations are a bounded directory listing, UTF-8 file read, file write and single-file delete. Replacements and deletions require the current SHA-256; writes and deletes save private recovery checkpoints and return verified receipts. Directory deletion, process launch, installations and arbitrary native shell execution are not provided by this mode. Commands continue to require a managed workspace and the existing verified Docker boundary.

## Authority and protection

The API accepts the mode only from an authenticated **local owner** with explicit `hostAccessConfirmed: true`. Remote users—including a remotely authenticated owner—cannot grant it. The task controller separately issues `ToolContext.hostAccess`; model arguments cannot set that capability. Specialist readers receive only listing/read capabilities. Every operation passes the tool policy, native path checks, cancellation guard and normal audit/verification flow.

The native broker blocks OS locations, credential and application-data locations, Relay's installation and private data, links, hard links, device paths and traversal. Operations are limited to bounded ordinary text files and existing parent directories. Credential-like values are redacted from read output where recognized; unknown secrets cannot be reliably classified by content. Cloud sharing remains a separate policy.

**This is not an OS sandbox for arbitrary code.** It executes fixed application operations under the host account. An independently malicious process already running as that account is outside the current isolation guarantee. Checks reduce path attacks; they are not a claim of complete resistance to hostile same-user races. Native process isolation and signed per-OS helpers remain release work.

## Recovery

Recovery records are stored under the owner-protected data directory's `host-checkpoints` folder. They include the original path, previous content/hash, intended new hash, task ID and commit state. They are not exposed to model context. Preserve them with your normal Relay backup. A dedicated safe restore UI is not yet available; do not overwrite a file from a checkpoint without checking whether it has changed since the recorded operation.

## Why commands stay isolated

An arbitrary child process using the owner's OS identity inherits that account's filesystem and credential authority. Clearing environment variables does not remove access to credential APIs or prevent modification of Relay. Process-tree termination controls lifetime, not those permissions. Keeping arbitrary code in the existing container boundary preserves a meaningful separation while direct structured file operations become usable.

See [security model](security-model.md), [user guide](user-guide.md) and [validation](validation.md) for guarantees and measured evidence.

The choice to keep arbitrary native commands isolated follows Microsoft's [CredReadW credential-set semantics](https://learn.microsoft.com/en-us/windows/win32/api/wincred/nf-wincred-credreadw): access follows the process token's logon session, rather than the presence of an API-key environment variable. File operations use the documented [Node filesystem APIs](https://nodejs.org/api/fs.html); application checks are not represented as kernel-enforced isolation.
