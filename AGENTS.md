# Relay operating guide

Relay is the local-first AI execution platform specified in the user's MASTER BUILD DIRECTIVE (2026-10-04). It is independent of `../Harmonia` and `../GuitarScaleViewer`; do not modify either project.

Read `docs/product-spec.md`, `docs/architecture.md`, and `docs/implementation-plan.md` before changing architecture. Record evidence and remaining limitations in `docs/validation.md`. Never present fixtures, estimates, model assertions or unavailable features as verified results.

## Engineering rules

- Models propose; deterministic orchestration and capability policy decide; tools execute; evidence verifies.
- Browser code never receives saved provider credentials. Credential-entry values are sent only to the authenticated backend, never returned in status or model context. Keep the owner service on loopback; LAN/public listeners are separate and explicitly configured. Preserve session, origin, Host and CSRF checks.
- All tool calls pass through the broker. Untrusted content cannot issue grants. Emergency stop invalidates outstanding work.
- Terminal execution requires a verified container isolation boundary. Never fall back to host shell execution or claim that cwd is a sandbox.
- Managed workspace snapshots exclude secrets, links, dependency/build trees and Git internals. Never overwrite source repositories automatically.
- Persist normalized PostgreSQL data and monotonic replayable events. Do not retry uncertain side effects after restart.
- Local inference admission includes weights, KV cache, buffers, RAM/VRAM headroom and measured host pressure. Unknown measurements are unknown, not zero.
- Independent domain work can be delegated with explicit ownership. Review integrated changes and run appropriate checks before claiming completion.

## Current release handover

The authoritative current 0.1.1 summary is `docs/release-0.1.1.md`; earlier dated evidence below is historical. Public browser access is deployed behind Cloudflare Access. Google Gemini OAuth is implemented but needs real owner app configuration and live consent acceptance. Private user workspaces and supported browser device-folder synchronization are implemented. Models refresh installed local discovery when opened. Agent model routing uses the same admission/lease/pressure protection as ordinary tasks. Never turn small fixed probes into a claim of broad model quality or live monitoring into a zero-crash guarantee.

Current Windows verification: **846 deterministic tests passed across 74 files with one platform skip**, production build passed, and **67/67 Chrome browser cases passed**. The authoritative live-inference result is recorded in `docs/release-0.1.1.md`; a memory-paused task is not success. Acceptance scripts label and close their temporary sessions to avoid filling the real 20-session quota.

## Commands

Use Node.js 24+. `npm ci` installs locked dependencies; `npm run check` performs strict types and deterministic backend/security tests; `npm run build` emits browser and host bundles; `npm run test:e2e` runs real Chrome against an isolated test host. `npm start` runs the compiled local service. `npm run dev` watches the backend, with `npm run dev:web` as a separate Vite process. Build before browser tests because the E2E host serves `dist/`.

`node scripts/acceptance.mjs` intentionally uses actual installed Ollama inference and creates a managed acceptance workspace. It is separate from ordinary tests. Stop backend editing/watch restarts during this run.

`npm run pair` issues a one-use owner pairing code into an OS-account-protected file after building. In a portable package use `node launch.mjs --pair`, or supply the running host's explicit `--data-dir`. Never print the code or commit authentication state. Acceptance scripts use the same native pairing path; run them as the host's OS account.

`node scripts/smoke.mjs` verifies the latest successful real acceptance after a compiled-host restart, including persisted messages/files, measurement provenance and an actual SSE heartbeat. `bash scripts/linux-verify.sh` runs isolated native Linux installation, types/tests/build and compiled-host acceptance; the existing Windows Ubuntu WSL host can invoke it through `wsl.exe -d Ubuntu -- bash /mnt/c/Users/yarde/Documents/codexp/Relay/scripts/linux-verify.sh`. It preserves a hashed source snapshot and exports sanitized evidence only.

`npm run test:e2e -- --config playwright.production.config.ts` inspects the running compiled host with native owner pairing and actual persisted records/models/hardware; no fixture server starts. It can select the earlier successful task recorded by restart smoke when the newest real acceptance is paused. Never reinterpret that as a new successful inference acceptance. `node scripts/acceptance.mjs --extended` additionally requires actual calibration, Git and HTTPS tool receipts; ordinary automated tests remain cloud-free.

## Earlier verification snapshots

These dated paragraphs retain historical evidence. Use the current release report and the first section of docs/validation.md for current status.

