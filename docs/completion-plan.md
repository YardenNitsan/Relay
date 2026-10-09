# Remaining capability implementation plan

The owner explicitly requested continuous implementation through remaining work. Routine architecture and library decisions are delegated to engineering judgment; no intermediate planning approval is required. The master directive remains authoritative.

## Design and decisions

Keep the verified modular host and shared responsive browser. Add connected capabilities through existing task, capability, audit and persistence boundaries. A tool description cannot grant authority. Source repository configuration never runs in the host. Web content remains untrusted and outbound network access is independent of file/cloud access.

1. Durable execution limits: reserve small time slices in PostgreSQL before execution, enforce a monotonic process deadline and settle unused reservation on orderly pause. A crashed host retains its latest reservation, so restart cannot reset consumed time. Persist per-step iterations; preserve the original call/cost/repair limits. Tests cover resume, crash, concurrent reservations and no dispatch after expiry.
2. History and retrieval: keyset pages preserve exact database timestamps and ownership. PostgreSQL full-text search with the `simple` configuration finds older messages without an embedding service. Same-conversation retrieval supplies bounded source-referenced excerpts as untrusted context. UI exposes real search and older-message pages while keeping current SSE behavior. Tests cover equal timestamps, inaccessible IDs, Unicode budgets and long history.
3. Controlled research: `http_get` accepts a validated public HTTPS URL and an explicit origin-scoped task network policy, capped independently by account policy. Resolve and pin public destinations, revalidate redirects, reject private/special IPs and credential-bearing URLs, and bound duration/transfer/output. No arbitrary headers, browser cookies or host credentials.
4. Git inspection: create a service-owned bare object database from the managed snapshot; run fixed Git plumbing with filters, helpers, hooks and untrusted configuration disabled. Expose actual managed-baseline status/diff without importing source `.git` or claiming source branch status. Tests use actual Git and malicious source fixtures.
5. Native integrations and distribution: probe available Docker/native PostgreSQL, exercise actual isolated commands/cancellation and SQL concurrency when available; build intentional platform installation workflows and record signing/execution requirements honestly. No public deployment or machine-wide permission weakening.
6. Model calibration and lifecycle: use observed runtime counters and current hardware admission for bounded owner-initiated calibration, persisted per model/runtime/hardware identity. Shared external runtime allocations remain outside Relay's unload authority. Add visible actual benchmark progress and cancellation.
7. MCP and remaining tools: research the current maintained protocol before implementation; integrate configured transports under deterministic schemas, scoped grants, explicit trust and network boundaries. Never let server annotations serve as authorization or run arbitrary host stdio servers unsandboxed.
8. Integrate and harden: meaningful adversarial tests, real local model workflows, isolated command and database acceptance, browser interaction/visual inspection, Windows/Linux native checks, portable/installer archive checks and documented external macOS/cloud/public-gateway validation.

The time design uses Node's monotonic [performance.now](https://nodejs.org/api/perf_hooks.html#performance-now) rather than wall-clock subtraction for live accounting. Database reservations are transactional and conservative after crashes; this avoids treating offline time as useful execution or resetting a timer on every resume. Retrieval follows PostgreSQL's [full-text search](https://www.postgresql.org/docs/current/textsearch.html). Network integrations follow the MCP project's [security guidance](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices) and will pin the protocol version actually implemented.

## Ownership and file boundaries

- Root: `server/orchestration/budget.ts`, engine integration, shared types, schema migrations, admission/API wiring, model calibration and final acceptance.
- Tool worker: `server/tools/network*`, `http*`, `git*`, broker/policy integration, actual tool/security tests and tool design documentation.
- History/frontend worker: `server/history/`, `server/api/history.ts`, history/conversation browser views and related tests. Root wires routes/schema and retrieval into the engine.
- Native integration worker: `scripts/native-integrations*`, platform packaging/installer workflows and real platform evidence.

## Execution checklist

- [x] Durable time and iteration budgets across pause/restart; deterministic recovery tests passed.
- [x] Authorized history pagination, full-text search and bounded context retrieval; backend/browser checks passed.
- [x] Explicit network grants and hardened HTTP research tools; boundary tests passed, extended real-model acceptance remains pending.
- [x] Real Git inspection of managed changes; actual Git integration checks passed.
- [ ] Actual isolated-command and native PostgreSQL validation where available.
- [x] Platform installer/build workflows implemented; actual native packages, installation and signing remain unverified.
- [x] Owner-initiated model calibration with observed measurement support; live calibration acceptance remains pending.
- [x] Controlled MCP integration; protocol/browser tests passed. External interoperability and remaining broader tools are pending.
- [ ] Full integrated security/backend/browser/real-runtime verification and updated release evidence.

Tests use deterministic providers for ordinary runs; real runtime/host acceptance is reported separately. No unchecked item is represented as delivered. External signing identities, cloud API accounts, a public domain and native macOS hardware cannot be fabricated; build and test everything locally possible before asking for any genuinely missing access.

On 8 October the owner explicitly requested a running handover even if the full backlog was unfinished. Current Windows build, 362 deterministic tests, 29 fixture-provider browser cases and one actual-host browser case passed. A new actual model task paused on changing RAM pressure after its approved write, so it is not counted as completed acceptance. See `docs/validation.md` and the workspace-level `RELAY_PROJECT_REPORT.md` for remaining priorities.
