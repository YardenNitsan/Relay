# Security research and implemented boundary

Research date: 2026-10-04. This document separates the selected design from OS features that have only been researched. Windows, Linux, and macOS are target hosts; a check passing on Windows does not prove the other operating systems have been validated.

## Authority and threat model

Models request tools with data. The controller supplies task/agent identity, scoped allowed tool names, access mode, task cancellation and an exact-action approval decision. The broker independently validates arguments and permissions. Model arguments cannot grant approval, change workspace, select a different permission mode, or invoke an unregistered tool. Unknown fields fail validation. Unrestricted host access remains unavailable.

All broker file operations are serialized. An emergency-stop generation invalidates already queued work even if the outer application later resumes. The broker checks cancellation before durable file commits. Approvals and audit records are owned by the task controller, not by model messages or the broker's filesystem metadata.

The immediate boundary protects against malicious model/tool arguments and malicious imported repository contents. It does **not** claim protection from an administrator or hostile process already running as the service's OS account and modifying its private data concurrently. Node's portable path APIs are not a race-free, handle-relative filesystem sandbox. Use a private service data directory; do not grant tools access to it. Native handle-based helpers and adversarial OS testing remain release gates for stronger guarantees.

## Managed files

The broker works on copied, service-managed workspaces. Source repositories are never edited, reset, stashed, checked out or cleaned by import. The current bytes of dirty source files are copied. Git internals, dependency/build trees, recognized credential files, symbolic links, junctions, hard links and oversized files are excluded. Content heuristics cannot prove that an arbitrary source file contains no secrets: importing a workspace and selecting a cloud provider are separate user decisions.

Portable relative paths reject traversal, absolute paths, Windows drive/device/UNC paths, alternate data streams, trailing dots/spaces, reserved DOS device names and protected secret locations. File operations inspect every existing path component, reject links, compare opened-file metadata, and bound UTF-8 contents. Files must be regular files. These checks reduce attacks; a check followed by a path-based open is not a kernel-enforced defense against a malicious same-user concurrent renamer.

Mutations require the SHA-256 observed by `file_read`; creating a new file requires `expectedHash: null`. Missing or mismatched content produces a conflict. A persisted checkpoint precedes mutation. Writes use an exclusive temporary file and atomic replacement, then read the result to verify its hash. Revert verifies the current file still matches the checkpoint's result, checks task ownership, and restores only the broker's recorded change. It never resets an entire repository or overwrites later edits without detecting a conflict.

## Isolated commands

The first command adapter is Docker with a local Linux engine on each supported host. No Docker daemon, no locally installed trusted image, or unavailable resource/security controls means commands are unavailable. Relay does not download images automatically and does not fall back to a host shell.

The host launches only Docker with constructed argument arrays. Model input is placed after the fixed image and entrypoint boundary. Each command receives one disposable staged workspace bind mount, no network, no Docker socket, no provider secrets, dropped capabilities, no-new-privileges, a read-only container root, a bounded temporary filesystem, process/memory/CPU limits, timeout and bounded output. The image ID is resolved before execution so a mutable tag cannot silently change between policy checks and launch. Prefer rootless Docker where its cgroup resource controls are configured and working.

A completed container is stopped/removed before staged files are inspected. Changes are validated and committed through the same checkpointed file path as other mutations. Cancelled or timed-out commands cannot promote staged changes. The original source tree is never mounted. Generated/dependency trees and unsafe filesystem objects are not promoted. This initial design supports self-contained checks and tools present in the selected image; offline dependency installation is not automatically provided.

Container names are recorded durably before launch. An interrupted marker blocks subsequent command admission after restart. Emergency stop retries termination of those exact containers; an unverified cleanup remains recorded. Staging directories are retained for recovery/inspection and need a future retention policy. The configured per-file limit does not provide an aggregate quota on the host bind mount; container disk exhaustion and quota enforcement remain a release gate. Workspace promotion is capped at 2,000 files/50 MiB, each file at 1 MiB, and a checkpoint at 16 MiB of serialized metadata. These are application limits, not claims of a kernel filesystem quota.

Docker is a substantial trusted computing base and Linux containers share their kernel with the Docker host/VM. A restricted command profile is not proof against kernel/runtime vulnerabilities. The application must report cleanup failures truthfully; killing the Docker client alone is not evidence that a container stopped. Resource enforcement and hostile-child cancellation need actual integration tests on Linux Docker Engine, Windows Docker Desktop, and macOS Docker Desktop.

## Native platform research

