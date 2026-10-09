# Relay — working application and completion report

**Updated: 9 October 2026 · version 0.1.1.** This report covers the implementation in `Relay/`. Harmonia and GuitarScaleViewer are separate projects and were preserved.

## Current report

Read [the current 0.1.1 release report](release-0.1.1.md) for the latest implemented features, deployment, verification and remaining work. The public gateway is now deployed and the owner has signed in remotely. The sections below retain earlier engineering evidence and must not be read as the latest deployment checklist.

## Earlier 0.1.1 handover snapshot

Relay is a working local-first execution platform, with optional shared-host accounts and external inference. **The entire master directive is not complete.** Local operation does not require a cloud account, Google login or a public gateway. The following is the current status; later dated sections preserve earlier evidence.

| Capability | What works now | Boundary |
| --- | --- | --- |
| Shared-host accounts | Approved users have private conversations, scoped models/workspaces and their own permitted cloud credentials. Pending and disabled accounts receive clear sign-in states. | Google/Access login identifies a user; it does not unlock a consumer AI subscription or lend the owner's API keys. Live cloud acceptance is outstanding. |
| Specialist agents | Email, Calendar, Research, Coding, Files, Personal assistant, Browser, Finance, Learning and Computer profiles share the orchestrator. Model, depth and access controls stay independent. | Profiles filter tools; they cannot increase authority. Email/calendar actions need unimplemented connectors. Browser/Computer labels do not imply interactive browser or desktop automation. |
| Personal tasks | A real per-user list supports create, list, complete and delete, with durable receipts, quotas and deterministic approval/revocation checks. | No scheduled notifications, background reminder delivery or calendar synchronization. |
| Owner host files | Explicitly confirmed local-owner tasks can list/read/write/delete bounded text files through protected native tools. | Credentials, system and Relay paths remain protected. No arbitrary host shell; isolated terminal still requires a verified container boundary. |
| LAN browser access | Separate HTTPS configuration, certificate/key checks, account-bound five-minute invitations and account/session controls are implemented. | Real LAN configuration, trusted client certificates and second-device acceptance are outstanding. Nearby network access never grants owner privileges. |
| External model clients | Account-scoped, expiring/revocable tokens provide local-model inference through documented Responses, Chat Completions and Anthropic Messages text/function subsets. | The agent and its tools run on the client device. Relay returns tool proposals without executing them, stores usage metadata rather than external chat content, and does not certify complete Codex/Claude Code compatibility. |
| Responsive interface | Specialist selection, provider/account identity, remote setup, LAN invitations and token management join the existing chat, history, approvals, activity, diffs and resource views. | Viewport emulation and selected automated accessibility checks are not physical-device or manual screen-reader certification. |
| Optional public sharing | A fixed-destination Cloudflare Workers/VPC/Tunnel adapter candidate and deployment guide support a stable address without buying a domain. Its Wrangler dry run passed. | No public deployment, live login or reachable URL is verified. Free-plan/beta availability is a third-party condition, not a permanent guarantee. |

Current verification: **46/46 browser cases passed**, and the production build passed. The final native Windows check passed **702 tests across 61 files with one platform-specific skipped test**, including strict typing. Coverage includes LAN account isolation and streaming, tool-capable specialist routing, and cancellation of a real HTTP client stalled by backpressure. The complete dependency audit reported **zero known advisories** at this check; this is not a claim that the application has no security defects.

Actual `ollama/qwen3:4b-instruct` inference passed on 9 October through the external-client gateway: HTTP 200, returned output, 20 input/12 output tokens, and unchanged Relay conversation history. Evidence is `Relay/output/inference-acceptance.json` in this workspace. This proves the local inference request and storage boundary, not a complete external coding-agent workflow. Native macOS, physical Linux GPU testing, actual Docker/native PostgreSQL, native installers and live cloud/public/LAN deployments remain separate release gates.

Native Ubuntu WSL subsequently passed strict types, **703 tests across 61 files with one skip**, production build and compiled-host acceptance: pairing permissions, replay/CSRF rejection, telemetry, embedded PostgreSQL persistence across restart, SSE heartbeat, credential-free logs and graceful stops. A real Balanced + Auto greeting also passed on the running Windows host, returning one natural answer and preserving it across reload. A subsequent focused Windows remote API/Worker run passed **64 tests**.

