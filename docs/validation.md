# Verification and release gates

This is the evidence ledger for the current implementation. Successful tests support their specific boundaries; they do not make the entire master directive complete or establish production security certification.

## Current working handover (2026-10-08)

At the owner's request, the current application was built and started as a browser web app even though the entire product specification is unfinished. The compiled Windows service listens at `http://127.0.0.1:4317`, with embedded PostgreSQL, actual installed Ollama models and remote access disabled. The full handover and remaining backlog are in `../RELAY_PROJECT_REPORT.md` relative to the project root (the workspace-level report).

- Latest `npm run check`: **362 tests across 39 files passed**, including strict TypeScript. New coverage includes durable execution/iteration reservations, history/search/retrieval, independent network grants, actual Git inspection, HTTP/MCP boundaries, runtime measurement identity, storage budgets and bounded sandbox export. Official MCP SDK integration uses deterministic DNS/HTTPS responses.
- `npm run build` passed; browser entry JavaScript is 139.14 kB gzip, with separate lazy operational panels.
- Final `npm run test:e2e`: **29/29 Chrome cases passed**. Two initially failing assertions were corrected to identify the account status instead of a same-named select option, and to assert the actual effective default-deny network policy. Product permissions were not relaxed.
- `npm run test:e2e -- --config playwright.production.config.ts`: **1/1 passed** against the real running service. It verifies a previously completed real task, installed model discovery, hardware panels, themes, desktop/320px navigation and selected axe checks. This is distinct from the fixture-provider browser suite. Screenshots: `output/playwright/production-conversation-light.png`, `production-conversation-dark.png`, `production-models.png`, `production-hardware.png`, `production-phone-navigation.png`.
- New actual Ollama task `ddaefd0f-6674-4d05-981c-b5851db2d979` was admitted and performed an exactly approved write of `Hello from Relay\n`, with matching broker SHA-256 evidence. It then **paused** before the next call because available physical RAM fell below the unchanged Safe reserve. It did not perform the required separate read and is not a completed acceptance. Evidence: `output/local-acceptance-paused-20261008.json`. The extended model-driven calibration/Git/HTTPS acceptance did not execute because its prerequisite acceptance failed to finish.
- The earlier 6 October fully completed local acceptance and restart smoke remain historical evidence. The current production browser test explicitly inspects that completed task; it does not reclassify the new paused task as successful.
- Actual Docker/native PostgreSQL integrations and native package build recipes/CI were added. **No native installer was produced, installed or signed, and no actual Docker/native PostgreSQL test completed.** Docker inspection and the official Node runtime download required outside-sandbox approval and were subsequently aborted. No remote CI execution is claimed.
- Native Linux's earlier 249-test source snapshot predates these additions; current Linux/macOS verification remains outstanding. Live cloud credentials/public gateway acceptance and physical mobile-device testing remain outstanding.

Latest functionality supersedes the older tool/history backlog below: structured Git inspection, public HTTPS research, controlled MCP, history pagination/full-text retrieval, bounded calibration and aggregate artifact storage checks are now implemented. They still need the live/native/interoperability evidence described above and in the workspace report.

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

## Earlier milestone command evidence (2026-10-05)

- `npm run check`: strict TypeScript plus **163 tests across 16 files passed** (2026-10-05). Includes real HTTP stream lifetime/limit tests, cryptographically signed expiry tests, approval provenance and model-diversity routing regressions.
- `npm run build`: browser and compiled Node host built successfully. Main browser JavaScript is approximately 134 kB gzip; secondary managers load separately. Fonts are served locally.
- `npm run test:e2e`: **16 browser tests passed**. Additional cases cover persisted user policy changes/revocation and actual supervised approvals at 320/390 px with 44 px controls, accessible labels and axe checks.
- `npm audit --json`: **zero known advisories** in the pinned dependency tree at the time of checking. This is dependency evidence, not an application security audit.
- `npm start`: compiled host started on 127.0.0.1:4317 with embedded PostgreSQL and remote mode disabled, replacing the development watcher.
- `node scripts/smoke.mjs`: **passed** against the restarted compiled host. The previously completed real task, both messages and exact file diff persisted. An idle activity stream stayed open for 17 seconds and delivered a heartbeat, exceeding the formerly failing idle timeout. Evidence: `output/production-smoke.json`.
- `npm run package`: generated Windows ZIP, Linux tar.gz and macOS tar.gz distributions. `scripts/verify-package.mjs` checks SHA-256, required startup/build/notice files and excludes private data, source Git metadata and installed dependencies from archives.
- Windows standalone package: `npm ci --omit=dev` installed 183 production packages with zero reported advisories. The CMD/Node launcher started the copied host on port 4320, served the browser, created/read a persisted conversation and reported embedded PostgreSQL with remote access disabled. No source loader or development dependencies were used. The temporary service was stopped afterward. The initial PowerShell launcher was blocked by host execution policy; the final CMD launcher works without changing that policy.

