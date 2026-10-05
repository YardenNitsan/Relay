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
- [x] Tools/security: scoped grants, path/secret protection, managed snapshots/checkpoints, file tools, isolated command broker, exact-action approval and stop tests. Native unrestricted tools are intentionally unavailable.
- [x] Orchestration: role/model separation, bounded DAG modes, context selection, durable calls and evidence, pause/cancel/recovery semantics. Advanced adaptive planning remains future work.
- [x] API integration: protected loopback session, validated routes, persistent SSE, settings/providers/workspaces/artifacts, no key leakage.
- [x] Browser product: conversation streaming, command surface, activity and approvals, real model/hardware views, diff inspection, bounded history and themes.
- [x] Revised scope: cross-platform host interface, optional authenticated remote listener, user/provider/workspace grants, quotas, session revocation, owner controls and responsive phone surfaces.
- [x] Verification: deterministic integrations and adversarial tests, actual local generation, compiled backend restart/replay, browser E2E and visual screenshots. A final generation retry was safely refused under higher host resource pressure; no new inference success is claimed.
- [x] Review/fix: independent security/integration review, dependency audit, documented tested guarantees and release gates, runnable launch instructions.
- [x] Separate portable distribution archives, checksum/member inspection and standalone Windows startup with production-only dependencies. Native signing and actual Linux/macOS release validation remain outside this milestone.

## Ownership and interfaces

Root owns foundation, database, orchestration, API, integration and validation. Provider worker owns `server/providers/`, `server/hardware/` and their tests. Security worker owns `server/tools/` and its tests. Frontend worker owns `web/` after shared contract is published. No shared-file edits without coordination.

## Ledger

- 2026-10-04: Existing Harmonia and GuitarScaleViewer are unrelated; GuitarScaleViewer has extensive dirty changes. Both preserved. Installed Ollama lists three models. Docker engine and native PostgreSQL absent. Chose embedded PostgreSQL local operation with native connection support. Safe terminal boundary will fail closed when unavailable.
- 2026-10-04: Completed a real supervised local file-write/read-back task, with persisted response and SHA-256 evidence. Downloaded official small Qwen variants after the pre-existing models failed conservative admission; mandatory-thinking behavior was measured and fixed. Did not weaken safety reserves.
- 2026-10-05: Added durable model throughput profiles, current-policy and quota checks on task creation/resume, bounded per-user SSE connections and remote administration UI. Audited locked dependencies with no known advisories. Continuing final compiled-host, browser, packaging and restart validation; see `validation.md` for final command results and outstanding release gates.