Cloudflare's encrypted login is connected. A named tunnel, a VPC Service restricted to `127.0.0.1:4318`, and a stable Workers account subdomain are registered. The supplied Zero Trust issuer is in ignored deployment configuration. The Access application audience is still needed; connector startup, Worker publishing and real public login are not complete. The local audience remains empty so incomplete configuration cannot authorize traffic.

Maintained routing tools were evaluated in [model-routing research](research-model-routing-tools.md). The next recommended experiment is llmfit as an optional source of hardware/model recommendations, with Relay's permissions and resource admission remaining authoritative. No researched router has been installed or represented as a verified quality improvement.

Details: [validation](validation.md), [specialist research](research-specialists.md), [external clients](external-clients.md), [LAN setup](lan-access.md), [public Worker candidate](cloudflare-free.md) and [Google connector plan](google-agents.md).

## Open the application

**Web address: http://127.0.0.1:4317**

Relay is a **browser web application** backed by a local Node.js service, using persistent embedded PostgreSQL. The optional public browser gateway is deployed at **https://relay-host.yarden-relay.workers.dev** behind Cloudflare Access and Relay account authorization. Cloud model accounts remain optional.

The browser requires owner pairing. If the pairing screen appears, run these commands in PowerShell:

```powershell
cd C:\Users\yarde\Documents\codexp\Relay
npm.cmd run pair
```

Open the private file reported by that command and copy its `token` value into Relay. The code expires after five minutes and is single-use. Never share the file or paste the code into a public chat. This protection prevents an arbitrary local browser or process from obtaining owner privileges merely by knowing the URL.

To start or reopen Relay on Windows:

```powershell
cd C:\Users\yarde\Documents\codexp\Relay
.\setup.cmd
```

On Linux/macOS, use `sh setup.sh` from the project directory. The launcher checks prerequisites, builds when needed, starts or reuses the host and opens the browser with a private pairing-file handoff. `--no-browser` keeps that handoff manual. It does not silently install model runtimes or weights. For a launcher-managed restart, use `setup.cmd --stop` followed by `setup.cmd` (or the corresponding `sh setup.sh` commands); manually started services must be stopped through their own controls. Ollama must be running for installed local models to answer. No Docker or external PostgreSQL installation is required for chat, local inference or managed file operations. Actual Windows launcher evidence is recorded below; current Linux/macOS launcher acceptance remains outstanding.

Conversations, tasks, settings and managed files live in `Relay/.data/`. Preserve that directory. Stop the service before making a complete filesystem backup. Do not delete it to fix a login issue.

## Overall status

This is a working, integrated local AI execution application with real persistence, local inference, permission enforcement, tools and a responsive browser interface. **The entire master specification is not finished, and this is not a claim of production security certification.** At your request, work was brought to a runnable handover instead of waiting for every remaining capability and external integration.

The demonstrated browser-to-tools path is: conversation → persisted task → local model selection → streamed activity → concrete tool approval → managed file mutation → actual read-back and verification → saved answer and execution history. That full real-model path passed on 6 October. The 8 October file-task attempt wrote and verified the correct file, then paused on changing RAM pressure before its next model call. It was not represented as completed. The 9 October external inference acceptance is a separate successful path described above.

## What was built