- **Windows:** AppContainer and Less-Privileged AppContainer enforce SID/capability/DACL restrictions. Job Objects provide process-tree lifetime and resource controls but do not isolate files. A future native helper should start children suspended, attach a non-breakaway Job, then resume; kill-on-close handles service death. Windows junctions and reparse points require handle-based processing. WSL is not automatically isolated: host-drive automounting and Windows process interoperability default to enabled.
- **Linux:** bubblewrap can construct a mount/PID/IPC/network namespace boundary, but its security is determined by the profile supplied by its caller. Do not mount host D-Bus, Docker sockets or credentials. cgroup v2 supervises whole process groups. Landlock is useful defense in depth, but must probe its ABI; older ABIs omit restrictions and already-open descriptors require special care. `openat2` with root-relative resolution provides a stronger file-tool boundary than portable string-path checks.
- **macOS:** Apple's App Sandbox is a kernel-enforced entitlement boundary and requires an intentionally packaged/signed application and helper design. Do not present a shell `cwd`, an unsigned Node process, or merely checking POSIX paths as App Sandbox. The current Docker path is the portable command boundary; a native App Sandbox helper is researched, not implemented. Keychain Services is the OS-backed credential-storage choice. Apple Silicon image/runtime architecture must be detected, not assumed to be x86.

## Credentials, browser and prompt injection

Provider calls belong to a separate broker that can retrieve OS-backed credentials. Windows uses Credential Manager/DPAPI; Linux desktops use Secret Service; macOS uses Keychain. Never inherit provider secrets into command environments or expose them in arguments, URLs, events or normal tool results. OS storage does not make unrestricted same-user code safe.

Local HTTP needs exact Host/Origin checks, sessions and mutation CSRF protection; loopback binding alone does not stop hostile webpages or DNS rebinding. Render tool/model content as untrusted data. Do not execute raw model HTML or silently fetch external images. MCP servers must not receive arbitrary host authority or token passthrough.

Local owner sessions now require a short-lived one-use pairing code delivered through account-protected host storage. Native loopback access alone cannot mint a session. Windows SID/DACL enforcement and Unix ownership/mode checks are described in [the implemented security model](security-model.md), including the remaining native Linux/macOS validation limits. Remote access separately requires signed identity and explicit grants. Same-user hostile filesystem/process access remains outside the portable broker's isolation guarantee.

Prompt-injection filters and reviewers are advisory. A malicious README may influence a model, but cannot issue capabilities or bypass the deterministic broker. Google's CaMeL research supports separating trusted planning from untrusted data and explicitly tracking permitted data flows. Relay does not claim to implement CaMeL or solve all semantic prompt injection.

## Recovery and testing

Durable operation identity and persisted intent are required before side effects. A crash after an external effect but before its receipt is uncertain, not automatically failed. Resume idempotent operations only; inspect uncertain effects. Checkpoints retain before/after data and task provenance. Never claim exactly-once external execution.

Required tests cover permission escalation, read-only/approval behavior, expired/revoked task work, traversal, Windows path edge cases, symlink/junction/hard-link rejection, secret paths, dirty-source preservation, expected-hash conflicts, task-owned revert, restart metadata, stop races and bounded data. Container integration must additionally demonstrate real denied host filesystem/network access and terminate detached child processes. Document skipped infrastructure-dependent tests instead of presenting mocked container tests as OS verification.

On this development host the automated tests exercise real temporary Windows files, NTFS junctions/hard links, checkpoint persistence and broker policy. The default unconfigured sandbox is tested to fail closed. No Docker daemon is available for actual hostile-container integration. Linux and macOS native execution tests have not been run here. No direct Git inspection tool is advertised because imported snapshots intentionally omit `.git`; reviewable diffs are generated from broker checkpoints.

## Primary sources

- [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation) and [launching AppContainer/LPAC](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [reparse point processing](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-points-and-file-operations), and [handle path resolution](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew).
- [WSL automount and interoperability defaults](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).
- [bubblewrap security model](https://github.com/containers/bubblewrap), [Landlock kernel documentation](https://docs.kernel.org/userspace-api/landlock.html), [cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html), and [openat2](https://www.man7.org/linux/man-pages/man2/openat2.2.html).
- [Apple App Sandbox configuration](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox), [sandboxed file access](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox), and [Keychain Services](https://developer.apple.com/documentation/security/keychain-services/).
- [Docker Engine security](https://docs.docker.com/engine/security/), [rootless resource-control caveats](https://docs.docker.com/engine/security/rootless/tips/), and [default seccomp profile](https://docs.docker.com/engine/security/seccomp/).
- [DPAPI](https://learn.microsoft.com/en-us/windows/win32/seccrypto/example-c-program-using-cryptprotectdata) and [Secret Service](https://specifications.freedesktop.org/secret-service/latest-single/).
- [OWASP prompt-injection prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html), [CaMeL research implementation](https://github.com/google-research/camel-prompt-injection), [MCP transport security](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), and [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- [PostgreSQL queue locking](https://www.postgresql.org/docs/current/sql-select.html) and [Temporal retry/idempotency semantics](https://github.com/temporalio/documentation/blob/main/docs/develop/python/best-practices/error-handling.mdx).
