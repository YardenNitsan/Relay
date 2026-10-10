# Security review

Status: open, internal engineering review; no independent penetration-test claim.

Approval presentation audit found inaccurate model provenance after a permitted fallback: the view used only AGENT_STARTED. Two failing regressions reproduced it; the view now selects the latest recorded identity before the exact tool proposal, excluding later events and other task/agent identities. Unknown identity stays unknown. The focused-review increment changes no authorization endpoint or permission grant. Cloud UI offers one-request consent because backend cloud consent is not retained task-wide. Source review found no actionable remaining defect in that increment; 41 affected browser consent/error/focus/draft checks pass. This is a presentation-integrity fix, not evidence of an authorization bypass.

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

## C03 focused publication review

Presence-aware publication keeps original paths behind the owner-only API and protected HostFileBroker. Focused review identified three concrete defects: durable authorization was too early for unlink; durable authorization was too early for exclusive creation; and an older preview could apply after a newer rollback, corrupting sequential receipt-baseline interpretation. Real disposable-file/database regressions reproduced each: revoked deletion removed a source file, revoked creation left an empty source file, and stale publication succeeded. Fixes add the final authorization boundaries and monotonic review-sequence admission. All three fixes passed the full strict-type/1237-test check (one platform skip), production build and five actual publication browser cases. Final source review found no remaining actionable defect within this increment. This is internal focused review, not independent penetration testing. Directory creation, Git integration and broader threat-model coverage remain open.

## A03 ordinary host mutation revocation

FE-011: ordinary agent host dispatch omitted the durable authorization callback already used by publication. Preparation could outlive account disablement, session revocation, task grant removal or the absolute deadline. Six real filesystem/database regressions failed before the fix: four unauthorized creations, a deletion and a write that continued through revocation. ToolBroker now passes its fresh durable authorization check into HostFileBroker, bracketed by cancellation/emergency guards. Checks run before exclusive creation, immediately before unlink and between write chunks. Interrupted partial writes retain their private prepared recovery checkpoint; no automatic rollback or retry is claimed.

All six regressions and 49 focused boundary cases pass. The full strict-type check passes 1243 tests with one platform skip, and the production build passes. Internal source review found no additional actionable defect in this scope or queue reentry. Fixtures use owned disposable sibling paths with actual production installation/data protections enabled. Broader A03 threat-model acceptance remains open.
