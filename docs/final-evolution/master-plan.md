# Relay final evolution implementation plan

> Execution: use the executing-plans workflow, with test-first boundary changes and review before integration. The owner's final evolution directive explicitly authorizes continuous implementation and professional design decisions without repeated approval.

## Objective and constraints

Evolve Relay from v0.1.2 into an evidence-backed AI execution environment with a completely redesigned frontend. Preserve user data, working features, authentication, account isolation, broker authority, local-first operation, hardware reserves and uncertain-effect recovery. The original owner directive in the session is authoritative; this plan organizes it rather than narrowing it. Overall status: **INCOMPLETE**.

Baseline: `9d563bc973dbcc177921ab918db88561c8280e48`, independently fetched from origin/main on 2026-10-10. Work on `modernization/final-evolution`; do not merge to main until applicable gates pass. No license choice or account-wide settings change is authorized. Harmonia and GuitarScaleViewer are unrelated and preserved.

Architecture: retain the TypeScript modular monolith, Fastify, PostgreSQL/PGlite, React, Vite and durable broker. Separate new frontend navigation, layouts, feature modules and semantic tokens from existing data contracts. Companion has its own local authority and an outbound authenticated encrypted transport; host proposals confer no client permissions.

## Review focus

- Revocation, emergency stop and deadlines while queued, awaiting approval, executing tools or committing results.
- Filesystem aliases, links, hardlinks, dirty Git state and unrelated user edits across Windows/Linux/macOS.
- Interrupted external effects, duplicate delivery and process restart; uncertain effects must never replay automatically.
- Unknown model quality, missing prices/telemetry and fallback with narrower permission; no invented zeroes or cloud grants.
- Long mixed Hebrew/English text, streaming, 320px and short-height layouts, keyboard focus, zoom and interrupted networks.

## Dependency-ordered work

### A1: Establish portable gates and the new evidence ledger (active)

Files: `.github/workflows/verify.yml`, test environment scripts/config, `tests/helpers/`, private-storage boundary only if investigation demonstrates a production defect, and this directory.

- [x] Fetch latest source; inspect current Actions jobs and open issues.
- [x] Run fresh locked installation, strict types/full tests, production build and browser baseline. Record every failure without attributing fixtures to real inference.
- [x] Reproduce CI filesystem alias and Windows ownership failures independently. Fix fixture provisioning without weakening production link/ownership refusal. Add behavior regressions for the new provisioning helper.
- [x] Separate bounded CI stages so a serial browser suite can finish; retain all three OS jobs and native evidence distinctions.
- [ ] Run check/build/E2E on the resulting source; obtain remote job results through an authorized branch/PR workflow.
- [x] Commit a coherent foundation change and update progress, exact checks and continuation. Later A02 hosted browser failures remain open until fixed and rechecked.

### A2: Reliability and native data acceptance

Trace `shared/types.ts`, `server/db/store.ts`, `server/orchestration/{budget,activity,engine,lifecycle}.ts` and `server/tools/index.ts`. Add `budget.maxElapsedSeconds` (30 seconds to 7 days, default 24 hours for newly admitted tasks), deriving the absolute deadline from immutable `createdAt`. This uses existing durable options/creation time without a schema rewrite. Historical tasks without the field retain their existing contract. Resuming never resets either value. Active execution time remains a separate budget.

Test first: new admission/default/validation; expired approval/resume/model reservation/final commit; historical compatibility; queued task behind occupied slots; active provider cancellation; approval wait; resource wait; restart recovery; interrupted tool uncertainty. Enforce inside the durable broker after queueing, not only the engine. A one-second sweep discovers bounded batches while independently owning active cleanup joins; shutdown joins discovery, cleanup and scheduler reads. Store expiry denies pending approvals and writes a durable reason; no successful tool receipt is erased. Migration 10 adds a partial index excluding terminal history. Host time is authoritative for admission and reconciliation, avoiding PostgreSQL host-clock disagreement. UI advanced controls and timing expose the distinction and absolute deadline. Full regressions and a browser approval check gate the change.

Run `scripts/native-integrations-docker.mjs` after infrastructure availability/provisioning review. Expand independent PostgreSQL migration contention and recovery fixtures to historical conversations, pending approvals, memory, schedules and grants. Test encrypted restore with production-like synthetic data and referenced artifacts, never casually open the real owner's database. Complete reference-aware artifact retention after reviewing every durable reference.

### B: Complete new frontend (begins during A; continues through C–G)

- [x] Research at least 15 accessible primary/firsthand sources; explicitly label unavailable pages and opinion evidence.
- [x] Compare three original concepts, select one, document tokens and screen architecture.
- [ ] Capture existing conversation, workbench, projects, models, connections, approvals, settings and onboarding as baseline.
- [ ] Implement semantic token/primitives layer, adaptive application shell and explicit feature navigation with preserved account gates.
- [ ] Replace conversation/composer and execution workbench; retain durable streaming, drafts, cancellation and first-class approval access.
- [ ] Replace projects/diff/test/publication, Model Studio, devices/connections, grouped settings and both onboarding paths.
- [ ] Inspect every major screen in both themes, desktop/mobile, loading/error/long-content/streaming states. Record captures and corrections. Test 320/360/390/768/1024/1440/1920/2560 and short landscape, zoom, focus and touch controls.

