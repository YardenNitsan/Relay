# Security model

Relay separates browser authentication, user authorization, model proposals, and deterministic tool execution. A model never grants access. Local and remote gateways share task storage and policy while using separate authentication paths and cookies.

## Personal workspace authority

Approved accounts may provision bounded empty personal workspaces. Ownership is server-derived and stored with workspace metadata; an upload cannot specify another owner or a host import path. Personal ownership permits manual file management independently of the agent access mode. It permits read-only, supervised or autonomous workspace tasks only for that matching workspace; host, network, provider, quota and MCP authority remain separate. Personal workspaces are not shareable through another user's ordinary workspace grant list. Existing host-managed workspaces retain their prior policy.

Authorization is checked at file routes, durable task admission/resume/model reservation and durable broker execution. File edits/deletes require an expected content hash and use the existing bounded broker checkpoint path. Browser folder connections require user selection and explicit reviewed writeback; they are not remote authority over arbitrary client paths or processes. Browser file APIs do not provide an atomic compare-and-swap against external desktop applications. See [file behavior and limits](personal-files.md).

## Local owner pairing

Reaching loopback does **not** grant owner authority. `GET /api/session` returns `401 PAIRING_REQUIRED` without a valid paired local session. The hostname and account details are returned only after authentication. Other private API routes require the session cookie; mutations also require the session CSRF token.

On the host, run `npm run pair` from a built source checkout, or `node launch.mjs --pair` from a portable installation. For a custom service directory use `node dist-server/pair.js --data-dir <absolute-directory>`. The CLI prints only the location and expiration of `auth/owner-pairing.json`. Open that private file locally and enter its `token` in Relay's pairing screen. Never put the code in a URL, chat, issue, screenshot, shell argument, or source file.

Each code contains 256 random bits from Node's `randomBytes`, expires after five minutes, and authorizes exactly one session establishment. Each issuance creates a separate challenge; older unredeemed challenges remain valid until their own expiry. Issuance cleans expired challenges and limits pending challenges to eight in normal sequential use. This is an operational bound, not a security boundary against hostile software running as the owner account.

The challenge stores a SHA-256 digest and expiry. Redemption derives the filename from the presented code's digest, checks the stored digest with `timingSafeEqual`, and creates a deterministic claim file with exclusive `O_EXCL`/Windows `CREATE_NEW` semantics. Only one concurrent claimant succeeds. The claim survives failures and is retained until the code's maximum lifetime has passed. If session creation fails after consumption, generate another code; a credential is never made reusable to recover a failed exchange. The protected delivery file may retain an expired or consumed code until the next issuance replaces it. A Windows concurrency regression exposed a rename-based implementation race; exclusive claims replaced that implementation.

`POST /api/session/pair` accepts `{ "token": "..." }` only on the local listener, requires an exact configured local Origin plus the normal Host/Fetch-Metadata checks, and limits attempts to ten per minute per source address. The remote listener rejects pairing. There is no HTTP endpoint for generating a code and no production bypass for tests. The browser retains no pairing token after the exchange; the session uses an HttpOnly, SameSite=Strict cookie and a separate CSRF token.

The first upgraded service start atomically removes pre-pairing local sessions and advances the owner's session version. A persisted migration marker prevents repeated invalidation. Newly paired sessions survive service restarts and can be reused across tabs until expiry or revocation. Local sessions expire after twelve hours; remote sessions expire after one hour.

## OS-account boundary

Linux and macOS pairing directories must belong to the service account and use `0700`; files use `0600`. macOS initialization also removes extended directory ACLs with the fixed `/bin/chmod -N` operation, since mode bits alone do not clear an inherited allow ACL. Windows initialization verifies current-SID ownership and replaces only the directory DACL with a protected, inheritable FullControl rule for that SID. The fixed PowerShell/.NET operation is invoked through `execFile` with separate arguments and an environment path, never through an interpolated shell command. The resulting DACL is checked. New files inherit that restriction. Failure to establish restrictive permissions prevents pairing initialization.

Private directories reject symlinks/junctions at the directory being secured; credential reads reject links, hardlinks, non-files and oversized files. Atomic temporary-file replacement prevents overwriting an unrelated link target. These checks are not a native handle-based filesystem sandbox. The installation and its ancestor directories must remain controlled by the host account. Administrator/root compromise, malicious software running as the same account, and a compromised host process are outside this boundary: those actors can read owner files or operate the host directly. Pairing does not claim to distinguish trusted from hostile programs sharing the same OS identity.

