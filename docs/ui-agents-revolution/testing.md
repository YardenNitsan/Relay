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

See [capability audit and exact red/green evidence](agent-capabilities.md#g1-implementation-plan--authorized-follow-up). Eight regressions reproduced incompatible Browser admission/spending, with three compatible controls passing. Minimal admission/runtime checks now pass64focused tests across4files in62.37s. Existing profiles/tools/required hashes/model selection remain unchanged. The subsequent full host check below includes these changes.

## Shared task feed and reviewer handoffs

The versioned, account-scoped task feed initially failed seven authenticated cases with404. After implementation,64focused history/feed/Worker tests passed in19.29s. Coverage includes pagination, cursor account binding, task/conversation ownership, deleted conversations, bounded objectives and authenticated gateway dispatch. It does not imply live Cloudflare acceptance.

Reviewer acceptance suggestions initially failed three cases, with one control passing. Persisted planner suggestions now enter the reviewer context explicitly as untrusted evidence, without changing permission, required-read or routing decisions. Initial/repaired/resumed/oversized/unplanned coverage and related checks passed44tests across4files in31.45s.

The integrated `npm.cmd run check` completed strict typechecking and **1451passed/1skipped across135files in328.44s**, exit0. The first invocation appended `-- --maxWorkers=1`; npm warned that this did not forward a Vitest worker option through the compound script. The actual suite used its existing two-worker configuration. Use `npm.cmd test -- --maxWorkers=1` when serialization is needed. No full-suite claim includes a later backend change.

## Dispatch and Agent Studio

Three working local prototypes were reviewed across12concept/viewport/theme combinations. All had zero document overflow and zero violations in the configured axe checks. These are synthetic concept screens, not product acceptance. Representative screenshots and the written choice are in [evidence](evidence/README.md) and [design decision](design-decision.md).

The old application failed the new Work entry assertion before implementation. The first implemented Dispatch run passed14/14 in1.8min, including12width/theme combinations (320,390,768,1024,1440,2560), real disposable-host task detail/opening, failed refresh and draft preservation. Two review regressions for delayed admission and URL/Back state were observed failing before their fixes and subsequently passed.

An intermediate30-case integration run passed29 and exposed a hidden connection indicator in short landscape. Keeping the real indicator visible corrected that defect. A fresh48-case Dispatch/Agent Studio/agent/workbench run then passed47 and exposed a different short-landscape issue: the fixed execution header left only48px for its scroll body. The inspector now scrolls its header and evidence together at short heights. Neither request limits nor test timeouts were increased.

After the final build, **all12 Agent Work and workbench cases passed in1.6min**, including the failing landscape approval/deny flow, preview keyboard focus, duplicate/failed task opening and opening a task actually created on the disposable backend. The48-case run and12-case rerun overlap; they are not a single60-case run. Review corrections, scope and remaining acceptance are recorded in [independent review](independent-review.md). These tests use real fixture APIs with deterministic provider behavior; they do not establish successful autonomous coding by a live model.

Build completed with main JavaScript523.55kB (158.92kB gzip) and CSS101.38kB (18.33kB gzip). The existing >500kB main-chunk warning remains visible. No dependency was added for the frontend rebuild.

Seven existing navigation/permission/usage/conversation test files ran34cases:32passed and two retained phone focus-return assertions failed. Both exposed a real shared defect: the new header places Command earlier in DOM order than More, so chained-dialog fallback chose Command on phones. Modal now explicitly prefers visible More at≤700px and Command on desktop; original trigger and explicit fallback still take precedence. Stop all's touch target was also raised from40px to44px. After a fresh typecheck/build, **all11 refinement/usage cases passed in1.2min**, including both unchanged failed assertions and desktop chained-dialog focus. Logs: `navigation-migration.log`, `final-focus-build.log`, `final-focus-green.log`. Independent source review accepted the correction and checked that migrated tests retain substantive permission, draft, persistence, latency and accessibility assertions.

## Browser performance

`RELAY_PERFORMANCE_LABEL=dispatch-preview npm run benchmark:ui` passed both profiles in1.1min. Each measured three cold and three warm authenticated synthetic long-conversation loads (40messages/20assistant responses). Desktop ready medians were135ms cold/124.7ms warm. The390×844 phone-layout profile used4× CPU slowdown,80ms latency and1.25MB/s throughput; its medians were1693.3ms cold/1148ms warm. This is a browser laboratory result, not physical Android, live inference or field INP.

The measured frontend was the working tree above base commit59fe79f; generated index SHA256 was `273ef28aa7f77227fb8850f15533456895e95ab2aeb194e2db1cff6d67b60bdf`. The curated [measurement record](evidence/performance.json) retains provenance, per-run measurements and browser version. Raw artifacts remain under ignored `output/performance/dispatch-preview/`.

## Native preview

See [Android validation](android-validation.md) for the actual51-task Gradle build,12JVM tests, lint0errors/6warnings, APK signature, emulator installation and launch. Root independently checked the16713796-byte artifact and SHA256. Authenticated LAN, remote authentication, physical Samsung behavior and Android instrumentation acceptance remain unverified. The debug APK is a testing preview, not a production release.