A new real inference attempt on 2026-10-05 was correctly refused before loading: available physical RAM was approximately 10.25 GB while this model needed an estimated 4.78 GB plus the 6.77 GB host reserve. GPU utilization was 97% with approximately 9.74 GB in use by other activity. No unrelated processes were terminated and no reserves were reduced. A measured profile was not observed in that earlier restart smoke.

Screenshots reviewed include `relay-live-local-conversation.png`, `relay-live-local-activity.png`, desktop light/dark views, the owner Access dialog, and `relay-approval-320.png`. These show actual production records where named live, and explicit deterministic test fixtures for repeatable browser approval tests.

## Continuation evidence (2026-10-06)

The real model exposed a verification gap: it wrote the correct file, which the broker verified, but claimed it had requested `file_read` when it had not. Task `b720721d-ab10-44b2-a1ae-56dab6cfda66` was recorded as completed by the then-current engine, but the acceptance driver correctly returned **failed**. The report is retained in `output/local-acceptance-unverified-read-20261006.json`. A successful write check cannot establish that a separately requested read happened. [Explicit verification contracts](adr-013-required-verification-contracts.md) now enforce required reads against actual durable tool evidence; this does not claim to verify arbitrary prose.

Final strict types and **249 tests across 24 files passed on Windows and native Linux** with the completion contract included. Native Linux additionally passed build and nine compiled-host checks under Ubuntu WSL2. These checked actual POSIX modes, paired sessions, PostgreSQL persistence, Linux telemetry, SSE heartbeat, redaction and two graceful shutdowns. See [Linux validation](linux-validation.md) for the precise source snapshot and limits. The Linux source SHA-256 is `e65a3890ff1ada037160c27398d29396cf3f65352d4a09728cbc489c42a13c9d`.

The fresh real Ollama acceptance **passed** at 18:15 UTC: task `be5cd71f-fa1e-43d3-b390-5577cd34ac59`, conversation `134aeb10-1c36-4f70-bff6-093c7c157f04`. Three calls in 15.4 seconds performed an exactly approved write, an actual separate read and a passing expected-hash contract. The original independent acceptance criteria were preserved. Safe reserves remained unchanged; model peak remained an estimate of 4,778,995,179 bytes. This confirms the explicit contract path, not universal natural-language truth detection.

After restarting the compiled service, `node scripts/smoke.mjs` **passed** at 18:16 UTC. Both messages, exact file content and the completed task persisted. The model profile restored an actual runtime-reported generation sample of 164.0 tokens/second with persisted provenance; this short run is not a general benchmark or peak-memory calibration. The SSE stream remained open for 17 seconds and delivered a real idle heartbeat. Reports: `output/local-acceptance.json` and `output/production-smoke.json`.

The final full Chrome suite passed **all 24 cases in 1.6 minutes** against the final built browser and isolated real backend. These cover owner pairing, saved versus draft resource settings, session revocation, late-response races, no background polling after access is revoked, actual managed-file approvals/diffs, stop, keyboard behavior and eight viewport sizes. See [frontend evidence](frontend-research.md) for sources and visual artifacts. The production browser bundle is 136.30 kB gzip. `npm audit --json` on 2026-10-06 reported zero known advisories.

The compiled Windows service runs at `127.0.0.1:4317` with embedded PostgreSQL and remote mode disabled. Legacy data was copied into actual-owner-protected storage, with matching SHA-256 fingerprints for 1,079 files; the original remains in a local ignored backup. The sandbox account cannot read owner pairing files. Restart smoke now refuses a failed acceptance report and requires an actual SSE heartbeat, rather than merely observing an open stream.

Updated Windows ZIP, Linux tar.gz and macOS tar.gz archives were generated on 2026-10-06. `scripts/verify-package.mjs` passed all SHA-256 and member checks (89 entries per archive), including the compiled owner-pairing CLI and native startup templates. No private data, credentials, installed dependency trees or Git metadata were included. They remain portable Node.js distributions requiring destination dependencies; signing, notarization and native installers are not claimed.

## Implemented guarantees and limits

