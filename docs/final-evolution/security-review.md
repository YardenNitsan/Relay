# Security review

Status: open, internal engineering review; no independent penetration-test claim.

B06 changes presentation and deliberate-navigation guards only. Dirty editor state survives close, command shortcut, responsive navigation and failed background refetch; forced session/account teardown still unmounts private content. Busy guards do not grant mutation authority. Existing private workspace, source-publication and browser-folder APIs remain authoritative. Internal focused reviews found and fixed draft/focus defects; broader security review remains open.

D01 classification remains advisory and uses only the bounded original objective. Hard provider/account/privacy/context/pricing/hardware eligibility executes independently. Focused Hebrew repair tests confirm an improved intent hint cannot override required local selection, local-only policy, absent provider grants or rejected hardware admission. Output allowance is unchanged. No external classifier or new dependency is installed. Internal source review found no actionable new boundary defect; this is not a full routing security assessment.

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

## A02 sandbox cleanup follow-up

FE-012: hosted native run 38069750202 exposed another removal owner: Docker's `--rm` daemon AutoRemove. It can race Relay's explicit shared removal operation. Remove `--rm`; keep explicit cleanup, durable recovery markers, refusal after unverified cleanup and retry. Do not reinterpret a daemon race error as verified absence. A configuration regression failed before the change; all 59 affected tests and a fresh actual Windows Docker/PostgreSQL run pass. Internal source review found no additional confirmed sandbox defect. Hosted Linux acceptance remains pending at this checkpoint.

## Coding acceptance isolation and evidence

A disposable API-only loopback host uses normal pairing, CSRF, real local-only provider routing, native resource admission/watchdog and supervised broker execution. Only exact two-file writes and exact offline test argv receive approval. Independent checks require unchanged non-target files and fresh combined visible/hidden test results before source publication; a stale earlier passing receipt cannot establish current correctness. Cleanup reports are retained on error. No successful publication is claimed from the four paused/refused trials. Native Linux cleanup follow-up38070458360 passes; this supersedes its pending status above.

## C04 development image review

Native .NET CoreLib loading failed under the universal1MiB process file-size limit. Pinned runtime source shows that limit also bounds its W^X executable mapping. The explicit dotnet profile now uses64MiB while RAM,CPU,PID,tmpfs,network,privilege and1MiB exported-file limits remain unchanged. Actual kernel measurements and failing/passing C# compile/run receipts are retained in evidence/native-languages-windows.json. This policy adjustment permits larger disposable files but no larger managed-file export or host access.

Internal review identified inherited BUILDX_BUILDER as a remote execution route during owner provisioning. A regression failed before the fix; non-default overrides are now rejected and build explicitly selects the default local engine builder. Fresh three-image provisioning passes after the fix. Build contexts contain only reviewed Dockerfiles; no user repositories or credentials are copied. Image redistribution/license notices remain separate release work; no Relay license was selected.