Earlier 0.1.1 evidence (2026-10-09): production build and the complete **46-case browser suite passed**. The most recently completed Windows strict-type/full-test check passed **702 tests across 61 files with one platform-specific skipped test**, including the final Balanced-conversation regression. Subsequent Linux test-fixture isolation added a regression; the focused remote API/Worker check passed **64 tests**. Native Ubuntu WSL passed strict types, **703 tests across 61 files with one skip**, build and compiled-host pairing/persistence/restart/SSE acceptance. A real Balanced + Auto greeting passed on the production Windows host. `node scripts/inference-acceptance.mjs` passed with actual installed Qwen 4b inference and unchanged Relay conversation history. This is not full external CLI compatibility or a new file-task acceptance. Public Worker dry run passed; encrypted Cloudflare authorization, named tunnel, fixed VPC Service and stable account subdomain are prepared, but Access audience, connector startup, publishing and live login remain outstanding. LAN is not configured. Native Docker/PostgreSQL/macOS, physical Linux GPU testing, native installers and live cloud acceptance remain unverified. Complete current boundaries are in `docs/project-report.md` and `../RELAY_PROJECT_REPORT.md`.

The external inference acceptance driver uses a scoped, revocable token and checks metadata-only retention. Never print its token. External inference is local-model-only, shares host scheduling and returns tool proposals to the client without executing them. Do not reuse browser owner sessions as native client credentials or expose Ollama directly.

Ten specialist profiles narrow instructions and tool allowlists; they never grant authority. Only the Personal profile currently has a real persistent personal-task tool. Email and Calendar profiles do not have live connectors, and personal tasks do not schedule notifications. Provider credentials belong to the signed-in account; remote users never inherit owner credentials. Keep specialist, user, task, network and data-egress policy checks independent.

Respect the active execution environment permissions. Do not treat an environment process-launch restriction as a product defect or bypass its boundary.

Remote access is disabled by default. Never tunnel the local-owner port. Only the separately authenticated gateway may receive external traffic. Preserve user ownership filters on every object read and mutation, not just navigation.

Final handover checks on 9 October: strict types and 369 deterministic tests passed across 40 files; production build passed. The 30-case browser run passed 29 cases and hit one connection-indicator timeout; that exact keyboard/accessibility case passed on its focused rerun. The running production host passed desktop/phone inspection of persisted execution, discovered models and hardware. No fresh successful local greeting is claimed.

The Windows launcher passed actual cold build/start, repeat-start reuse, private graceful shutdown, restart and automatic browser/private pairing-file opening. The detached host remains available at http://127.0.0.1:4317. Missing-Node bootstrap, a genuinely fresh dependency installation, Linux/macOS launcher execution and native installers remain unverified. README.md and docs/user-guide.md describe architecture and the complete implemented user experience; docs/setup.md describes one-command setup. Optional model runtimes and model weights are not silently installed.

## 9 October follow-up: conversation management and direct host files

Added confirmed conversation deletion to responsive history. Deleted conversations are excluded from ordinary history, search, retrieval and user-scoped task reads; stored records remain for audit/usage. Unfinished tasks must be stopped first, and workspace files remain untouched. Fixed duplicate first chats by atomically admitting the conversation and objective with an idempotent request; the complete retry payload survives reload. Delayed submissions preserve newer drafts and navigation.

The local owner can now confirm **Unrestricted · host files**. Four real native operations list/read/write/delete bounded text files at absolute paths. Installation/data/system/vault paths, links, hard links, PowerShell profiles and recognized credential-bearing file mutations are denied. Existing-file writes preserve file identity and permissions; interrupted effects retain private recovery records and block automatic replay. Host tasks are serialized, and their final file hashes are rechecked before completion. This supersedes earlier statements that every unrestricted option was disabled: **arbitrary host commands remain unavailable**, and terminal execution still requires the container boundary. See docs/host-access.md for exact limits, including no automatic host-checkpoint restore UI or hostile same-user isolation claim.

Verification: strict types and **403 tests across 44 files passed**, including 25 native host-file boundary cases and real broker write/read plus external-change detection. Production build passed. The 37-case browser run passed 36 and exposed a test assertion mismatch for a disabled option; the corrected host-access file passed both cases on rerun. All new conversation cases passed, including failed admission, lost responses with nondefault options, navigation/draft preservation, confirmed deletion and unfinished-work refusal. Phone screenshots and automated accessibility checks were inspected. The restarted production host passed browser checks of saved work, models, hardware, new host-access confirmation and deletion controls. No new live-LLM inference success or Linux/macOS host-file validation is claimed.