| Area | Implemented behavior |
| --- | --- |
| Architecture | Strict TypeScript modular host, React browser client, Fastify API, replayable SSE, normalized PostgreSQL records, explicit host abstractions. Research and architectural decisions are documented. |
| Local-first storage | Embedded PostgreSQL through PGlite by default; native PostgreSQL connection support. Conversations, messages, tasks, steps, calls, approvals, events, findings and checkpoints are separate records. Files remain on disk. |
| Conversation experience | Persistent conversations, streamed responses, Markdown, text attachments, model/depth/access controls, task status, errors and recovery actions. |
| History and context | Cursor-based conversation/message pagination, private full-text search, exact-message navigation, bounded recent context and source-linked retrieval from the same conversation. Complete history is not blindly sent to models. |
| Execution control | Explicit task lifecycle, role/model separation, bounded DAG strategies, constrained specialist planning, synthesis/review and bounded repair. Time, call, iteration and cost limits persist across relevant restart/resume paths. |
| Intelligence pool | Actual Ollama discovery and streaming; LM Studio adapter; optional official OpenAI, Anthropic and Gemini API adapters. Routing considers connected availability, capability, privacy, budget and current hardware admission. |
| Resource awareness | Dynamic host information, CPU/RAM/GPU and unified-memory policy, conservative weights/KV/cache/buffer estimates, host headroom, serialized local generation and explainable refusal/queue decisions. |
| Calibration | Owner-triggered bounded local calibration, cancellation, real runtime token/timing counters and persisted measurement identity including runtime/model provenance. Missing counters remain unknown. |
| File work | Managed copies of selected workspaces, authorized reads/search/list/write/delete, expected-content hashes, checkpoint records, diffs and conflict-checked revert. Original repositories are not automatically overwritten. |
| Git inspection | Actual Git plumbing against a service-owned snapshot baseline. Source `.git`, hooks, filters, helpers and repository configuration are not executed. This reports managed-copy changes, not source branch status. |
| Web research | A bounded public HTTPS GET tool with separate exact-origin grants, public IP validation, pinned resolution, redirect checks, output limits and cancellation. |
| MCP | Owner catalog discovery/review, full pinned schemas, selected server grants and controlled modern HTTPS MCP tool calls. Exact-call approvals bind both arguments and owner configuration. Changing an endpoint/catalog invalidates old approval authority. |
| Tool authority | All model tool requests pass deterministic capability, permission and execution boundaries. Untrusted files, webpages and MCP descriptions cannot issue grants. |
| Command isolation | Fail-closed Docker broker with a trusted Node supervisor, bounded tmpfs workspace, no writable host workspace mount, privilege-drop checks, network denial, process/resource limits and validated file export. Actual Docker acceptance remains unverified. |
| Storage protection | Application-level aggregate artifact capacity checks, disk headroom, bounded snapshots/checkpoints and file counts. These are not a complete database/log retention system. |
| Security | Protected owner pairing, HttpOnly sessions, Host/Origin/CSRF checks, user ownership filters, separate cloud egress, OS secret-store abstraction, secret/path/link checks, approval auditing and revocation. |
| Stop and recovery | Emergency stop latches scheduling off, cancels model/tool requests and requests managed-container termination. Interrupted or uncertain effects are preserved for inspection rather than blindly replayed. |
| Optional remote mode | Separate signed-identity gateway boundary, independent users/sessions/workspace/provider/network grants, quotas, owner controls and revocation. Public tunnel/domain deployment is not enabled or verified. |
| Browser design | Conversation-first layout, IBM Plex typography served locally, light/dark themes, progressive disclosure, command palette, keyboard dialogs, execution timeline, approvals, changes, model manager and hardware views. |
| Responsive behavior | Desktop activity surfaces and phone/tablet sheets/navigation, reachable composer controls, large approval targets, overflow handling and reduced-motion support. |
| Distribution work | Earlier portable Windows/Linux/macOS archives and Windows standalone startup verification. Native MSIX/deb/pkg build recipes and CI workflows were added; native installers were not built or installed. |

Frontend research considered Apple guidance, Meta/React engineering practices, Microsoft Fluent and W3C accessibility patterns. The result uses a custom design system rather than copying a product's visual identity. Details and sources are in [frontend research](frontend-research.md) and [design system](design-system.md).

## Historical verification through 8 October

| Check | Result and limits |
| --- | --- |
| 8 October strict types and deterministic tests | **362 tests across 39 files passed.** Includes real temporary filesystem/database work and deterministic provider/protocol fixtures. This does not mean 362 live cloud/model tests. |
| Production build | Passed. Browser assets and compiled host were generated. Main browser JavaScript is approximately 139 kB gzip; operational panels load separately. |
| 8 October browser suite | **29 Chrome tests passed.** Covers conversations, streaming, approvals, real managed-file diffs, stop, history, calibration UI, MCP grants, revocation, keyboard behavior, selected accessibility checks and multiple viewport sizes. Its inference provider is explicitly a test fixture. |
| Actual running host browser | **1 production browser test passed.** Opened a real persisted completed task, installed local models and actual hardware views, checked desktop/phone rendering and selected accessibility rules. This used the real service, not the fixture service. |
| Visual inspection | Reviewed current production screenshots for the light conversation, dark model manager and 320-pixel phone navigation. Desktop dark and hardware screenshots were also captured. |
| Real local inference, 6 October | Approved write + actual separate read + expected-hash contract completed with `qwen3:4b-instruct`. Subsequent restart/persistence/SSE heartbeat verification passed. |
| Real local inference, 8 October | Initial attempt refused on current RAM pressure. Later attempt admitted, wrote exact `Hello from Relay\n`, verified its hash, then **paused** when RAM pressure rose before the next call. No safety reserves were reduced. Extended calibration/Git/HTTPS model acceptance did not run because the initial acceptance did not finish. |
| Native Linux baseline | Earlier Ubuntu WSL2 run passed **249 tests**, build and nine compiled-host checks. This predates the latest budget/history/MCP/sandbox additions and is not evidence for those additions on Linux. |
| Dependency audit | Last recorded audit reported zero known advisories at its check time. This does not replace an independent security review. |
| Native Docker/PostgreSQL/cloud/macOS/public remote | **Not verified live in this handover.** Relevant automated contracts and setup scripts exist, but unavailable infrastructure/access is not counted as success. |