### B09 focused approval increment (verified; broader taxonomy open)

The reviewed 844x390 capture leaves approximately 96px for inline approval inspection after task chrome. Preserve inline decisions and exact backend authorization, but offer an explicit **Review action** surface that uses the available window. Select this over automatic modal interruption (would steal focus during streaming) and a permanent third pane (would worsen compact layouts).

- Lead with the deterministic operation and target, then consequences, execution host/workspace, model/agent provenance, deadline and exact arguments. Unknown tool consequences remain explicitly unclassified. Proposed file contents are untrusted text, not proof of an applied change.
- Reuse the native modal primitive. Keep a bounded content scroll and a separate reachable decision footer. Closing/Escape is dismissal only, never denial or consent. Restore focus to the trigger, or Workbench if the approval disappeared.
- Keep `allow_once`, `allow_task` and `denied` mutations unchanged. Display server rejection inside the focused review; no optimistic success. A stopped/revoked/expired task still relies on server enforcement and cannot gain authority through presentation.
- First write browser scenarios for 320px/desktop light/dark, 844x390, keyboard dismissal/focus, denied mutation, actual allowed write and rejected consent. An isolated Chrome component render reproduced the missing review surface before implementation; its short-screen and Escape-focus assertions now pass without touching the active fixture. Run integrated scenarios and inspect real captures after the frozen full-suite gate. Do not rebuild the currently served dist.

### C: Real coding execution

Review `server/tools/{store,files,git,git-baseline,sandbox,sandbox-worker,development-profiles,publication}.ts`, shared publication contracts, API and corresponding web modules. Build safe configurable workspace tiers, discovery/test profiles, multi-file create/delete/rename, independent Git worktrees and reviewed publication with conflict/rollback journals. Package restoration requires explicit approved sources/network and reproducible trusted images. Actual multi-file JS/TS, Python and .NET projects must build/test inside the sandbox; host shell remains unavailable to models.

### D: Intelligence and collaboration

Version English/Hebrew intent and hard-constraint benchmark datasets before classifier changes. Compare the v0.1.2 classifier with deterministic/semantic candidates on separate held-out cases; retain the better implementation if improvement is absent. Extend executable evaluation to real multi-file debugging, tool arguments, constraints, recovery and long context. Evidence is configuration-bound and never bypasses eligibility. Add safe multiple-worker graphs only after C isolation/publication; enforce resources, permissions, depth, calls/cost, cancellation and durable integration. Compare task outcomes and overhead to a single worker.

### E: Companion

Implement protocol, pairing/device identity, revocation, capability discovery, local folder grants, bounded receipts and offline state; then Windows/Linux local service and UI. Sensitive approvals are enforced locally. Use outbound authenticated encrypted host connection and replay-resistant task IDs. Adversarial tests cover stolen/revoked identity, replay, host permission escalation, path attacks and uncertain effects. Genuine two-computer acceptance is separate from loopback process integration. macOS requires its actual native boundary evidence.

### F: Memory and automation

Incremental project indexing and scoped fact/preference/untrusted/hypothesis records; retrieval comparison before embeddings. Inspect/disable/export/delete retained memory. Finish Google live reads when configured, then individually approved drafts/send/event writes with durable uncertainty/idempotency. Isolated browser operations with untrusted page boundaries. Broader scheduling/notifications follow secure mutation receipts, not precede them.

### G: Maturity and release

Run all fourteen acceptance scenarios, threat-model regression review, native platform checks, comparable application/hardware benchmarks, accessibility/visual review and package integrity gates. Propose branch protection only with repository-admin authorization. Keep unsupported claims and external gates explicit. Release only when the owner's definition of done is satisfied; no milestone or version bump substitutes for completion.

## Evidence contract

Every coherent milestone updates `progress.json`, requirements status and acceptance evidence. Store exact commands, commit identity, results, changed files, security reviews, external prerequisites and next work. Keep logs/screenshots under ignored `output/final-evolution/` during investigation; retain selected sanitized acceptance artifacts in versioned evidence when reviewed. No credentials or real user content in tracked artifacts. A session boundary requires `INCOMPLETE — CONTINUATION REQUIRED` and a precise recoverable handoff.

### C03 publication increment and next coding acceptance

The existing-directory presence-aware increment in publication-plan.md is verified: full1237test check/one skip, build, five actual UI publication cases and reviewed phone/desktop captures. Full C03 remains open for new directories and Git-aware workflow. Next, construct a repeatable coding acceptance against a substantial versioned source fixture, execute actual tests in the pinned isolated Node image, and separately attempt real local-model repair. Record seeded defects and independent outcome checks explicitly; never describe controlled provider output as actual inference. C02 independent Git worktrees and C04 dependency restoration remain required.
