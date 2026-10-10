# Security review

Status: open, internal engineering review; no independent penetration-test claim.

| Boundary | Invariant | Current review / acceptance |
|---|---|---|
| Browser/session/LAN/remote | Verified identity, origin/Host/CSRF, revocation, per-user records | Existing tests; fresh baseline and adversarial inventory pending |
| Filesystem/private storage | No links, hardlinks, protected paths or implicit ownership takeover | Canonical test roots and process-local test ownership fix fixture failures without changing production checks; native .NET TLS ACL inspection passes all three hosted host gates at ec0b1cd |
| Tool broker | Fresh durable authority after queues and before effects | Deadline checked after durable snapshot and asynchronous workspace authorization; queued host, HTTP, MCP and evaluation dispatch expiry regressions pass; full post-review check passes 1214/one skip |
| Sandboxed execution | No host shell/Docker socket for model; bounded resources/network | Actual local Docker and hosted Linux isolation/cancel/emergency acceptance pass. Non-root, read-only root, no provider environment, dropped capabilities, seccomp, no-new-privileges, 512 MiB/64 PID/one CPU/loopback checks pass. Cleanup race fixed and focused review plus full post-fix check pass |
| Model/cloud | Eligibility/privacy/hardware/cost before ranking; no unapproved fallback | Source review and fresh regressions pending |
| Companion | Independent local identity/grants/approval; replay and revocation | Not implemented |
| Memory/web/MCP | Untrusted content cannot grant authority or cross accounts | Extended threat tests pending |
| External mutations | Exact consent; durable uncertain receipts; no automatic duplicate send | Write integrations not implemented |
| DB/backup/retention | Immutable migrations, coherent references, private restore gate | Native PostgreSQL locks/upgrade/32-table dump-restore and 47.6 MB encrypted synthetic restore pass; reference-aware filesystem retention remains open (FE008) |

Confirmed delivery findings: Windows/macOS CI failures; Linux verification job exceeded total time; unprotected main. These are release-readiness findings. The failures alone are not evidence of an exploitable authorization bypass.

Deadline review identified four actionable issues: database/host clock disagreement, cleanup blocking subsequent expiry, scanning retained history each second, and a missing evaluation-store deadline guard. Each was reproduced or traced and addressed. Follow-up read-only review found no additional concrete defect; this is focused internal review, not full security acceptance. Shutdown now owns scheduler reads before storage closes. The preexisting shutdown test required release of its deliberately blocked read while shutdown waits; its no-dispatch invariant remains asserted.

Hosted Windows TLS checks revealed a five-second PowerShell inspection timeout (SIGTERM with empty output), not confirmed insecure ACLs. Native .NET attribute/ACL reads preserve reparse, owner and writable-principal checks while avoiding cmdlet loading. Local native tests and all three hosted host gates at ec0b1cd pass. No timeout increase or ACL weakening was introduced.

Native sandbox acceptance found concurrent `docker rm` calls from emergency stop and finalization; Docker explicitly returned "removal ... is already in progress". A per-container owned cleanup promise now joins both paths, retains the durable marker on failure, and permits a verified retry. A regression failed before the change (two removals), then passed. Native isolation/cancel/emergency acceptance passed after the fix locally and on hosted Linux. Error causes are retained for diagnostics while public errors retain the outer message. Focused read-only review found no concrete defect; the full post-fix check passed 1216 tests/one skip.