Two browser failures were diagnosed and corrected as test assertion problems: a duplicated “Disabled” label and an optional permission field whose effective default is denial. Policy behavior was not weakened to make the tests pass. The final complete rerun passed.

Current screenshots are under `Relay/output/playwright/production-*.png`. The latest paused inference evidence is preserved at `Relay/output/local-acceptance-paused-20261008.json`. Detailed historical evidence is in [validation](validation.md).

## What still needs to be added or improved

The following is the remaining product/release backlog against the master directive. “Implemented” above does not remove the need to harden and validate a subsystem under realistic workloads.

### Priority 1 — confidence, security and reliable installation

1. **Run current code natively on Windows, Linux and macOS.** Complete Apple Silicon and Intel Mac testing, Linux desktop/browser/GPU coverage, and representative AMD/Intel/NVIDIA/CPU-only hardware. WSL and hypothetical hardware tests are useful but insufficient for first-class platform claims.
2. **Prove the real command boundary.** Execute hostile-container, disk/inode exhaustion, privilege-drop, network denial, timeout, detached-child and emergency-stop tests on each OS's supported Docker setup. Fail closed until the image/runtime meets the documented requirements.
3. **Validate native PostgreSQL.** Exercise separate connections, concurrency, transactions, recovery, migrations, backups and restore. Embedded PostgreSQL is working; multi-process native-server behavior needs its own evidence.
4. **Commission an independent security review.** Include localhost attacks, remote API abuse, capability escalation, MCP poisoning, malicious repositories, secret leakage, same-user races, checkpoint conflicts and denial of service. Add fuzzing where appropriate.
5. **Complete packaged installation.** Build and install actual Windows MSIX, Linux deb and macOS pkg artifacts; verify first-run onboarding, uninstallation, upgrades and data preservation. Add signing/notarization using real owner identities and secure update/rollback mechanisms.
6. **Finish operational protection.** Database/event/log quotas, retention and safe garbage collection, encrypted/portable backup and restore UX, storage-pressure alerts, clearer recovery inspection and tamper-evident audit options. Current artifact checks are only one layer.
7. **Reduce hardware-admission uncertainty.** Measure attributable peak RAM/VRAM/unified-memory use across context lengths, batching, quantization and offload. Improve shared-runtime allocation accounting without treating resident counters as measured peak memory. The observed mid-task pause is a concrete acceptance case to address.

### Priority 2 — complete the core execution product

8. **Own local model lifecycle safely.** A dedicated Relay-owned runtime or enforceable leases are needed before automatic loading/unloading, model swapping and reclaiming resources shared with other applications. Add richer runtime health and queue visibility.
9. **Broaden local runtime support.** Complete live LM Studio verification and evaluate direct llama.cpp/other suitable adapters. Probe actual accelerator support and capabilities, including Metal/unified memory, instead of assuming CUDA.
10. **Improve scheduling.** Fair multi-user queues, owner reservations, per-user aggregate/time-window quotas, pressure reaction during active generation, explainable context reduction/offload/alternate-model decisions and measured concurrency admission.
11. **Expand objective verification.** Typed test/build/lint/API/database contracts, user-visible acceptance criteria, stronger evidence requirements for complex objectives and model-quality evaluation suites. The system cannot currently infer and prove every natural-language claim.
12. **Advance collaboration selectively.** Richer adaptive graphs, independent proposals, meaningful cross-review/debate/synthesis, contradiction tracking, retry/reroute policies and measured comparisons against a single-model baseline. Avoid adding agents without demonstrated benefit.
13. **Finish workspace delivery.** Safe export or approved application of changes back to a source repository, dirty-state preservation, branch/worktree/commit operations, conflict resolution and stronger non-Git rollback. Managed-copy edits are not automatically delivered to the original project.
14. **Broaden useful tools.** Browser automation, controlled package installation, task process management, structured database operations and code execution environments. Each needs schemas, independent capabilities, bounded output, cancellation and actual verification.
15. **Expand MCP compatibility carefully.** Supported authenticated/OAuth flows, suitable local servers through real isolation, additional safe schema support, progress streaming and public-server interoperability tests. Current anonymous modern HTTPS integration is intentionally restricted.
16. **Improve knowledge/context.** Durable summaries, richer provenance-linked shared findings/artifacts, project indexing and selective pgvector retrieval when it provides measured value. Current full-text retrieval is same-conversation, not a complete agent memory system.
17. **Add broader artifacts and multimodal work.** Images/PDFs and other safe uploads, extraction pipelines, malware/content controls where warranted, rich previews, downloads and model capability-aware context. Current attachments focus on text.

