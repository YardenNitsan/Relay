# Relay implementation plan

> Execute continuously under the user's explicit authorization. Use independent domain delegation, test-driven boundary work, integrated review and verification-before-completion. All changes stay in this new repository.

**Goal:** A real browser-to-local-model execution platform with durable tasks, deterministic permissions and truthful evidence.

**Architecture:** Strict TypeScript modular monolith, PostgreSQL persistence, Fastify API/SSE, React client, pluggable inference and isolated tools.

**Spec:** `product-spec.md` and the user's MASTER BUILD DIRECTIVE.

## Review focus

- Untrusted file names/content attempting capability escalation or credential access.
- Stop, revocation, approval races and browser/server reconnect without duplicate work.
- External changes, dirty source trees and interrupted mutations with ambiguous outcomes.
- Missing GPU measurements, too-large models and unknown cloud pricing/capabilities.
- Empty/disconnected UI, long output, keyboard focus and narrow/light theme layouts.

## Deliverables

- [x] Inspect existing workspace without altering other repositories; research alternatives and document architecture/design.
- [x] Foundation: package scripts, strict shared schemas, PostgreSQL migrations/repositories, lifecycle and event replay tests.
- [x] Providers/resources: real Ollama discovery/generation, fixed-endpoint cloud adapters, secure credential interface, hardware profiler and conservative memory admission tests. Live cloud, non-Windows hardware and container execution remain separately gated.
- [x] Tools/security: scoped grants, path/secret protection, managed snapshots/checkpoints, file tools, isolated command broker, exact-action approval and stop tests. The local owner can explicitly confirm bounded direct-host text-file access; arbitrary host commands remain unavailable.
- [x] Orchestration: role/model separation, bounded DAG modes, constrained model-proposed specialist plans, durable repair loops, budgeted context, durable calls and evidence, pause/cancel/recovery semantics. Arbitrary model-authored graphs and unrestricted debate remain outside the implemented scope.
- [x] API integration: protected loopback session, validated routes, persistent SSE, settings/providers/workspaces/artifacts, no key leakage.
- [x] Browser product: conversation streaming, command surface, activity and approvals, real model/hardware views, diff inspection, bounded history and themes.
- [x] Revised scope: cross-platform host interface, optional authenticated remote listener, user/provider/workspace grants, quotas, session revocation, owner controls and responsive phone surfaces.
- [x] Verification: deterministic integrations and adversarial tests, actual local generation, compiled backend restart/replay, browser E2E and visual screenshots. Acceptance records distinguish successful execution, safely refused hardware admission and failed verification; see the dated evidence ledger.
- [x] Review/fix: independent security/integration review, dependency audit, documented tested guarantees and release gates, runnable launch instructions.
- [x] Separate portable distribution archives, checksum/member inspection and standalone Windows startup with production-only dependencies. Native Linux core validation now runs under Ubuntu WSL2; native signing, macOS and platform installer acceptance remain release gates.

## 0.1.1 deliverables and remaining acceptance

