# Security review

Status: open, internal engineering review; no independent penetration-test claim.

| Boundary | Invariant | Current review / acceptance |
|---|---|---|
| Browser/session/LAN/remote | Verified identity, origin/Host/CSRF, revocation, per-user records | Existing tests; fresh baseline and adversarial inventory pending |
| Filesystem/private storage | No links, hardlinks, protected paths or implicit ownership takeover | CI failures expose fixture aliases/default ownership; investigate without bypass |
| Tool broker | Fresh durable authority after queues and before effects | Deadline checked after durable snapshot and asynchronous workspace authorization; queued host, HTTP, MCP and evaluation dispatch expiry regressions pass; full post-review check passes 1214/one skip |
| Sandboxed execution | No host shell/Docker socket for model; bounded resources/network | Real daemon unavailable at initial inspection |
| Model/cloud | Eligibility/privacy/hardware/cost before ranking; no unapproved fallback | Source review and fresh regressions pending |
| Companion | Independent local identity/grants/approval; replay and revocation | Not implemented |
| Memory/web/MCP | Untrusted content cannot grant authority or cross accounts | Extended threat tests pending |
| External mutations | Exact consent; durable uncertain receipts; no automatic duplicate send | Write integrations not implemented |
| DB/backup/retention | Immutable migrations, coherent references, private restore gate | Existing implementation; native PostgreSQL and fresh restore pending |

Confirmed delivery findings: Windows/macOS CI failures; Linux verification job exceeded total time; unprotected main. These are release-readiness findings. The failures alone are not evidence of an exploitable authorization bypass.

Deadline review identified four actionable issues: database/host clock disagreement, cleanup blocking subsequent expiry, scanning retained history each second, and a missing evaluation-store deadline guard. Each was reproduced or traced and addressed. Follow-up read-only review found no additional concrete defect; this is focused internal review, not full security acceptance. Shutdown now owns scheduler reads before storage closes. The preexisting shutdown test required release of its deliberately blocked read while shutdown waits; its no-dispatch invariant remains asserted.

Hosted Windows TLS checks reveal a five-second PowerShell inspection timeout (SIGTERM with empty output), not confirmed insecure ACLs. Candidate native .NET attribute/ACL reads preserve reparse, owner and writable-principal checks while avoiding cmdlet loading. Local native tests pass; hosted acceptance remains open. No timeout increase or ACL weakening was introduced.
