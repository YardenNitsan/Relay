# Security review

Status: open, internal engineering review; no independent penetration-test claim.

| Boundary | Invariant | Current review / acceptance |
|---|---|---|
| Browser/session/LAN/remote | Verified identity, origin/Host/CSRF, revocation, per-user records | Existing tests; fresh baseline and adversarial inventory pending |
| Filesystem/private storage | No links, hardlinks, protected paths or implicit ownership takeover | CI failures expose fixture aliases/default ownership; investigate without bypass |
| Tool broker | Fresh durable authority after queues and before effects | Existing 0.1.2 boundary retained; deadline interaction pending |
| Sandboxed execution | No host shell/Docker socket for model; bounded resources/network | Real daemon unavailable at initial inspection |
| Model/cloud | Eligibility/privacy/hardware/cost before ranking; no unapproved fallback | Source review and fresh regressions pending |
| Companion | Independent local identity/grants/approval; replay and revocation | Not implemented |
| Memory/web/MCP | Untrusted content cannot grant authority or cross accounts | Extended threat tests pending |
| External mutations | Exact consent; durable uncertain receipts; no automatic duplicate send | Write integrations not implemented |
| DB/backup/retention | Immutable migrations, coherent references, private restore gate | Existing implementation; native PostgreSQL and fresh restore pending |

Confirmed delivery findings: Windows/macOS CI failures; Linux verification job exceeded total time; unprotected main. These are release-readiness findings. The failures alone are not evidence of an exploitable authorization bypass.
