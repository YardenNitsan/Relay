# Verification and release gates

This is the evidence ledger for the current implementation. Successful tests support their specific boundaries; they do not make the entire master directive complete or establish production security certification.

## Observed acceptance

On 2026-10-04, the Windows development host ran a real local task using Ollama 0.32.15 and `qwen3:4b-instruct`, with no cloud provider:

- Task `7cc17d4b-72fd-4782-bbe7-86db7c3c466c`, conversation `066b0d4e-5842-460d-a425-7e57372a9018`.
- Three model calls in approximately 15.3 seconds.
- Supervised file-write proposal waited for an exact-action approval.
- The broker created `greeting.txt` in a managed workspace, then the model requested an actual read-back.
- Content was exactly `Hello from Relay\n`, SHA-256 `d6cd70daa6301ada4f3c41bed4bc9b2d83c432cac25169e8193989ef2abaa7f7`.
- The task completed with persisted assistant output, tool evidence, activity and an inspectable diff.
- Estimated model peak was approximately 4.78 GB including weights, KV cache and buffers. Estimates were not labelled measured allocation.

The reproducible acceptance driver is `scripts/acceptance.mjs`; the local output is `output/local-acceptance.json` (ignored by Git). A mandatory-thinking Qwen variant first exhausted its output budget; that failure was diagnosed and the privacy/parser behavior fixed rather than declared success.

## Automated coverage

`npm run check` runs strict TypeScript and deterministic tests covering provider framing/tool continuation/truncation/cancellation, hardware profiles, bounded context, DAG readiness, database records, cost reservations, approval/revocation, file/link/traversal/secret attacks, checkpoints, uncertain recovery and the global stop latch. Protocol fakes never consume cloud credit.

`npm run test:e2e` runs actual Chrome against an isolated host using an explicitly labelled deterministic provider. Tests exercise streamed conversation persistence, approval and real file diffs, stop persistence, keyboard focus restoration, selected axe checks, and 1920×1080, 1440×900, 1024×768, 820×1180, 768×650, 390×844, 320×640 and 844×390 layouts. Screenshots are in ignored `output/playwright/`. The real product was also opened against its live local service and visually inspected.

Remote tests cryptographically sign test JWTs and check issuer/audience/signature, invitation binding, revocation, ownership, quota serialization and unchanged local operation. They do not substitute for a real public gateway deployment or penetration test.

## Final command evidence

- `npm run check`: strict TypeScript plus **163 tests across 16 files passed** (2026-10-05). Includes real HTTP stream lifetime/limit tests, cryptographically signed expiry tests, approval provenance and model-diversity routing regressions.
- `npm run build`: browser and compiled Node host built successfully. Main browser JavaScript is approximately 134 kB gzip; secondary managers load separately. Fonts are served locally.
- `npm run test:e2e`: **16 browser tests passed**. Additional cases cover persisted user policy changes/revocation and actual supervised approvals at 320/390 px with 44 px controls, accessible labels and axe checks.
- `npm audit --json`: **zero known advisories** in the pinned dependency tree at the time of checking. This is dependency evidence, not an application security audit.
- `npm start`: compiled host started on 127.0.0.1:4317 with embedded PostgreSQL and remote mode disabled, replacing the development watcher.
- `node scripts/smoke.mjs`: **passed** against the restarted compiled host. The previously completed real task, both messages and exact file diff persisted. An idle activity stream stayed open for 17 seconds and delivered a heartbeat, exceeding the formerly failing idle timeout. Evidence: `output/production-smoke.json`.
- `npm run package`: generated Windows ZIP, Linux tar.gz and macOS tar.gz distributions. `scripts/verify-package.mjs` checks SHA-256, required startup/build/notice files and excludes private data, source Git metadata and installed dependencies from archives.
- Windows standalone package: `npm ci --omit=dev` installed 183 production packages with zero reported advisories. The CMD/Node launcher started the copied host on port 4320, served the browser, created/read a persisted conversation and reported embedded PostgreSQL with remote access disabled. No source loader or development dependencies were used. The temporary service was stopped afterward. The initial PowerShell launcher was blocked by host execution policy; the final CMD launcher works without changing that policy.

A new real inference attempt on 2026-10-05 was correctly refused before loading: available physical RAM was approximately 10.25 GB while this model needed an estimated 4.78 GB plus the 6.77 GB host reserve. GPU utilization was 97% with approximately 9.74 GB in use by other activity. No unrelated processes were terminated and no reserves were reduced. The original successful real acceptance remains the live-inference evidence. The later durable measurement decorator is covered by seven persistence/identity tests; a measured profile from real inference after that change was **not observed** in the production restart smoke.

Screenshots reviewed include `relay-live-local-conversation.png`, `relay-live-local-activity.png`, desktop light/dark views, the owner Access dialog, and `relay-approval-320.png`. These show actual production records where named live, and explicit deterministic test fixtures for repeatable browser approval tests.

## Implemented guarantees and limits

| Area | Implemented | Remaining release work |
| --- | --- | --- |
| Local execution | Real Ollama discovery/streaming/tools, hardware admission, durable tasks and managed files | Broader architecture metadata/calibration; explicit runtime load/unload ownership; LM Studio memory calibration |
| Collaboration | Bounded role DAGs, independent specialists, synthesis/review, model fallback, objective tool evidence | Adaptive model-proposed plans, richer debate strategies, fully automatic bounded repair planning |
| Tools | Managed snapshot read/search/write/delete, hashes/checkpoints/diffs, isolated command broker | Structured Git/HTTP/browser/MCP tools, publishing changes back to a source repository, aggregate disk quotas |
| Security | Deterministic capabilities, exact approvals, stop, secret filtering, root/link checks, origin/CSRF, scoped data access | Owner pairing/per-account authentication for untrusted local accounts; independent audit/penetration test; native OS sandbox brokers; hostile same-user race resistance; unrestricted host mode |
| Remote | Separate authenticated listener, signed Access identity, invited users, grant/session revocation, per-user budgets and concurrency | Owner domain/identity/tunnel deployment, edge DoS configuration, real mobile remote acceptance, stronger process isolation |
| Providers | Optional official API adapters and OS vault abstraction, contract-tested streaming | Live credential-backed cloud acceptance, complete versioned capability/pricing metadata; no consumer subscription login |
| Platforms | Shared host, OS data/vault adapters, unified-memory logic, separate portable packages | Native Linux/macOS acceptance, container cancellation tests on each OS, signed installers/notarization and secure updates |
| Storage/context | Normalized PostgreSQL, replayable events, bounded role context, private native continuation | Native PostgreSQL concurrency acceptance, long-history pagination beyond current bounded windows, summaries/retrieval, retention policies |
| UX | Conversation, streaming, activity, approvals, changes, model/hardware controls, themes, responsive layouts, owner access | Broader manual assistive-technology testing, virtual mobile keyboard/device testing, large-scale log/performance validation |

The current environment has no running Docker engine, no native PostgreSQL service, no connected cloud API credentials, no public gateway account/domain, and no Linux/macOS machine. Those integrations cannot truthfully be certified here. Their absence does not prevent the verified local model and file-execution path.
