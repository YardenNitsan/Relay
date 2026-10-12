# Security review

## Reviewed managed-parent integration, 12 October

Integration authority remains local-owner-only and separate from model tools. APIs derive the target from immutable branch provenance; callers cannot select an arbitrary parent. Both workspaces are reserved before asynchronous busy checks, broker dispatch is serialized, and each rename/unlink rechecks durable authority. A complete snapshot digest rejects stale reviews. A missing baseline never creates a fabricated ancestor. Selected paths preserve existing path/hash/capacity checks, including a preflight against actual case-insensitive targets.

Prepared integration and rollback receipts precede effects. Mixed states refuse reconciliation; complete-state verification changes only metadata. Sibling integrations into an uncertain parent are blocked. Historical checkpoints remain compatible with the optional rollback reference field. The17broker cases include injected revocation and checkpoint failures, actual file mutations, partial rollback, stale reviews, wrong parent and cancellation. Full1399tests/one skip and31affected browser cases pass. No hostile-same-OS-account, atomic database/filesystem transaction, automatic conflict merge or original-source Git guarantee is claimed. Broader threat review remains open.

Status: open, internal engineering review; no independent penetration-test claim.

## Managed-file final authorization, 12 October

Before adding parent/child integration, source review found durable authorization missing after asynchronous managed-file preparation. Ten real-file negative regressions reproduced writes/deletions after account disablement, session revocation or task expiry; manual editing, rollback, temporary-file publication and importing synthetic sandbox output had the same gap. The authorized write/delete control passed against the old implementation.

`replaceText` now invokes its optional durable authority callback immediately before rename as well as unlink, followed by the synchronous cancellation/stop guard. Ordinary task writes and sandbox result publication pass `authorizeExecution`; manual editor/upload preserves the live caller callback; the checkpoint rollback API supplies fresh session/workspace and inactive-task checks inside the broker and before each file change. Storage budgets, exact-content conflicts and prepared uncertain-effect checkpoints remain intact.

All72focused cases pass; complete strict check **1375passed/one platform skip across130files in286.43s**, followed by a passing production build. Logs: managed-authorization-red.log (10fail/1pass), managed-authorization-focused.log, managed-authorization-check.log and managed-authorization-build.log. This is a fresh boundary check, not an atomic PostgreSQL/filesystem transaction or an all-or-nothing multi-file rollback guarantee. Synthetic sandbox output proves the publication boundary only. Hosted/native follow-up remains separate.

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

## Managed branch and restore boundary

C02 uses only generated UUIDs/refs and a Relay-owned SHA-256 repository; raw admitted snapshot import, no checkout, private linked index, sanitized Git environment and empty hooks/template settings prevent project configuration from becoming execution authority. Separate child workspace IDs inherit ownership but no shared grants. Fresh authorization surrounds waits/effects and durable registration; emergency stop joins the whole publication operation. Interrupted allocation/registration records remain for review.

Restore follows FE-017: authenticated exclusive staging, bounded metadata reads, no original-path access, complete validation before pointer writes, existing-file identity/no-link checks and no Git execution. Actual encrypted unavailable-original regression and22helper cases cover swapped/unknown bindings, malformed pointers, links, metadata limits and injected mid-write failure. OS-account-protected staging is required; no hostile-same-account sandbox claim is made. SQL/listing reconciliation, source-aware branch integration and automatic discard remain unimplemented. Full product threat-model review remains open.

## Conversation, remote recovery and Auto preferences

The gateway's static unavailable document is served only after successful existing Access JWT authorization, on HTML root/index navigation when the upstream fetch fails. It interpolates no request data, fetches no assets, runs no scripts and uses no-store plus restrictive CSP. Anonymous failures and API failures retain JSON behavior. No Worker deployment, Host/origin/cookie relaxation or new endpoint occurred. The stopped existing connector was restarted; the owner confirmed baseline mobile-data sign-in.

Execution settings retain native explicit host-file confirmation and server authority. Review caught a hidden confirmation state and navigation during workspace preparation; guarded validated dismissal and disabled pending navigation address both. Auto Quality/Economy operate after account, privacy, capability, budget and deterministic admission gates. Economy refuses unknown cloud pricing; manual required IDs cannot substitute. No pretrained candidate can authorize actions or load models, and none passed promotion. Focused review found no further actionable bypass; full threat review remains open.

## Service-lock replacement during shutdown

The first integrated conversation/policy check exposed a real failed invariant: shutdown removed a replacement `service.lock` instead of rejecting its changed identity. The failure is retained in `output/final-evolution/conversation-policy-final-check.log` (1340 passed, one failed, one skipped). An immediate isolated rerun passed; the intermittent cause is not established. Separate native Windows probes found filesystem IDs above JavaScript's safe integer range and an unlinked held handle with zero links. Do not equate these observations with a proven precision collision in the original failure.

Removal now compares exact bigint device/file IDs and rejects an unlinked held handle. The replacement test repeats twenty actual file replacements; deterministic stat fixtures separately exercise rounded-number collisions and same-ID unlinked handles. Independent source review found no blocking issue. This remains cooperative locking in an OS-account-private directory: stat followed by pathname unlink is not an atomic defense against a hostile process running as the same account. Native cross-platform hosted verification is tracked separately.
