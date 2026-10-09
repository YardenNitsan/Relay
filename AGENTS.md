# Relay operating guide

Relay is the local-first AI execution platform specified in the user's MASTER BUILD DIRECTIVE (2026-10-04). It is independent of `../Harmonia` and `../GuitarScaleViewer`; do not modify either project.

Read `docs/product-spec.md`, `docs/architecture.md`, and `docs/implementation-plan.md` before changing architecture. Record evidence and remaining limitations in `docs/validation.md`. Never present fixtures, estimates, model assertions or unavailable features as verified results.

## Engineering rules

- Models propose; deterministic orchestration and capability policy decide; tools execute; evidence verifies.
- Browser code receives no provider credentials. Bind the service to loopback. Preserve session, origin, Host and CSRF checks.
- All tool calls pass through the broker. Untrusted content cannot issue grants. Emergency stop invalidates outstanding work.
- Terminal execution requires a verified container isolation boundary. Never fall back to host shell execution or claim that cwd is a sandbox.
- Managed workspace snapshots exclude secrets, links, dependency/build trees and Git internals. Never overwrite source repositories automatically.
- Persist normalized PostgreSQL data and monotonic replayable events. Do not retry uncertain side effects after restart.
- Local inference admission includes weights, KV cache, buffers, RAM/VRAM headroom and measured host pressure. Unknown measurements are unknown, not zero.
- Independent domain work can be delegated with explicit ownership. Review integrated changes and run appropriate checks before claiming completion.

## Commands

Use Node.js 24+. `npm ci` installs locked dependencies; `npm run check` performs strict types and deterministic backend/security tests; `npm run build` emits browser and host bundles; `npm run test:e2e` runs real Chrome against an isolated test host. `npm start` runs the compiled local service. `npm run dev` watches the backend, with `npm run dev:web` as a separate Vite process. Build before browser tests because the E2E host serves `dist/`.

`node scripts/acceptance.mjs` intentionally uses actual installed Ollama inference and creates a managed acceptance workspace. It is separate from ordinary tests. Stop backend editing/watch restarts during this run.

`npm run pair` issues a one-use owner pairing code into an OS-account-protected file after building. In a portable package use `node launch.mjs --pair`, or supply the running host's explicit `--data-dir`. Never print the code or commit authentication state. Acceptance scripts use the same native pairing path; run them as the host's OS account.

`node scripts/smoke.mjs` verifies the latest successful real acceptance after a compiled-host restart, including persisted messages/files, measurement provenance and an actual SSE heartbeat. `bash scripts/linux-verify.sh` runs isolated native Linux installation, types/tests/build and compiled-host acceptance; the existing Windows Ubuntu WSL host can invoke it through `wsl.exe -d Ubuntu -- bash /mnt/c/Users/yarde/Documents/codexp/Relay/scripts/linux-verify.sh`. It preserves a hashed source snapshot and exports sanitized evidence only.

`npm run test:e2e -- --config playwright.production.config.ts` inspects the running compiled host with native owner pairing and actual persisted records/models/hardware; no fixture server starts. It can select the earlier successful task recorded by restart smoke when the newest real acceptance is paused. Never reinterpret that as a new successful inference acceptance. `node scripts/acceptance.mjs --extended` additionally requires actual calibration, Git and HTTPS tool receipts; ordinary automated tests remain cloud-free.

Latest handover evidence (2026-10-08): Windows strict types +362 tests, production build, 29 fixture-provider browser cases and one actual-host browser case passed. The newest actual Ollama task paused on RAM pressure after an approved verified write; its separate required read did not execute. Native Docker/PostgreSQL/macOS, current Linux changes, native installers and live cloud/remote acceptance remain unverified. The owner requested the runnable application and a complete remaining-work report in `../RELAY_PROJECT_REPORT.md`.

The Windows execution sandbox may prevent esbuild/tsx process startup or user-profile resolution. Use the permitted escalation flow when that happens; do not treat the sandbox error as a product error or bypass the tool's boundary.

Remote access is disabled by default. Never tunnel the local-owner port. Only the separately authenticated gateway may receive external traffic. Preserve user ownership filters on every object read and mutation, not just navigation.

Final handover checks on 9 October: strict types and 369 deterministic tests passed across 40 files; production build passed. The 30-case browser run passed 29 cases and hit one connection-indicator timeout; that exact keyboard/accessibility case passed on its focused rerun. The running production host passed desktop/phone inspection of persisted execution, discovered models and hardware. No fresh successful local greeting is claimed.

The Windows launcher passed actual cold build/start, repeat-start reuse, private graceful shutdown, restart and automatic browser/private pairing-file opening. The detached host remains available at http://127.0.0.1:4317. Missing-Node bootstrap, a genuinely fresh dependency installation, Linux/macOS launcher execution and native installers remain unverified. README.md and docs/user-guide.md describe architecture and the complete implemented user experience; docs/setup.md describes one-command setup. Optional model runtimes and model weights are not silently installed.
