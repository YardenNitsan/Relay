# Verification ledger

Overall: **INCOMPLETE — CONTINUATION REQUIRED**. Tests below establish only their stated scope.

## Baseline and Linux tablet reproduction

Baseline source and fetched origin tip: `fda18f490d30befc66be88f25bad4e5f44c49b5d`. Hosted [run 38210574875](https://github.com/YardenNitsan/Relay/actions/runs/38210574875) has all three host checks passing; Ubuntu browser shard2 failed (189passed/1failed), Windows browser shard2 cancelled; four other browser shards passed. This is not a green baseline.

Windows locked install: `npm.cmd ci --ignore-scripts`, 313packages, zero reported npm audit vulnerabilities. Baseline strict types and browser/host bundles completed; Vite reports an existing >500kB main chunk warning. PowerShell treats native stderr warnings as error records; subsequent commands explicitly return `$LASTEXITCODE` rather than interpreting redirection noise as a build failure.

`npm.cmd run test:e2e -- tests/e2e/projects-studio.spec.ts -g '768x1024'`: **2passed,22.5s**, Windows Chrome. Native Ubuntu WSL initially lacked Node and Chromium libraries. Used official Node24.11.1 archive with HTTPS SHA256 manifest verification, locked native npm dependencies, Playwright's pinned Chromium and its documented OS dependencies. No host listener/configuration was changed. Baseline native focused tablet: **2passed,15.7s**. This did not reproduce the full-suite failure.

Retrieved hosted failure log, screenshot and trace into ignored `output/ui-agents-revolution/hosted-linux/`. Trace shows `GET /api/workspaces/:id/files` returned429 twice; events and integration catalog reads also returned429. The screenshot explicitly shows “Too many requests. Wait one minute before retrying.” The search input was absent because its data request failed. This is not evidence of a 768px layout defect.

Full unchanged native project file: **18passed/1failed,2.5min**. The2560px dark case instead exhausted the rate window at the file-content request; its screenshot has the same rate-limit message. Retained at `/tmp/relay-ui-revolution/baseline-failure` and native logs. Failure moving with request timing confirms a suite load problem rather than viewport-specific CSS.

A bounded reproduction in the isolated Linux source snapshot preloads270ordinary unauthenticated `/api/session` GETs (all401, still counted by the existing limiter) before the unchanged768×1024dark case. It reproduces the exact30s `Search files` lookup failure, with429shown in the actual UI. No production timeout or limit override. Log: `tablet-prefilled-red.log`.

Fix: native test-only broker seed for the17synthetic files, after real authenticated workspace creation and before navigation; all actual UI operations keep the real host API. This removes17setup requests per viewport case without weakening any functional assertion. Added an explicit17-file count assertion. Initial helper invocation omitted the required stop callback and failed immediately; corrected before acceptance. Strict types pass. The same270-request prefill now **passes1/1,8.3s**; log `tablet-prefilled-green.log`. The full native project matrix now **passes19/19,2.5min**, including both tablet themes, all nine sizes, axe checks and loading/error/empty recovery; log `projects-green-native.log`.

Raw traces may contain disposable fixture session material: keep them ignored. Only sanitized summaries/screenshots belong in versioned evidence. No new physical-phone, live-model or remote-network acceptance is implied.

## Agent verification preflight

See [capability audit and exact red/green evidence](agent-capabilities.md#g1-implementation-plan--authorized-follow-up). Eight regressions reproduced incompatible Browser admission/spending, with three compatible controls passing. Minimal admission/runtime checks now pass64focused tests across4files in62.37s. Existing profiles/tools/required hashes/model selection remain unchanged. Broad integration is pending.
