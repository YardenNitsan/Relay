# Relay evolution ledger

Engineering directive: 10 October 2026. This is a resumable implementation record, not a declaration that the complete directive has shipped.

**Release checkpoint: 0.1.2.** Final implementation gates passed: 1,194 deterministic tests on Windows and Ubuntu WSL, 110 Chrome browser cases and production builds. The upgraded host passed actual local generation, persisted timing inspection, external inference and live panel checks after encrypted backup/restore verification. Version/readme/release documentation is updated. See [current evidence](validation.md) and [remaining workstream status](evolution-report.md#workstream-status). Earlier in-progress entries below are retained as history.

## Baseline and operating envelope

- Starting checkout: `cc046761e18ca61091328cb160f05c569d4417bc`; clean working tree. GitHub HEAD independently matches. Preserve Harmonia and GuitarScaleViewer.
- Windows reports 33,054,312 KiB visible RAM, 19,355,692 KiB free at initial inspection. NVIDIA reports RTX 5070, 12,227 MiB total VRAM, 753 MiB used. A second read confirms Intel Ultra 7 265KF, C: capacity 1,973,349,847,040 bytes and 350,327,889,920 bytes free; free RAM 19,576,560 KiB during browser checks.
- Keep the existing two-worker deterministic suite and single-worker browser suite. Run builds, suites and any inference acceptance sequentially. No model downloads or live model loading in this foundation milestone. Available memory is a momentary observation, not a crash guarantee.
- Baseline `npm run check`: strict types and **878 passed / one skipped, 77 files**, 142.14 seconds. `npm run build`: passed. `npm run test:e2e`: **67/67 Chrome cases passed**, 4.5 minutes. These ran before product implementation; browser inference is an explicit fixture, not actual cloud/local-model acceptance.

## Intent and architectural decisions

Preserve the local-first TypeScript modular monolith, PGlite default, optional PostgreSQL, existing provider integrations, identity boundaries and shared local inference lease. Improve trustworthy execution before adding agent autonomy. The owner's directive authorizes implementation after investigation; routine internal changes do not require a new approval cycle.

The first bounded milestone is durable tool authorization and versioned database upgrades, extended by the owner's explicit frontend request to a responsive conversation/controls/execution UI pass. These protect existing capabilities and provide a dependency for later durable approval waits, scheduling, memory and retention. Approval suspension must account for concurrent graph branches and exact tool receipts; simply stopping a timer would create free execution or replay hazards, and is implemented in the subsequent core continuation described below.

## Implementation inventory and confirmed gaps

| Workstream | Existing implementation and code evidence | Evolution status / next acceptance |
| --- | --- | --- |
| Architecture | Engine coordinates queue, DAG, routing, inference, approval, tools and verification; lifecycle, planning, budgets, lease, context and checks already separate | Partial: inventory complete at subsystem level; extract meaningful boundaries incrementally |
| Authorization | API identity/CSRF, durable task admission/resume/cost checks; broker checks durable authorization for managed files and personal tasks | Partial: durable dispatch now covers host/HTTP/MCP as well as managed/personal paths, including after serialization; adversarial regressions added. Long-running side-effect boundaries remain a separate audit |
| Approval/lifecycle | Exact argument grants, pending records, bounded repair, uncertain effects, crash reservations | Partial: durable active/wait accounting and parallel-branch suspension implemented; fully human-blocked tasks release execution slots. Restart remains explicit review, and an overall deadline remains outstanding |
| Scheduling | Three total task runners, owner-first sorting, one remote runner/account, serialized workspace and host access, shared local lease | Partial: account grants now permit actual concurrency within three host slots; bounded owner priority, cancellation-safe resume and published effective limits implemented. Model-affinity scheduling and richer resource admission remain |
| Database upgrades | `Store.init` repeats cumulative `schema.ts`; legacy markers 1–3; one-time owner provider expansion | Partial: ordered transactional runner, checksums, compatibility refusal and historical/rollback tests implemented; native PostgreSQL acceptance remains |
| Backup/retention | Offline encrypted embedded database plus artifacts; guarded new-directory restore; explicit bounded cleanup preview and confirmation | Partial: isolated tests and actual stopped production backup/restore drill pass; native PostgreSQL backup and artifact retention remain |
| Routing/evaluation | Hard eligibility, keyword taxonomy, supported effort/cost ranking, nine synthetic capability cases plus a separate three-case isolated coding suite | Partial: exact-configuration capability evidence participates only after eligibility; coding reports stay outside ranking. Native sandbox/code execution and held-out measured quality improvement remain |
| Runtime resources | Ollama/LM Studio discovery, SDK estimates, safe margins, pressure watchdog, local lease, private cleanup and observed phase timings | Partial: UI distinguishes first observed content, managed load, stream consumption and verified cleanup; internal first token and measured residency policy remain |
| Agent graphs/handoffs | Strict task-specific analysis DAG compiler, host-owned worker/reviewer, bounded schema handoffs and preserved receipt context | Partial: deterministic graph/context integration passes; broad live workflow quality and independently executable verification expansion remain |
| Coding/sandbox | Managed copies, hashes/checkpoints, Docker supervisor, pinned Node/Python/.NET profiles; exact approved existing-file source publication and rollback | Partial: native publication boundaries tested; native Docker, package-source policy, configurable quotas and full branch/add/delete workflows remain |
| Memory/documents | Bounded conversation retrieval, PDF/DOCX/text; explicit private project/preferences CRUD/export and bounded untrusted task context | Partial: repository/API and 320/390/desktop CRUD/export browser checks pass; semantic retrieval and optional image/OCR remain |
| External integrations | Personal tasks; provider credentials/Gemini OAuth; separate Gmail/Calendar OAuth, explicit-read UI and per-task broker scopes | Partial: durable local-only conversation restrictions and authorization regressions pass; live consent blocked by owner configuration; sending/calendar writes/browser/desktop automation remain |
| Scheduling/reminders | Durable local-owner one-time/interval schedules, bounded read-only execution, atomic occurrence/task creation and management UI | Partial: 19 focused cases pass including recovery, duplicate claims, revocation and queue fairness; native timer/live inference and conditional triggers remain |
| Frontend/accessibility | Conversation-first React app; composer options, approval/activity/diff UI, keyboard dialogs, responsive/browser tests | Partial: responsive welcome/draft starting points, labeled advanced controls, collapsible permission explanations and factual execution overview implemented; full timing explanations and physical-device/assistive-technology review remain |
| External inference | Separate authenticated local inference, bounded protocol subsets, shared admission and metadata-only retention | Partial: actual supported-client integration matrix remains |
| Observability | Monotonic events, call/tool/agent IDs, audit/usage, private diagnostic export, interval view and provider phase observations | Partial: exported identifiers are correlated only within a bundle; internal first-token telemetry and broader retention remain |
| Remote/security | Separate owner/LAN/Access/inference listeners, JWT issuer/audience, per-user policy, network pinning, secret storage | Partial: preserve boundaries; adversarial regression expands here; independent assessment and real remote outage tests outstanding |
| Distribution/native | Node 24 bundles, portable archives/checksums, startup scripts; Windows and current Ubuntu WSL deterministic/build/compiled-host acceptance | Partial: native PostgreSQL/Docker/macOS, physical Linux GPU/device and signing acceptance remain; WSL evidence is recorded separately from physical hardware |

Read/review inventory: README, AGENTS, architecture, implementation plan, product spec, release, validation, project report, routing comparison, local inference, design system and storage budgets; enumerated server/shared/frontend/tests/workflows/packaging. Focused code tracing: engine, budget, lifecycle, planning, router, task-fit, tool broker/policy, MCP, auth policy/remote, database/schema/store, startup and API registration. Other subsystems are initially inventoried; deeper review is required before changing them.

## Current official research and implications

Sources checked 10 October 2026. These support engineering decisions; they are not evidence that Relay's new behavior works.

- [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and validate permission at every request boundary. Apply durable account/task checks consistently inside broker dispatch, not only before a queued operation.
- [PostgreSQL explicit locks](https://www.postgresql.org/docs/current/explicit-locking.html): transaction-scoped locking can serialize schema upgrades. Use a fixed migration lock and transactional ledger/DDL, without a new database or framework.
- [PGlite API](https://pglite.dev/docs/api): transactions and data-directory dumps exist; dumps are PGlite-specific. A database dump alone does not back up Relay's referenced workspace/checkpoint files. Backup work therefore needs a quiesced manifest and restore validation.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence): checkpoints and cross-thread stores serve different scopes. Preserve Relay's durable receipts and explicit uncertain-effect handling; a framework swap would not itself solve approval replay.
- [llmfit upstream](https://github.com/AlexsJones/llmfit): useful hardware-fit advisor; catalog estimates cannot replace Relay's live authorization/resource admission or exact-artifact quality evaluation. No additional service installed.
- [LM Studio model loading](https://lmstudio.ai/docs/developer/rest/load): explicit configuration and local runtime management are separate from task intelligence. Preserve existing SDK/configuration checks.
- [W3C WCAG 2.2 reference](https://www.w3.org/WAI/WCAG22/quickref/): use for later interaction review, including focus, target size and accessible authentication. Automated axe checks are supplementary.

Research must be refreshed against official API documentation when each later integration is actually implemented; claiming to have read the entire Internet or guaranteed noninteraction would be misleading.

## First milestone design and acceptance

1. **Baseline:** finish deterministic tests, build and isolated Chrome suite. Record failures accurately before edits. Avoid production data and model inference.
2. **Broker authorization:** route host, HTTP and MCP dispatch through the same durable check already used for managed tools; verify durable user/version, task state/stop generation and permission-bearing context. Keep checks inside serialized boundaries. Preserve broker policy, exact approval binding, network pinning and interruption handling. Tests must prove revoked/forged authority reaches no filesystem or external side effect and valid calls remain functional.
3. **Migrations:** freeze the legacy cumulative SQL as an immutable compatibility snapshot. Marker-3 databases must never replay the owner provider grant. Pre-3 databases retain the existing one-time xAI/DeepSeek owner expansion; remote accounts receive no new providers. Execute a one-time reconciliation migration 4 for historical databases that already have marker 3 but may lack later additive columns. Subsequent migrations are ordered, checksummed and transactional. Reject unknown newer versions, invalid/gapped history and changed migration bodies. Serialize migration attempts. Test fresh/repeat initialization, historical upgrade preserving data/permissions, rollback and concurrency. Do not mutate the owner's database as an acceptance shortcut.
4. **Verification/report:** focused adversarial and upgrade tests, full check/build/browser run, package verification if packaging changes warrant it. Update AGENTS, validation and this ledger with exact commands, counts and platform limits.

## Dependency order and next milestones

1. Foundation milestone above.
2. Durable approval suspension, separate wait/active accounting and scheduler fairness/effective limits; migration runner supports new durable state. Checkpoint exact pending operations and define recovery/revocation before freeing slots.
3. Consistent backup/restore drills, non-destructive retention preview and explicit policies; required before destructive retention or broad schema evolution.
4. Cohesive engine components, structured handoffs and timing diagnostics.
5. Expanded classifier and realistic versioned evaluation; compare held-out task success to existing baseline without bypassing eligibility. No quality claim until actual measurements exist.
6. Validated task-specific graphs and secure development profiles/Git apply workflow.
7. Scoped project/preference memory, real consented integrations and durable scheduling.
8. Simple/advanced UI, accessibility/mobile review, client compatibility and native release validation.

## Progress and blockers

Implemented: unified durable broker dispatch checks; versioned transactional migrations with frozen legacy snapshot; historical upgrade, rollback and permission-race tests; responsive welcome, draft-safe starting points, labeled advanced controls, expandable scope explanation and factual execution overview. Focused migration/auth tests passed 19/19; focused browser tests passed 16/16. Final full-suite and package results are recorded in docs/validation.md and docs/evolution-report.md. Full directive phases remain partial, as the inventory table states. Live cloud/Google/Gmail/Calendar consent, native macOS/physical Linux GPU, signing infrastructure and independent security/accessibility assessments are external gates. They do not block isolated Windows foundation work.

## Frontend milestone acceptance and review

Added after the owner's request for an advanced UI on phone, PC and any window size. Applied existing frontend-design, responsive-web-design, React, accessibility and browser skills; installed official Vercel composition-patterns at pinned revision 063bee94c3f4df8453406c830b0a7df0f2860278. Design sources and decisions are in docs/design-system.md.

Acceptance: preserve drafts and permissions; starting points never auto-send; budgets survive collapsing Advanced; ordinary controls and approvals remain reachable at 320/390px; fluid tablet/desktop/wide layouts; no page overflow; populated short-window conversations retain stream-follow and Jump to latest; generation/model review cannot become objective verification; existing keyboard/reduced-motion and axe checks remain. Browser evidence is viewport emulation, not physical-device acceptance.

Review found and corrected a short-window scroll-owner mismatch. Browser checks found and corrected faint-text contrast and generation-only verification counting. No live model benchmark, external account action, production data migration or public deployment was used for acceptance.

Final evidence: strict typecheck + **900 deterministic tests passed / one skipped in 79 files**; production build passed; **75/75 browser cases passed**, followed by another build and **12/12 focused cases** after moving pending approvals above the overview. All three portable archive candidates passed checksum/member verification. See docs/validation.md for commands, timings, artifact paths and native verification limits. This completes the bounded foundation/UI milestone, not all phases of the directive.

## Core execution continuation

See [execution waits implementation plan](execution-waits-plan.md) and [implemented semantics](execution-accounting.md). Implemented migration 5, serialized active-budget suspension/resume, separate durable approval/resource counters, branch-aware accounting, bounded task slots, account-concurrency alignment and queue aging. Exact approvals, tool receipts, shared local inference lease and workspace/host locks are preserved. Queue-drain wakeups and asynchronous shutdown/cancellation admission checks were corrected. Fresh durable revocation is checked during approval polling and at existing dispatch boundaries.

Focused strict types and 55 deterministic cases passed after integration fixes. Review found delayed-write/closing budget races, post-await shutdown dispatch and revoked waiters trying to reacquire capacity before failing; each has a regression and fix. Full regression/build/browser results are recorded in docs/validation.md after execution. This does not implement backups, overall deadlines, automatic restart resume, a full performance UI, richer model evaluations or later phases.

Next dependency: consistent database-plus-artifact backup manifests and isolated restore drills, followed by explicit reference-safe retention policies. Before implementing that, inspect the current data-directory lock, OS credential storage, PGlite export support and native PostgreSQL backup behavior. Never treat a live filesystem copy or SQL-only export as a complete Relay backup.


## Connected model/reasoning continuation

Implemented the latest owner request as an extension of Phase 3 and Phase 6: per-account provider/model/effort drawer, model-specific native controls, API-persisted preference, economical Auto classification/ranking, exact-ID expiring prices, and Gemini thought accounting. No new service or model load. See [design and acceptance](model-controls-plan.md), [operation/contracts](model-selection.md), and [pricing provenance](provider-pricing.md).

Security: required models and manual effort cannot bypass provider grants, context/hardware, output caps or egress approval. Unknown prices cannot satisfy a strict cap. DeepSeek continuation checks run before quota/reservation; Auto adjustments are recorded. Prices are rechecked after waiting for human approval. Maximum effort is never automatically selected. No external clients gain orchestration tools.

Outstanding: real provider/billing acceptance, full evaluation harness and measured held-out success, remaining-budget-aware reranking, calibrated quality uncertainty, model residency profiling, and all other unfinished workstreams above. The original directive remains active in this ledger; this continuation does not mark those phases complete.


Combined verification: strict types plus **986 passed / one skipped in 85 files**, production build, full browser **82/83**, then **25/25** affected and new picker cases after test pacing corrected a shared-IP rate-limit collision. Product limits were unchanged. Final static types passed and stable screenshots were reviewed. Package results are in validation.md. The original full modernization remains partial; next independent core work is safe backup/restore, followed by reference-aware retention and realistic routing evaluations.

Combined validation archive: release/2026-10-10T10-43-41-308Z, three unsigned candidates verified by checksum and members. Not a native acceptance or deployment.

## Active continuation: recovery, evidence and bounded workflows (10 October)

The owner renewed the complete directive; work continues beyond the preceding UI milestone. No claim of overall completion or native/live integration acceptance is made.

- Retention: implemented an opt-in owner preview/one-use confirmation service, transactional fingerprint recheck, bounded batches and audit. Protects recovery references, uncertain effects, workspace/host mutation tasks, financial records and conversation results. API and Machine UI integrated. Thirteen module tests and integrated API checks passed; new browser coverage awaits the next build. No cleanup has run on user data.
- Handoffs: schema-validated task/graph/evidence references now replace unstructured dependency output for analysis/worker steps. Context compaction cannot discard the required handoff. Existing saved action/receipt context is retained on recovery. Model findings and assessments stay untrusted, separate from objective checks.
- Workflows: strict compiler and Engine integration support task-specific read-only analysis DAGs, bounded by depth and current durable remaining calls. The host still adds the sole implementation worker and reviewer. Legacy planner output remains supported; malformed/cyclic/overbudget output retains the existing bounded graph. Integration tests verify sequential dependency execution.
- Backups: implementing offline encrypted database-plus-file snapshots, verification and new-directory restore. Requires embedded backend identity and an exclusive offline backup guard. Restore invalidates sessions and stops execution; remote/listener/runtime startup is withheld pending owner review. Native PostgreSQL backup remains a separate implementation gate.
- Evaluations: versioned synthetic objective graders and exact provenance contracts implemented; migration 6 adds durable run claims/results. Fixture measurements cannot become routing evidence. Production local runner and API integration are in progress; no quality superiority or live benchmark result claimed.
- Coding: implementing opt-in pinned Node/Python/.NET container profiles with in-container preflight. Docker is unavailable here; no host-shell fallback or silent image download.

Recent targeted verification: 41 integrated retention/context/handoff tests passed; 29 adaptive execution/migration tests passed. Global types briefly encountered the backup agent's intentional red-test missing module while that implementation was in progress; rerun after modules stabilize. Full regression, build, browser and safe production activation remain required after integration.

### Integrated evidence and current work

Offline encrypted backup/verify/restore and CLI are implemented. Twenty native Windows isolated backup tests passed, including actual PGlite plus artifacts, wrong key, altered encrypted files, path/junction rejection, active guard and low disk refusal. Producer metadata pins PGlite compatibility; PostgreSQL workflow is still not implemented. Main startup records backend kind and honors offline/restore gates. No production data was touched.

The versioned evaluation now runs through Engine with shared lease, budget and mandatory memory monitoring, uses exact scope/identity, records attempts before calls, polls revocation and joins cancellation cleanup. Eleven integrated routing/Engine cases passed; 31 framework/store/runner cases passed separately. Model UI exposes an explicit local-compute evaluation action. Cloud benchmarks and executable-code evaluation remain absent. Matching results may contribute to Auto, but held-out real quality improvement is unverified.

Node/Python/.NET pinned development profiles are implemented with isolated runtime preflight; 17 focused sandbox/profile cases passed. Native Docker execution remains unavailable. The approved private project/preference memory repository/API passes seven cases; UI and bounded task-context integration are added and await browser verification. Migration7 stores memory. Migration8 and durable scheduling service are in progress. Metadata-only diagnostic export and measured timing views are in progress. No feature above grants arbitrary host commands, package-network access, or automatic original-repository publication.

Review caught optional context eviction of compiled assignments and acceptance criteria. A failing regression reproduced it; protecting those inputs now passes all five context-integrity cases. Global types are rerun after all concurrent new modules finish their red-test stage.

### Combined continuation gate and live activation

All current implemented modules pass strict types and the full 1,134-test deterministic gate (one platform skip), production build and 100/100 Chrome cases. Focused checks and corrected findings are recorded in validation.md. The actual stopped production dataset was encrypted, verified and restored into a separate private directory before the original host restarted with migrations through version 8. Fifteen visible conversations and all six paused/two waiting tasks remain. Live phone/desktop panels and launcher readiness passed; no model generation was requested. Private recovery locations are recorded only in ignored `output/evolution-backup.json`.

Next independent implementation work remains secure original-repository publication, executable coding evaluations/held-out routing comparison, optional integration tools with explicit egress policy, complete phase instrumentation and the external/native acceptance gates in the inventory. Do not call unfinished phases complete or treat direct read-only Google UI as agent send/calendar-write capability.

### Further implementation in progress — 10 October

- Startup ownership: confirmed two starters could race while removing a stale PID lock. Extracted acquisition with an exclusive short-lived startup guard, owned-file checks on cleanup, and backup interlock. Interrupted guard recovery fails closed and requires offline inspection. Five race/ownership tests and all 21 backup cases passed.
- Performance: implemented real adapter observations for first streamed content, managed load, stream consumption and verified cleanup, persisted separately from provider counters and displayed in task timing. No internal first-token or speedup claim. Full backend checks passed; browser and live measurement checks pending.
- Coding: implemented review-bound original-source publication, existing-file changes only, immutable previews, conflict hashes, durable partial/uncertain journals and separately reviewed rollback. Exact owner-session expiry/logout and host-task reservations are enforced. Native module tests passed; browser acceptance pending.
- Evaluation: implemented a separately versioned executable coding suite in the existing isolated Node profile; absence of a verified sandbox refuses before any model call. Appended migration 9 permits the separate report protocol without changing shipped migration 6. Fixture/upgrade tests passed; actual Docker execution and live quality comparison remain pending.
- Account tools: implemented explicit read-only Gmail/Calendar task consent, current account checks and durable local-only conversation restrictions, including fresh checks around cloud approval and dispatch. No sending, calendar mutation, HTTP/MCP egress or automatic shared-workspace writes from private account context. Backend regressions passed; live consent remains unavailable.
- Fresh runtime check: production LM Studio 9B greeting completed on 10 October at 12:24 UTC, persisted answer, zero remaining Relay instances; normal Safe admission allowed 4096 context and 100% GPU offload. This verifies a greeting on the pre-continuation running build, not the new code or broad reasoning/coding quality.

Final combined gate: strict types and **1,194 passed / one platform skip across 110 files on both Windows and Ubuntu WSL**, production builds and **110/110 Windows browser cases passed**. A stopped encrypted production backup and separate restore drill passed; migration 9 activation preserved 16 visible conversations and all six paused/two waiting tasks. Eight live desktop/phone panel checks passed without runtime errors. Version 0.1.2 metadata, release notes and startup documentation are updated; final live inference/archive evidence is in validation.md. Optional overall task deadlines are still unimplemented; no partial deadline code was added.
