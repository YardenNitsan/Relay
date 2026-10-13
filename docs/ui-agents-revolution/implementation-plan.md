# Relay UI and agents revolution

Status: **INCOMPLETE — CONTINUATION REQUIRED**. Started 2026-10-12.

## Superseding owner scope: final web and Android completion

The latest owner instruction narrows all remaining work to the complete Dispatch web frontend and native Kotlin/Compose app. No new agent improvements, standalone coding benchmarks, AI routing, unrelated backend features or other roadmap phase. Earlier milestones below remain historical; incomplete agent-cooperation items are no longer a continuation task. Backend changes require a direct secure web/native integration need.

Current native completion milestone after verified0.4: separate project browsing from task context to prevent stale cross-workspace file navigation; render real host-recorded task patches read-only; add bounded safe native Markdown/code presentation. Preserve authenticated contracts, approvals and all security boundaries. No new backend or routing features. [0.4 delivery and limits](android-0.4.md).

Current implementation sequence:

1. Resolve exact published-head browser failures while preserving useful assertions and security boundaries. Correction3346190 passed all12 host/browser OS jobs; subsequent source changes require fresh published-head acceptance.
2. Finish Dispatch conversation/composer/execution presentation, then Projects, Models and supporting account/configuration surfaces; preserve drafts, guarded mutations, permissions and real actions. Verify actual rendered desktop/tablet/phone screens in both themes.
3. Verify the native client against an isolated real authenticated LAN HTTPS backend, then complete secure enrollment/remote flow, native chat/history/stream/task/approval/project/reconnection/notification workflows and original responsive Compose presentation. Do not treat a JVM fixture as physical or installed-app acceptance.
4. Establish an isolated test instance for the owner's PC, and use only a configured authorized trusted LAN/remote route for phone access. Missing certificate trust, Cloudflare OAuth/client configuration or physical-device access are explicit external gates, not reasons to bypass security. Do not replace production or expose a new public endpoint.
5. Run web/native/security/CI acceptance, build and install the final APK with stable signing/checksum, verify available URLs, update all relevant README/setup/security/access/troubleshooting/release/acceptance/continuation documents, remove only proven obsolete UI code, review/commit/push intended changes and verify remote HEAD.
6. Deliver exact commit, verified web URLs, real APK/checksum/instructions and limitations, then STOP development. If a session limit intervenes, commit/push verified progress and mark incomplete; do not claim completion.

> Execution: apply the executing-plans workflow with independent domain research and final review. The owner explicitly authorizes continuous implementation, three rendered concepts, autonomous concept selection, coherent commits and reviewed pushes. No additional design approval is inferred as necessary. This plan organizes the owner's complete directive; it does not reduce its acceptance criteria.

## Goal and architecture

Replace Studio's navigation and visual composition with an original agent-centered web application, strengthen real agent work, and deliver a secure native Kotlin/Compose client with an actual installable APK. Relay Host remains authoritative for all business logic, permissions, inference admission and durable work. Both clients consume authenticated shared contracts. Keep production unchanged.

Baseline: `fda18f490d30befc66be88f25bad4e5f44c49b5d`. Source worktree: `Relay-revolution`, branch `modernization/ui-agents-revolution`, descendant of `modernization/final-evolution`. The older checkout has unrelated uncommitted publication/Git work and router experiments; do not import, overwrite or stage them. The original final-evolution ledger remains historical evidence.

## Global constraints

- No AI routing research, benchmarks, new models, tuning or decision changes. Preserve model/provider/privacy/lifecycle/hardware interfaces.
- No production deployment, main merge, new public endpoint or router/network forwarding changes. Preserve Cloudflare Access/Tunnel and authorized LAN.
- Never broaden broker authority for agent success. Keep per-effect checks, isolation, quotas, cancellation, uncertainty journals, account/workspace/device revocation.
- Keep private keys, credentials, cookies, real private content and generated toolchains out of Git. Do not print them.
- Browser fixture 4319 serves built `dist`; one fixture at a time, no concurrent rebuild. Keep heavy inference separate from builds/tests.
- Native Kotlin/Compose is the default; no WebView wrapper. APK delivery requires an existing successful build, checksum and stable signing identity; no physical phone claims without evidence.
- Maintain drafts, scroll ownership, input focus, exact file bytes, mutations and all existing features while replacing their presentation.

