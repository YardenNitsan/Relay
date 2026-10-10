# Relay evolution report — 10 October 2026

**Current release: 0.1.2.** The complete implementation passed 1,194 deterministic tests on Windows and Ubuntu WSL and 110 browser cases. The built 0.1.2 host passed real local greeting, persisted timing inspection, external Responses inference with unchanged chat history, and eight live phone/desktop panel checks. Production data was backed up and restore-drilled before migration 9. Use [current release evidence](validation.md#release-012--current-evidence-10-october-2026) and [release notes](release-0.1.2.md); earlier milestone paragraphs below preserve chronology and do not describe the final state.

## Actual delivery

This report covers verified implementation progress; the full engineering directive remains unfinished. The working tree now contains fresh durable authorization at all production broker dispatch branches, an ordered migration runner with historical upgrade coverage, a responsive conversation/controls/execution UI refinement, core approval/budget/scheduler improvements, and connected-provider model/reasoning selection with cost-aware Auto. Existing local inference and optional provider boundaries are preserved. No additional runtime service, cloud subscription, UI framework or inference load was introduced.

The subsequent core continuation adds encrypted offline embedded backups/restore, owner-reviewed retention, bounded task-specific analysis graphs and structured handoffs, configuration-bound capability evaluations, approved private memory, durable local read-only schedules, recorded timing/diagnostic views, pinned development profiles, and separately authorized Gmail/Calendar reads. Module/API checks have run; the latest combined verification and activation state are recorded at the end of this report and in validation.md. Live provider quality, Google account access and unavailable native environments are not established by fixtures.

## Confirmed original weaknesses

- `ToolBroker.execute` checked durable authorization for managed/personal operations but omitted that check in host-file, HTTP and MCP branches. Queue waits could separate permission admission from dispatch.
- `Store.init` replayed a cumulative schema with only historical markers 1–3. Later schema additions shared marker 3 and had no immutable checksummed upgrade history.
- The 320px screenshot showed the verbose permission explanation and composer taking most of the available height. Advanced controls were represented by an unlabeled visual icon. Execution required reading detailed step/event records to distinguish progress from verification.
- Approval waits consume the running execution budget and retain a scheduler slot; account concurrency quota and effective scheduling limits differ. The core continuation now fixes whole-task approval/resource accounting, releases approval slots and aligns execution with account grants within host limits.
- Routing previously used three coarse categories without an effort decision or price ranking, and the UI used a flat model list. Gemini Interactions omitted thought tokens from recorded output. The continuation adds overlapping task hints, supported effort, cost eligibility/ranking and corrected thought usage; broad measured task-quality gains remain unproven.

## Architecture and security changes

`server/tools/index.ts` takes one durable database snapshot of task, account, workspace and stop controls, validates identity/session, task state, stored access and permission-bearing context, then applies the existing tool policy. Host/network/MCP paths now participate. Serialized dispatch checks after waiting. Adversarial tests verify that revocation, disablement, cancellation, stop generation, cross-user identity and widened context cannot reach downstream execution. Network/MCP dispatch tests mock the downstream side effect; they are not live-service penetration tests.

`server/db/migrations.ts` validates ordered history and checksums, refuses newer or corrupted histories, serializes upgrades with a transaction lock and commits pending DDL/history together. Version 4 reconciles legacy cumulative schemas once; future migrations append versions. Actual historical schema fixture `tests/fixtures/schema-9c29d1b.sql` preserves conversations, workspace metadata and remote user policy through upgrade. Existing marker-3 owner revocations stay revoked. See [database upgrade instructions](database-upgrades.md).

Authorization and external mutation cannot be made atomic by this check alone. Existing cancellation, exact approvals and uncertain-side-effect handling remain necessary. Standalone broker construction without a Store remains a compatibility/test fallback; production supplies it. Native PostgreSQL multi-connection lock/failure acceptance remains outstanding.

## Frontend and interaction changes

- A two-column desktop welcome surface stacks on phones, with editable starting points that append to existing drafts and focus the composer without sending.
- A visible Advanced control exposes existing budgets/network/MCP options. Collapsing it preserves settings and grants no additional authority. Access and cloud policy remain visible; detailed permission text is expandable.
- The composer adapts to its container, including a narrower desktop conversation beside activity. Short windows allow the composer to scroll while preserving the conversation's stream-follow/history scroll owner.
- `ExecutionOverview.tsx` presents persisted agent role, status and model plus recorded check counts. Generation-only responses and model-review assessments are excluded from independent-check totals. Approvals, raw events, diffs and verification evidence remain available.
- Updated light/dark surfaces and action colors retain Relay's mark and bundled IBM Plex fonts. No remote font dependency or decorative animation was added. Reduced-motion behavior, dialog focus handling and safe-area padding remain.

Browser verification covers 320/390px phones, tablet, laptop/desktop, 2560px wide windows and short landscape. These are Windows Chrome viewports, not actual phone/tablet hardware. See [design decisions and official sources](design-system.md). The official Vercel composition skill was installed in the user's Codex profile at revision `063bee94c3f4df8453406c830b0a7df0f2860278`; this is a development aid, not a product dependency.

## Routing, agents, hardware and performance

Model ranking now considers task complexity, supported reasoning and known cost; deterministic selection regressions pass. No measured broad task-quality or agent-planning improvement is claimed. The execution view exposes recorded state. The core continuation improves orchestration timing and scheduling without claiming better model reasoning or routing quality. Safe local inference admission, the shared lease, memory reserves and pressure monitoring remain.

Native read-only telemetry confirmed an Intel Ultra 7 265KF, RTX 5070 with 12,227 MiB VRAM, approximately 31.5 GiB visible RAM and a roughly 2 TB disk with approximately 350 GB free. Initial free RAM was approximately 18.5 GiB and GPU memory use 753 MiB. These observations are not a crash guarantee. Builds and suites ran sequentially at the repository's existing worker limits; no model weights were downloaded or loaded.

No before/after inference or task-latency benchmark was run. Build/suite times are verification timings, not product performance claims. Existing lazy loading and React Query request sharing are retained.

## Verification record

Changed-file map: [broker dispatch](../server/tools/index.ts), [migration runner](../server/db/migrations.ts), [Store initialization](../server/db/store.ts), [authorization regressions](../tests/tool-authorization.test.ts), [migration regressions](../tests/migrations.test.ts), [native host integration](../tests/host-engine.test.ts), [composer](../web/components/Composer.tsx), [welcome](../web/components/Welcome.tsx), [execution overview](../web/components/ExecutionOverview.tsx), [responsive styles](../web/styles.css) and [new browser acceptance](../tests/e2e/evolution.spec.ts). App/Conversation/Activity wiring and architecture/design/operating documentation were updated with them.

- Baseline: typecheck and **878 passed / 1 skipped** deterministic tests in 77 files; build passed; **67/67** Chrome cases passed.
- New tests were observed failing before implementation. Upgrade/auth tests then passed. One existing migration test fabricated a gapped history by removing only version 3; its fixture now loads the actual historical pre-v3 SQL snapshot instead of deleting modern history markers. Gap refusal remains tested.
- Native host-engine tests required execution outside the filesystem sandbox: the restricted run returned EPERM while resolving a protected ancestor. The same two tests passed under native permissions. No filesystem boundary was weakened.
- Initial UI checks exposed faint-text contrast of 4.39:1 and generation-only evidence being counted as a passed check. Both were fixed. Review found a short-window scroll-owner regression; a populated landscape regression now passes.
- Focused UI acceptance: **16/16 passed**, including responsive controls, keyboard focus, draft preservation, WCAG-tagged axe scans, and populated short-window scrolling. No complete WCAG certification is claimed.
- Full regression: strict types and **900 passed / 1 skipped** deterministic tests in 79 files, 145.40 seconds; production build passed; **75/75 browser tests passed** in 5.0 minutes. After the final approval-order refinement, another build and **12/12 focused browser cases** passed in 49.0 seconds. See [validation](validation.md) for exact scope and archive results.
- `npm.cmd run package` and `node scripts/verify-package.mjs release/2026-10-10T09-31-30-759Z` passed: three unsigned portable candidates, with SHA-256 and archive-member checks. Windows ZIP contains 135 entries; Linux/macOS tar.gz each contain 134. This verifies archive construction, not native OS support or installation. Whitespace validation passed.

## Workstream status

Status refers to the broad requested workstream. A completed narrow deliverable does not complete its entire phase.

| Workstream | Status | Delivered / remaining |
|---|---|---|
| Repository/hardware baseline | Completed | Subsystem survey, official research, native telemetry, pre-change check/build/browser baseline; deeper review continues before each later change |
| Centralized tool authorization | Partial | Dispatch coverage and regression tests delivered; long-running revocation/side-effect boundaries need further audit |
| Versioned migrations | Partial | Runner and PGlite historical/rollback tests delivered; native PostgreSQL acceptance remains |
| Backup/restore and retention | Partial | Encrypted offline embedded backups, a separate production-data restore drill and explicit reference-safe payload cleanup delivered; PostgreSQL backup and artifact deletion remain |
| Approval budgets and recovery | Partial | Durable active/approval/resource accounting, slot suspension and explicit recovery delivered; overall deadlines and restart-safe automatic continuations remain |
| Scheduler/resource fairness | Partial | Account concurrency aligned, bounded owner priority and cancellation-safe slot reuse delivered; model-affinity/resource optimization remains |
| Architectural decomposition | Partial | Migration, activity, slots, workflow compiler, handoffs, evaluation runner, memory, schedules and diagnostics separated; Engine remains large |
| Intelligent routing/evaluations | Partial | Hard eligibility, richer classification, economical reasoning and configuration-bound evidence delivered; isolated executable coding suite implemented, native execution and measured held-out selection gains remain |
| Local runtime performance | Partial | Pressure safety preserved; first observed content, managed load, stream and verified cleanup timings implemented; internal first-token telemetry and measured residency optimization remain |
| Dynamic agents/handoffs | Partial | Validated analysis DAGs and compact attributable handoffs delivered; live task-quality acceptance and expanded verification remain |
| Coding environments/Git workflows | Partial | Pinned Node/Python/.NET profiles and exact approved existing-file source publication/rollback implemented; native Docker validation, dependency installation, larger quotas and full branch/add/delete workflows remain |
| Project/preferences memory | Partial | Explicit private CRUD/export, revision checks and bounded untrusted task context implemented; semantic retrieval and broader project indexing remain |
| Real external integrations | Partial | Separate Gmail/Calendar consent and explicit broker-assisted local-only reads implemented; real consent unverified, writes/browser/desktop automation remain |
| Durable scheduled tasks | Partial | Owner-controlled local read-only jobs, atomic occurrence claims, revocation, missed-run policy and UI implemented; live timer/inference, conditional triggers and remote-user schedules remain |
| Frontend/responsive/accessibility | Partial | This UI milestone implemented and browser tested; broader settings polish and physical-device/assistive-technology validation remain |
| External inference clients | Partial | Existing separate API preserved; real supported-client acceptance matrix remains |
| Observability | Partial | Factual execution, observed content/load/stream/cleanup timings and bounded metadata-only export implemented; internal first-token telemetry and broader retention remain |
| Remote security | Partial | Existing listener/identity boundaries preserved; broader adversarial and real remote outage testing remain |
| Native distribution/signing | Partial | Windows plus current Ubuntu WSL types/tests/build/compiled-host acceptance passed; physical Linux GPU, native macOS, supported GPU/OS matrix and signing remain |

External gates: Docker Desktop did not report a running service; native PostgreSQL tooling was unavailable on PATH. No Docker/PG service was started as a shortcut. Live external-account consent, real phone/tablet tests, native Linux/macOS GPU tests, signing and independent assessments remain **Blocked by unavailable environments/configuration** for this session; they do not prevent independent implementation work.

## Operation and compatibility

Automated suites used isolated databases/workspaces and deterministic providers. After the combined checks passed, the idle setup-managed Windows host was stopped, an encrypted database-plus-artifact backup was verified, and a separate restore drill retained 21 database conversations, 26 completed tasks, six paused tasks and two waiting-for-user tasks. The original host then started the upgraded build. Its first upgrade appended migrations through version 8. No source changes were committed or pushed and no new public infrastructure was deployed. Live browser acceptance is recorded below when completed.

For ordinary Windows use, double-click `setup.cmd` in the Relay folder. It opens `http://127.0.0.1:4317` and provides a private pairing file when needed. A running setup-managed host is reused. To apply backend changes, first finish/cancel work, preserve a stopped backup as described in [database upgrades](database-upgrades.md), use `setup.cmd --stop`, then run `setup.cmd` again. Linux/macOS use the corresponding `sh setup.sh` commands. No assistant is needed for daily startup.

## Next priorities

1. Verify native PostgreSQL backup/locking when available; the integrated regression/browser gates, stopped encrypted backup/restore drill and migration 9 activation have passed.
2. Extend durable approval handling with an explicit overall deadline and independently validated restart-safe continuations if needed; preserve uncertain-effect refusal.
3. Validate observed phase timings with real inference and measure resource/model-affinity scheduling against the bounded scheduler.
4. Run the executable coding suite in a verified native container and measure held-out routing gains; assess semantic classification against the keyword baseline.
5. Continue coding workflow and project-memory improvements, preserving explicit source-apply approval; extend UI validation to physical devices and assistive technology.

## Core execution continuation

[Execution accounting](execution-accounting.md) documents the implemented behavior and boundaries. Migration 5 preserves existing budgets and adds exclusive whole-task approval/resource wait counters. `ExecutionBudget` serializes refresh, suspension, resume and close, stops reserving future active time while idle, and rechecks a fresh reservation after persistence. Recovery does not bill interrupted human waiting as active execution.

`ExecutionActivity` coordinates parallel branches: an active sibling keeps the clock running, and task-wide waiting state appears only when every branch awaits approval. `TaskSlots` retains three host execution slots and returns one during human waits; approved work reacquires capacity before dispatch. The existing single local inference lease and hardware safeguards are preserved. Resource waits retain their slot to prevent lease/slot deadlocks. Account limits now permit the granted concurrency; a fixed owner head start replaces unlimited owner-first ordering. Workspace and host exclusivity still span live approval waits.

Security/reliability regressions cover durable revocation while all slots are occupied, shutdown/stop/cancel during asynchronous admission, stale leases, delayed persistence consuming a reservation, and no provider dispatch before approved work reacquires capacity. Queue insertion during a drain now schedules another pass. API status publishes effective host limits; Access explains in-flight versus active execution limits.

Changed files: `server/orchestration/{budget,activity,slots,engine}.ts`, `server/db/{migrations,store}.ts`, `server/api/app.ts`, `shared/types.ts`, `web/components/Access.tsx`, and budget/activity/scheduler/migration/API regression tests. Focused strict types and 55 cases passed. Final complete-suite evidence is maintained in [validation](validation.md); earlier package artifacts predate this continuation unless a later packaging run is explicitly recorded.


## Connected models and economical reasoning continuation

The latest user request is implemented in [ModelPicker](../web/components/ModelPicker.tsx) and its lazy-loaded panel: configured providers, discovered models, supported reasoning, explicit cloud sharing and cancel-safe selection. Models & connections also opens that review flow. Exact manual selections remain required. Auto includes all authorized eligible providers; keyword hints incur no model call and expensive effort remains manual. No models are fabricated from pricing tables.

[Task demand](../server/models/task-demand.ts), [routing](../server/orchestration/router.ts), [reasoning policy](../server/orchestration/reasoning.ts), [provider contracts](../server/providers/reasoning.ts) and [pricing evidence](../server/providers/pricing.ts) are independently testable. Engine records requested/effective effort and performs continuation validation before call quota or cost reservation. Review caught stale pricing across human waits and unpriced models looking cheaper than known models; dispatch now refreshes expiring evidence, and unknown-price ranking is conservative. Existing transactional cost admission remains authoritative.

Gemini Interactions now sums visible output and thought tokens, retaining usage on incomplete output. Other adapters serialize their native supported reasoning controls. Provider-default/numeric-only limitations, price evidence expiry, estimated billing, and the unverified xAI combined-token ceiling are documented in [model selection](model-selection.md). No live paid calls were made. Auto improvement is demonstrated by deterministic decision cases, not a real-task quality benchmark.

Desktop/phone/tablet/landscape selection preserves unsent drafts, supports native keyboard radios, and displays limits and sharing clearly. The model panel loads on demand. Actual recorded routing reasons and effort are available in execution details. Final combined validation is recorded in [validation](validation.md); earlier portable archives predate this continuation and must not be distributed as its build.


Final backend/build evidence for the combined continuation: strict types and **986 deterministic tests passed / one platform skip in 85 files** (158.05 seconds); production build passed. Main JavaScript is 477.08 kB plus a separate 12.90 kB model-panel chunk. These sizes do not establish runtime latency gains. Full browser/package completion is tracked in validation.md.


Final browser evidence: the complete run passed **82/83** cases, including all eight picker cases, with one shared-host HTTP429 collision in an existing deletion scenario. Eight-second test admission pacing preserves the production limiter; the **25-case preceding-flow/deletion/picker rerun passed** (3.2 minutes). Final typecheck passed. Light/dark, phone/tablet/desktop/landscape screenshots were inspected. Physical devices and live providers remain unverified.


Combined archive verification passed for `release/2026-10-10T10-43-41-308Z`: three unsigned candidates, checksum/member checks, Windows 141 entries and Linux/macOS 140 each. The running production service remains unchanged; activating this backend requires the stopped-backup/restart procedure above. No source commits or public release were made.

## Earlier recovery milestone and activation

The recovery/evidence continuation is now implemented and verified within the boundaries below. All broad workstream states above remain authoritative; this is not completion of every item in the original directive.

**Delivered components:** `server/db/backup.ts` and backup CLI provide encrypted stopped embedded backups and guarded new-directory restore. `server/db/retention.ts` implements owner previews, exact one-use confirmation and protected-reference checks. `server/orchestration/{workflow,handoff,evaluation-runner}.ts` provide bounded graphs, attributable compact context and local evaluation execution. `server/models/evaluation*.ts` separates objective synthetic grading, trusted production provenance and conservative routing evidence. `server/memory/repository.ts` supplies private approved notes. `server/scheduling/service.ts` supplies durable local read-only jobs. `server/diagnostics` supplies recorded intervals and bounded content-free exports. `server/tools/development-profiles.ts` and sandbox preflight add pinned language profiles. `server/integrations/google-workspace.ts` supplies a separately authorized read-only account adapter. The matching API modules and lazy frontend panels expose actual behavior.

**Review fixes:** transaction-backed Google session validation avoids nested PGlite connection deadlock; queued reads cannot adopt a newer connection generation after disconnect. Schedules stay inert until restoration review and do not falsely skip work because of the dispatcher's own backlog. Evaluation scores cannot transfer from automatic unknown GPU placement or runtime-default reasoning to explicit different effort. Required handoff/assignment context survives compaction. Cleanup preview focus occurs after React commits the result, and interval help text is an accessible description.

**Evidence:** strict types and 1,134 deterministic tests passed, with one platform skip across 101 files; production build passed; all 100 browser cases passed. Encrypted backup/verification and an actual separate production-data restore drill passed before the original host upgrade. The updated running host retained all visible conversations and paused/waiting work, passed eight phone/desktop panel checks and reports a ready launcher/build. See validation.md for timings and artifacts. Builds/test durations are not inference-performance measurements.

**Incomplete or externally blocked:** native PostgreSQL backup/locking acceptance; actual Docker language-profile execution; executable coding evaluation and held-out routing-quality comparison; original-host Git publication workflow and controlled dependency installation; overall task deadlines; finer first-token/cleanup profiling and measured residency optimization; Google live consent/read acceptance and durable send/calendar-write approvals; assistant-tool integration with account reads; browser/desktop control; semantic project indexing/OCR; conditional/remote-user schedules; real external-client workflows; physical phones, native macOS/Linux GPU acceptance and signing. Unconfigured Google actions remain disabled; account reads are explicit, not automatically sent to models. No inference or cloud billing claim is inferred from fixtures.

**Operational limits:** keep the encrypted backup and its separate private key; OS-vault credentials and external host files are not included. Do not downgrade the migrated data directory using an older binary. The stopped snapshot is the recovery source; restore into a new directory and review before execution. Unknown runtime measurements remain unknown. Source changes are uncommitted; no push or public infrastructure deployment occurred.

Archive integrity checks passed for `release/2026-10-10T12-13-38-103Z`: three unsigned candidates, including the new backup CLI. The current Windows host is running the verified build; Linux/macOS archives remain unverified native candidates. The full original directive remains partially implemented as the workstream table states.

Final live SSE heartbeat passed. The older inference-backed smoke script remains blocked by its unsuccessful saved real-runtime prerequisite; no new inference success is claimed. This is recorded separately from the passing 1,134 deterministic and 100 browser cases.

## Latest continuation: source publication, account tools and executable evidence

The following supersedes the earlier milestone's missing-feature list. The overall directive remains **Partial**, as the workstream table states.

- **Source publication:** `server/tools/publication.ts`, `server/api/publication.ts`, `shared/publication.ts` and `web/components/Publication.tsx` add frozen existing-file review, exact confirmation, original-hash conflict checks, durable uncertain receipts and separately approved rollback. Engine reserves the host lane and managed workspace. Fresh exact-session checks run during bounded writes. Additions, deletions, branch publication and package installation remain unavailable. Native tests use disposable project fixtures; no owner repository was published.
- **Executable coding evidence:** `server/models/code-evaluation*.ts`, `server/tools/code-evaluation.ts`, `server/orchestration/code-evaluation-runner.ts` and `web/components/CodeEvaluation.tsx` implement three synthetic Node cases with host-side output grading and exact model/container provenance. The existing sandbox runs generated bytes; there is no host-code fallback. Migration 9 appends protocol support while preserving old reports. Native Docker is unavailable here; fixture tests are not real code execution or quality evidence. Coding scores do not affect Auto yet.
- **Private account tools:** `server/integrations/workspace-policy.ts`, `server/tools/google-workspace*.ts` and `web/components/WorkspaceTaskAccess.tsx` add explicit task-scoped Gmail/Calendar reads. Store, Engine and broker enforce durable local-only/read-only conversation restrictions. Regression tests cover consent changes, revocation, prompt-driven scope escalation and changes during cloud approval/dispatch. Live Google consent remains unconfigured. Sending and event mutation remain absent.
- **Observed timings:** provider adapters and evaluation execution persist first observed content, successful managed load, stream consumption and successful verified cleanup. The activity view explains overlapping phases and missing historical values. Internal first-token time remains unknown. Evaluation code no longer derives a generation interval from throughput or labels observed text as internal first-token telemetry.
- **Reliability fixes:** startup guard ownership prevents cooperating starters from racing stale PID reclamation. Backup refuses an active startup guard. A real TCP test reproduced external inference's ten-second cold-load disconnect; only authenticated valid requests receive a bounded socket allowance while independent execution deadlines and cancellation remain enforced.

Latest combined validation: strict TypeScript and **1,194 passed / one platform skip in 110 files** on both Windows (230.86 seconds) and Ubuntu WSL (256.38 seconds); production builds passed. WSL additionally passed compiled-host native pairing, permissions, CSRF, persistence, restart and SSE checks. The clean Windows browser rerun passed **110/110 in 14.2 minutes**. Earlier selector/pagination failures and their fixes are retained in validation.md. Safe migration 9 activation preserved all 16 visible conversations and eight unfinished tasks after a fresh stopped encrypted backup and separate restore drill. Eight live desktop/phone panels passed without runtime errors. Version 0.1.2 metadata and release documentation were then built and the idle host restarted gracefully; current live inference and archive evidence is in validation.md.

Remaining independent implementation includes optional overall task deadlines, full Git/project scaling and controlled dependencies, native PostgreSQL backup, broader retrieval/indexing, write connectors and browser/desktop automation, conditional/remote-user scheduling, measured routing-quality and residency improvement. Environment-dependent work includes actual Docker execution, live provider/Google consent, real external CLI workflows, physical-device/assistive-technology testing, native macOS and signing. None is replaced by mock-provider results or archive checks.