| Area | Implemented | Remaining release work |
| --- | --- | --- |
| Local execution | Real Ollama discovery/streaming/tools, hardware admission, durable throughput, owner resource profiles and runtime residency | Broader architecture metadata/calibration; explicit runtime load/unload ownership; LM Studio memory calibration |
| Collaboration | Bounded role DAGs, constrained specialist proposals, synthesis/review, bounded durable repair, fallback and actual tool evidence | Arbitrary adaptive graphs, richer debate strategies and broader task-specific verification contracts |
| Tools | Managed snapshot read/search/write/delete, hashes/checkpoints/diffs, isolated command broker | Structured Git/HTTP/browser/MCP tools, publishing changes back to a source repository, aggregate disk quotas |
| Security | OS-account-protected owner pairing, deterministic capabilities, exact approvals, stop, secret filtering, root/link checks, origin/CSRF, scoped data access | Independent audit/penetration test; native OS sandbox brokers; hostile same-user race resistance; unrestricted host mode |
| Remote | Separate authenticated listener, signed Access identity, invited users, grant/session revocation, per-user budgets and concurrency | Owner domain/identity/tunnel deployment, edge DoS configuration, real mobile remote acceptance, stronger process isolation |
| Providers | Optional official API adapters and OS vault abstraction, contract-tested streaming | Live credential-backed cloud acceptance, complete versioned capability/pricing metadata; no consumer subscription login |
| Platforms | Windows execution/browser acceptance, native Linux core under WSL2, shared host, OS adapters, unified-memory logic and portable packages | Native macOS, Linux GPU/browser, container cancellation tests on each OS, signed installers/notarization and secure updates |
| Storage/context | Normalized PostgreSQL, replayable events, bounded role context, private native continuation | Native PostgreSQL concurrency acceptance, long-history pagination beyond current bounded windows, summaries/retrieval, retention policies |
| UX | Conversation, streaming, activity, approvals, changes, model/hardware controls, themes, responsive layouts, owner access | Broader manual assistive-technology testing, virtual mobile keyboard/device testing, large-scale log/performance validation |

No cloud API credentials, owner public gateway/domain, native macOS host or native PostgreSQL service have been provided for live acceptance. Linux is now available through the existing Ubuntu WSL2 distribution. The last observed Docker engine state was unavailable; container execution is not claimed as tested. These limits do not prevent the installed local inference and managed-file path.

## 9 October 2026: answer behavior and handover

Balanced-mode review no longer replaces a valid answer merely because a reviewer omitted its required verdict. Such failures retry the review alone within the durable call/iteration budget. A genuine revision request still repairs the answer against the original objective. During execution, the conversation presents fixed factual activity labels; those labels disappear when the task finishes. Supervisor completion commentary is not appended to the answer.

Unrestricted mode remains intentionally unavailable: both browser and backend reject it until a tested OS host-access broker exists. This is unrelated to owner pairing or provider credentials. Autonomous workspace remains the strongest supported scope; isolated terminal execution separately requires a verified container boundary.

The latest actual Ollama greeting check paused before model dispatch because available RAM did not satisfy Safe-profile headroom. This is a resource-admission result, not a successful live greeting acceptance. Deterministic backend and browser regressions separately exercise the corrected answer/review behavior.

Final handover checks on 9 October: strict types and 369 deterministic tests passed across 40 files; production build passed. The 30-case browser run passed 29 cases and hit one connection-indicator timeout; that exact keyboard/accessibility case passed on its focused rerun. The running production host passed desktop/phone inspection of persisted execution, discovered models and hardware. No fresh successful local greeting is claimed.

The Windows launcher passed actual cold build/start, repeat-start reuse, private graceful shutdown, restart and automatic browser/private pairing-file opening. The detached host remains available at http://127.0.0.1:4317. Missing-Node bootstrap, a genuinely fresh dependency installation, Linux/macOS launcher execution and native installers remain unverified. README.md and docs/user-guide.md describe architecture and the complete implemented user experience; docs/setup.md describes one-command setup. Optional model runtimes and model weights are not silently installed.

## 9 October follow-up: conversation management and direct host files

Added confirmed conversation deletion to responsive history. Deleted conversations are excluded from ordinary history, search, retrieval and user-scoped task reads; stored records remain for audit/usage. Unfinished tasks must be stopped first, and workspace files remain untouched. Fixed duplicate first chats by atomically admitting the conversation and objective with an idempotent request; the complete retry payload survives reload. Delayed submissions preserve newer drafts and navigation.

The local owner can now confirm **Unrestricted · host files**. Four real native operations list/read/write/delete bounded text files at absolute paths. Installation/data/system/vault paths, links, hard links, PowerShell profiles and recognized credential-bearing file mutations are denied. Existing-file writes preserve file identity and permissions; interrupted effects retain private recovery records and block automatic replay. Host tasks are serialized, and their final file hashes are rechecked before completion. This supersedes earlier statements that every unrestricted option was disabled: **arbitrary host commands remain unavailable**, and terminal execution still requires the container boundary. See docs/host-access.md for exact limits, including no automatic host-checkpoint restore UI or hostile same-user isolation claim.

Verification: strict types and **403 tests across 44 files passed**, including 25 native host-file boundary cases and real broker write/read plus external-change detection. Production build passed. The 37-case browser run passed 36 and exposed a test assertion mismatch for a disabled option; the corrected host-access file passed both cases on rerun. All new conversation cases passed, including failed admission, lost responses with nondefault options, navigation/draft preservation, confirmed deletion and unfinished-work refusal. Phone screenshots and automated accessibility checks were inspected. The restarted production host passed browser checks of saved work, models, hardware, new host-access confirmation and deletion controls. No new live-LLM inference success or Linux/macOS host-file validation is claimed.