### Priority 3 — optional cloud and remote product completion

18. **Verify all cloud adapters with real API accounts.** Authentication, model discovery, structured/tool streaming, errors, cancellation, rate limits, model retirement and accurate versioned usage/pricing. Consumer subscriptions are not API credentials.
19. **Improve cloud privacy controls.** Clear context previews, richer sensitivity classification/redaction and fine-grained egress policies. Automated detection cannot guarantee that every private fact is recognized.
20. **Deploy and test the optional public gateway.** Real owner domain/tunnel/identity policy, TLS, edge rate limiting/DoS controls, revocation, reconnect and Internet failure. Never expose the owner, database, model-runtime or tool ports directly.
21. **Complete identity/device UX.** Invitations with expiration, owner-approved devices, stronger session inventory and appropriate passkey/device authorization using established protocols. Current allow-list entries do not send invitation emails.
22. **Broaden owner operations.** Per-user aggregate usage/cost, richer queue/priority controls, security-event views, host/session filtering and reliable stop-one-user/stop-all-remote workflows under load.
23. **Test real remote phones/tablets.** Network interruption, slow links, background/foreground transitions, touch/virtual keyboard, session expiry and clearly identified host/workspace approvals. Responsive desktop emulation is not physical-device acceptance.

### Priority 4 — exceptional frontend and long-term quality

24. **Improve advanced work inspection.** Purpose-built mobile terminal/diff views, syntax highlighting, side-by-side diff where space permits, file navigation, explicit checkpoint relationships and richer task graph navigation.
25. **Scale the UI and events.** Thousands of messages/events/artifacts, incremental log loading, virtualization when justified, bounded browser memory, reconnect/replay stress and measurable input/streaming latency budgets.
26. **Complete accessibility validation.** Manual NVDA/VoiceOver tests, screen-reader announcements during streaming, zoom/high contrast, touch targets, focus across nested flows and real-device keyboard testing. Automated axe checks cover only part of WCAG.
27. **Polish onboarding and error recovery.** First-run runtime/model discovery, installation guidance, explainable resource blocks, guided resumptions, optional diagnostics export and clearer distinction between “installed,” “fits now” and “measured.”
28. **Expand model quality evaluation.** Repeatable coding/research/tool suites, regression scores, task-specific routing quality, calibration variability and honest confidence/provenance displays. Token speed alone does not establish intelligence quality.
29. **Complete native host integrations before broader autonomy.** The current local-owner mode implements bounded structured text-file operations. Broader computer control still needs intentionally designed Windows containment, Linux namespace/cgroup/handle-based controls and appropriate macOS helpers. Do not reinterpret the current file-only mode as arbitrary host execution.
30. **Maintain release discipline.** Execute the three-OS CI matrix, test migrations against realistic existing data, dependency/security updates, reproducible artifacts, SBOM/license checks, versioned APIs and current operating documentation.

## Important current boundaries