- [x] Account-private cloud connections and model visibility, explicit owner provider/billing grants, approved/pending/denied remote identities and account-aware browser navigation. Consumer ChatGPT/Claude/Gemini subscriptions are not API credentials.
- [x] Ten selectable specialist profiles with trusted instructions and deterministic tool allowlists independent of model choice and computer access. No selection silently expands user capabilities.
- [x] Actual per-user personal task list/create/complete/delete through the tool broker, with supervised mutation approval, quota, stop/revocation checks and durable receipts. No notification service or calendar synchronization is claimed.
- [x] Optional separate LAN HTTPS listener configuration, protected TLS material checks, single-use account-bound invitations, owner controls and distinct LAN sign-out. Real certificate trust and another device remain unverified.
- [x] Scoped external-client tokens and local-model inference through bounded Responses, Chat Completions and Anthropic Messages subsets. Host scheduling, resource admission, quotas and cancellation apply. Client tool proposals are returned without host execution; only usage metadata is persisted.
- [x] Responsive specialist, account/provider, LAN and client-token interfaces; complete 46-case browser suite and visual inspection at desktop, tablet, phone and short landscape sizes.
- [x] Actual Qwen 4b external inference acceptance with returned output and unchanged conversation history; production build passed. Final native test totals belong in [validation](validation.md).
- [x] Free-tier-oriented Workers/VPC/Tunnel browser adapter candidate and deployment dry run. This does not establish a live URL or guarantee future third-party pricing.
- [x] Deploy the public browser Worker, Access policy, named tunnel and fixed VPC binding. Owner sign-in works; anonymous requests redirect and missing/forged gateway identities are rejected. The public address survives application updates.
- [ ] Complete physical-device streaming, logout, revocation and outage recovery acceptance; install tunnel autostart and investigate cellular DNS failures on the affected phone/network.
- [x] Integrate private file management, explicit device-folder synchronization, text/PDF/DOCX attachments, up-front permission choice, fresh local-model discovery, shared specialist routing, live pressure cancellation, visible model assignments and opt-in completion notifications. See the current release report for precise limits.
- [x] Implement per-user Gemini Google OAuth and owner setup guidance. Actual Google app registration and live consent remain owner-dependent acceptance gates.
- [ ] Configure trusted LAN HTTPS and validate a real second computer/phone, private data isolation, restart, revocation and certificate renewal.
- [ ] Complete live external-client compatibility for supported CLI configurations; reject unsupported protocol features until tested.
- [ ] Build supported Gmail/Calendar OAuth connectors with minimal consent, credential isolation and action approvals. Current profiles provide drafting/planning only.
- [ ] Run the current source on native Linux/macOS and representative hardware; verify real Docker/native PostgreSQL, signed installers and remaining release gates in [the report](project-report.md).

## Ownership and interfaces

Root owns foundation, database, orchestration, API, integration and validation. Provider worker owns `server/providers/`, `server/hardware/` and their tests. Security worker owns `server/tools/` and its tests. Frontend worker owns `web/` after shared contract is published. No shared-file edits without coordination.

## Ledger

- 2026-10-04: Existing Harmonia and GuitarScaleViewer are unrelated; GuitarScaleViewer has extensive dirty changes. Both preserved. Installed Ollama lists three models. Docker engine and native PostgreSQL absent. Chose embedded PostgreSQL local operation with native connection support. Safe terminal boundary will fail closed when unavailable.
- 2026-10-04: Completed a real supervised local file-write/read-back task, with persisted response and SHA-256 evidence. Downloaded official small Qwen variants after the pre-existing models failed conservative admission; mandatory-thinking behavior was measured and fixed. Did not weaken safety reserves.
- 2026-10-05: Added durable model throughput profiles, current-policy and quota checks on task creation/resume, bounded per-user SSE connections and remote administration UI. Audited locked dependencies with no known advisories. Continuing final compiled-host, browser, packaging and restart validation; see `validation.md` for final command results and outstanding release gates.
- 2026-10-06: Continued owner pairing, adaptive execution and resource policy work under [the continuation plan](continuation-plan.md). Added actual Linux runtime verification, session revocation recovery in the browser and research-backed frontend refinements. A live model's unsupported read-back claim failed acceptance; explicit completion requirements now bind to recorded tool evidence. The fresh actual Ollama run passed all original criteria, followed by restart/persistence/SSE verification. Windows and Linux each passed 249 deterministic tests. Release evidence remains explicit about unavailable cloud credentials, native macOS and a public gateway.
- 2026-10-09: Added 0.1.1 shared-host accounts, per-user cloud connections, ten specialist profiles, personal task persistence, optional LAN invitations and metadata-only external inference. Actual local inference acceptance and all 46 browser cases passed. Public Worker dry run passed; public deployment and LAN second-device acceptance remain outstanding. Historical test counts do not certify the current code on other operating systems.