The code is stored briefly in an ACL-protected control file rather than an encrypted vault. Provider credentials use the separate SecretManager and do not travel through pairing. Session tokens are hashed in PostgreSQL. Pairing codes, cookies and CSRF headers are excluded from structured HTTP logging; pairing audit entries contain only the operation and account identity.

## Remote access and execution

Remote requests require verified, invited Cloudflare Access application identities and a separate secure cookie. Owner configuration is unavailable remotely. Live remote activity streams close at the signature-verified JWT expiry, on session revocation, or when remote access is disabled. Concurrent streams are bounded and release capacity when disconnected.

Version 0.1.1 adds optional approval registration: a valid new identity receives a disabled, zero-grant account until the owner approves it. Pending/denied identities can fetch the inert browser shell only. All APIs and session creation remain denied. Registration capacity is bounded; remote identity work has an aggregate admission limit in addition to per-user limits. Accounts bind issuer and subject, not email alone. Browser sessions have a transactional 20-session cap and current-browser logout.

Cloud gateways and OS-vault namespaces are per account. Routing resolves from durable task ownership; browser-supplied IDs cannot choose a credential owner. Local inventory is shared without invoking owner cloud discovery. Credential changes invalidate caches and cancel requests before a delayed credential read can dispatch. User revocation discards volatile connections; persistent vault entries remain stored. Strict pricing fails closed, except an explicit owner-authorized personal billing mode with no task dollar cap; unknown charges are never claimed to be zero.

Remote cross-site top-level GET navigation may load only `/` or `/index.html`, allowing an Access/Google sign-in return. API requests, embedded documents and subresources retain cross-site rejection. Host/Origin, signed identity, session and CSRF checks remain independent. This follows [Google's Fetch Metadata guidance](https://web.dev/articles/fetch-metadata); it is not an OAuth callback accepting model credentials.

Task creation and resume recheck current user permissions, session version, task/conversation occupancy, and quotas inside transactions. Cloud calls reserve task and user budgets before dispatch. Unknown costs remain conservatively reserved. Tool capabilities and workspace paths are enforced by the broker; arbitrary native commands remain unavailable. See [tool boundary research](research-security.md) and [remote deployment](remote-access.md) for the implemented isolation and deployment limits.

## Verification and sources

Automated tests exercise unauthenticated loopback access, expired/guessed/reused codes, concurrent redemption, origin rejection, remote pairing rejection, migration revocation, session reuse, and credential-free audit/response bodies. Windows private ACL initialization and repeated initialization were exercised on the development host. Native Linux core execution was also tested under Ubuntu WSL2; see [Linux validation](linux-validation.md). macOS execution remains unverified. These checks are not a cross-platform penetration-test claim.

## Explicit evidence requirements

`TaskOptions.verification.requiredReads` is an optional trusted caller contract: one to eight unique, permitted relative paths with expected whole-file SHA-256 values. API and task-admission validation reject traversal, protected files, malformed hashes and unbounded lists. A requirement grants no file or tool access and cannot be added, removed or weakened by model output. The existing workspace and agent capability policies still decide every read.

Only durable successful broker `file_read` calls count. Their latest result must report the required path/hash and occur after the workspace's last verification invalidation. Writes, committed command changes, uploads and reverts invalidate earlier requirements across unfinished tasks on that workspace. A newer mismatching read supersedes an earlier matching read. A write's internal read-back and the model's claimed tool execution are not separate read receipts.

Missing proof keeps a proposed answer out of the conversation's final assistant messages. The supervisor supplies bounded factual continuation using the existing call/time/iteration budget, and the final database transaction rechecks the requirements. This proves the declared exact-file predicate, not arbitrary natural-language correctness. The normal composer does not yet provide a contract editor; API callers can supply it. [ADR013](adr-013-required-verification-contracts.md) describes the design and limits.

The design follows [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) for high-entropy server-generated credentials and session lifecycle handling. Windows DACL updates use the documented [DirectoryInfo access-control API](https://learn.microsoft.com/en-us/dotnet/api/system.io.directoryinfo.getaccesscontrol?view=netframework-4.8.1), restricted to the Access section to avoid changing audit policy or requiring `SeSecurityPrivilege`. macOS ACL removal follows [Apple's chmod manual source](https://github.com/apple-oss-distributions/file_cmds/blob/main/chmod/chmod.1).

## Owner-confirmed direct host files

The local owner may explicitly confirm `Unrestricted · host files` for real, absolute-path text-file operations. A separate controller-issued capability is required; remote identity, model output and task arguments cannot grant it. Native broker policy protects OS, credential, Relay and private-data paths, rejects links/special files and checks file hashes before mutations. This is a fixed-operation broker, not isolation for arbitrary host code. Terminal execution remains container-only. See [host access scope and recovery](host-access.md).