- The local owner's explicitly confirmed **Unrestricted · host files** mode supports protected, bounded text-file operations. Arbitrary host commands, interactive desktop control and remote owner authority remain unavailable.
- Terminal execution is unavailable without an explicitly configured trusted container image and verified engine. There is no host-shell fallback.
- Cloud, LAN and public access are optional. Current live cloud accounts, trusted LAN clients and public deployment remain unverified; automated policy/protocol tests do not replace those checks.
- Workspace imports preserve source repositories; expect work in a managed copy.
- A task can pause if actual resource availability changes. Do not treat a paused task as a verified result.
- Native installers and integrations are prepared code, not shipped or installed release packages. Windows launcher behavior has actual evidence; missing-Node bootstrap and current Linux/macOS launcher acceptance remain outstanding.
- The Codex message “This conversation is read-only or unavailable; no operation was sent” came from the coding app, not Relay. The task was confirmed active; no Relay permission change was required to continue.

## Recommended next milestone

Prioritize reliable real command execution, current three-platform validation, better measured memory accounting and safe delivery of managed changes back to a source repository. Then complete signed installation and optional cloud/remote acceptance. Expand autonomous capability only alongside measurable verification and independent security evidence.

Project entry points: [README](../README.md), [architecture](architecture.md), [security model](security-model.md), [remaining implementation plan](completion-plan.md), [operating instructions](operations.md), and [validation ledger](validation.md).

## 9 October 2026: answer behavior and handover

Balanced-mode review no longer replaces a valid answer merely because a reviewer omitted its required verdict. Such failures retry the review alone within the durable call/iteration budget. A genuine revision request still repairs the answer against the original objective. During execution, the conversation presents fixed factual activity labels; those labels disappear when the task finishes. Supervisor completion commentary is not appended to the answer.

At this earlier snapshot, unrestricted mode was unavailable. The subsequent direct-host-file milestone below supersedes that restriction for explicitly confirmed local-owner file tasks. Arbitrary host commands remain unavailable; isolated terminal execution separately requires a verified container boundary.

The latest actual Ollama greeting check paused before model dispatch because available RAM did not satisfy Safe-profile headroom. This is a resource-admission result, not a successful live greeting acceptance. Deterministic backend and browser regressions separately exercise the corrected answer/review behavior.

Final handover checks on 9 October: strict types and 369 deterministic tests passed across 40 files; production build passed. The 30-case browser run passed 29 cases and hit one connection-indicator timeout; that exact keyboard/accessibility case passed on its focused rerun. The running production host passed desktop/phone inspection of persisted execution, discovered models and hardware. No fresh successful local greeting is claimed.

The Windows launcher passed actual cold build/start, repeat-start reuse, private graceful shutdown, restart and automatic browser/private pairing-file opening. The detached host remains available at http://127.0.0.1:4317. Missing-Node bootstrap, a genuinely fresh dependency installation, Linux/macOS launcher execution and native installers remain unverified. README.md and docs/user-guide.md describe architecture and the complete implemented user experience; docs/setup.md describes one-command setup. Optional model runtimes and model weights are not silently installed.

## 9 October follow-up: conversation management and direct host files

Added confirmed conversation deletion to responsive history. Deleted conversations are excluded from ordinary history, search, retrieval and user-scoped task reads; stored records remain for audit/usage. Unfinished tasks must be stopped first, and workspace files remain untouched. Fixed duplicate first chats by atomically admitting the conversation and objective with an idempotent request; the complete retry payload survives reload. Delayed submissions preserve newer drafts and navigation.

The local owner can now confirm **Unrestricted · host files**. Four real native operations list/read/write/delete bounded text files at absolute paths. Installation/data/system/vault paths, links, hard links, PowerShell profiles and recognized credential-bearing file mutations are denied. Existing-file writes preserve file identity and permissions; interrupted effects retain private recovery records and block automatic replay. Host tasks are serialized, and their final file hashes are rechecked before completion. This supersedes earlier statements that every unrestricted option was disabled: **arbitrary host commands remain unavailable**, and terminal execution still requires the container boundary. See docs/host-access.md for exact limits, including no automatic host-checkpoint restore UI or hostile same-user isolation claim.

Verification: strict types and **403 tests across 44 files passed**, including 25 native host-file boundary cases and real broker write/read plus external-change detection. Production build passed. The 37-case browser run passed 36 and exposed a test assertion mismatch for a disabled option; the corrected host-access file passed both cases on rerun. All new conversation cases passed, including failed admission, lost responses with nondefault options, navigation/draft preservation, confirmed deletion and unfinished-work refusal. Phone screenshots and automated accessibility checks were inspected. The restarted production host passed browser checks of saved work, models, hardware, new host-access confirmation and deletion controls. No new live-LLM inference success or Linux/macOS host-file validation is claimed.