## Milestones

1. **Audit and research:** Read operating rules, old ledger, actual web/runtime/API/security source. Reproduce Linux 768×1024 search failure before any fix; preserve failure artifacts. Record research and skills provenance, agent capability matrix, API and threat model.
2. **Three rendered concepts:** Build distinct Dispatch, Ensemble and Deliveries prototypes with clearly synthetic tasks, useful simulated interactions, desktop/mobile and themes. Capture real browser screenshots, compare against practical criteria and select with written rationale. These are prototypes, not shipped workflows.
3. **Core application architecture:** Replace persistent Studio rail with selected concept's navigation and hierarchy. Keep domain state/API hooks, separate presentation modules. Add behavior tests before integration; measure keyboard/focus/draft preservation at breakpoints.
4. **Essential surfaces:** Rebuild conversation, task execution, project workspace and Agent Studio around actual backend evidence. Integrate approvals, code/diffs, task switching, long histories and real error/reconnection states.
5. **Agent reliability/cooperation:** Reproduce gaps, then correct effective-capability preflight, explicit planner/reviewer handoffs, bounded recovery and isolated collaboration. Benchmark unchanged real coding objectives with independent grading; retain every outcome.
6. **Shared contracts:** Version mobile-facing DTOs and error/replay contracts. Authenticate and authorize every operation/stream; add revocable device identity without bypassing Access. Verify compatibility, ownership and reconnect behavior.
7. **Android architecture:** Pin verified stable Kotlin/Compose/AndroidX/Gradle/SDK dependencies, native visual system and lifecycle-aware state. Review supply chain and signing before building.
8. **Android functionality:** Secure host enrollment/auth, chat/streaming/history/drafts, agent tasks, plans/tools/results, code/diffs, approval/denial with step-up where appropriate, safe notifications, file/share/deep-link/back integration and reconnect.
9. **Remaining web:** Models, connections, MCP, devices, memory, schedules, history, usage, settings, host/account/permissions; all visible controls functional.
10. **Cross-platform reliability:** Real execution, durable reconciliation, quotas/cancellation, keyboard/rotation/font scale/network loss and safe device revocation.
11. **Acceptance:** All 30 owner scenarios, all required widths/themes, browser screenshots/axe/keyboard, Android instrumentation/emulator, real backend outcomes, security regressions and independent review. Label external/hardware gates honestly.
12. **APK delivery:** Reproducible signed testing APK (debug clearly labeled if no release identity), stable key outside Git, SHA-256, app/minimum OS versions, installation and upgrade instructions. Verify actual file exists and launch/install evidence.
13. **Handoff:** Performance/security findings, CI, release notes, exact commit, artifact paths and continuation. Do not mark complete until full criteria pass.

## First implementation task: tablet search

Files: `tests/e2e/projects-studio.spec.ts`, `web/features/projects/ProjectFiles.tsx`, `ProjectWorkspace.tsx`, `projects.css` only as root cause requires.

- [x] Inspect source and baseline commit, establish isolated dependency/build setup.
- [x] Run unchanged focused Windows case (2 passed; not Linux reproduction).
- [x] Run native Linux browser and retrieve CI failure detail.
- [x] Produce deterministic regression for confirmed cause, preserving existing assertions/timeouts.
- [x] Implement smallest fix; run affected project/source/editor/draft cases and inspect screenshots.
- [x] Review, document exact evidence and commit (`754bd01`).

## Review focus

1. A delayed list/query response must not erase accepted mutations or newer drafts.
2. Breakpoint changes and replaced views must transfer focus to a visible equivalent without losing conversation state.
3. Stream resume must use only applied, session-bound cursors and revoke immediately.
4. Agent verification prerequisites must match the effective profile/tool intersection, never grants from model output.
5. Native redirects, lifecycle/background return, notifications and backups must not expose or widen authority.

## Rulings

- Use a named ordinary sibling worktree because imported paths reject hidden ancestors and the modernization worktree is dirty. Native worktree tooling cannot specify this repository/path; explicit repository isolation takes precedence.
- Retain the user's phase-specific ledger instead of creating duplicate skill bookkeeping directories.
- Independently inspect Android and agents while reproducing UI failure; their documentation ownership is disjoint and no agent runs competing fixture/model workloads.
