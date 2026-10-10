# Acceptance results

## Fresh baseline, 2026-10-10

- Origin/main and local clean checkout: `9d563bc973dbcc177921ab918db88561c8280e48`.
- Locked install succeeded; Node 24.11.1, npm 11.6.2; dependency audit reported zero vulnerabilities.
- [Actual GitHub run 38057272645](https://github.com/YardenNitsan/Relay/actions/runs/38057272645): Windows 23 failed files / 184 failed, 956 passed, 55 skipped tests; macOS 18 failed files / 163 failed, 1010 passed, 22 skipped tests. Many are cascading setup failures, not independent defects. Linux 1194 passed / one skipped, then cancelled during browser tests at the job time limit.
- Open GitHub issues query returned no entries. `main.protected` is false. No repository settings changed.
- Docker client installed; Linux-engine named pipe absent. Ubuntu WSL is installed. Real Docker acceptance unavailable at baseline.
- Fresh Windows baseline `npm.cmd run check`: strict types and 1194 passed / one skipped, 110 files, 237.57 seconds (`output/final-evolution/baseline-canonical-check.log`). Locked install and production build passed. The earlier hidden-root run had 24 refusals; moving to an ordinary sibling restored valid fixture paths without changing production policy.
- New harness regression: two tests passed. The alias fixture first reproduced the refusal, then canonical test setup passed while explicit alias inspection remained refused. A native Windows child created account-owned fixtures and returned failure code 37 unchanged. This standard-user run does not prove the elevated hosted-runner case.
- Read-only focused code review found no concrete defect in the CI/harness changes. Fresh full browser baseline passed 110/110 in 14.1 minutes (`output/final-evolution/baseline-browser.log`); this is real browser fixture acceptance, not real-provider acceptance.

## Foundation follow-up

- Published branch commits `57ba8d9` (portable fixture/CI foundation and research ledger) and `26e2a6a` (retain native TLS inspection error cause). No production restart or merge occurred.
- [Hosted run 38059861461](https://github.com/YardenNitsan/Relay/actions/runs/38059861461): Linux/macOS host checks and Linux browser checks passed. Windows host failures narrowed to three TLS inspection cases. macOS browser failures exposed invalid range ARIA on unknown swap telemetry. The diagnostic follow-up [38060383041](https://github.com/YardenNitsan/Relay/actions/runs/38060383041) confirms a five-second native inspection timeout with SIGTERM and empty output; Linux/macOS host checks pass.
- Deterministic unknown-telemetry browser regression reproduced both axe violations before the fix (`meter-red.log`). Unknown bars now have decorative semantics while their visible unavailable label remains; measured bars retain meter semantics. Post-build acceptance pending.
- Draft PR creation was rejected by the GitHub connector with HTTP 403, `Resource not accessible by integration`. Branch pushes work. No PR or branch-protection change was made.

## Overall-deadline candidate

New tasks receive a durable 24-hour overall budget, configurable from 30 seconds to seven days. The budget includes queues, approvals and offline time; historical tasks without the field remain compatible. Guards cover approval/resume, model reservation, tool authorization including queued effects, evaluation sampling/report commit, and final answer commit. Expiry retains receipts and interrupted effects, denies pending approvals, and cancels active execution. Migration 10 adds a partial pending-task index.

Focused review regressions cover host/SQL clock disagreement, independent expiry during slow cleanup, evaluation authorization and scheduler reads during shutdown. `npm.cmd test -- tests/engine-scheduling.test.ts tests/task-deadline.test.ts --maxWorkers=1` passed 21/21 in 27.07 seconds. An earlier full run exposed a pricing fixture that jumped a month (now tests just across price expiry), missing evaluation guards, and an unowned scheduler read; all were addressed. The next full run revealed that the old shutdown test never released its simulated read until after shutdown returned; it now releases while shutdown joins and still asserts zero dispatch. This is documented test-contract repair, not removal of the invariant.

Final local gates: `npm.cmd run check` passed strict types and **1214 tests / one skip across 112 files**, 245.99 seconds (`deadline-verified-check.log`); production build passed (`deadline-build.log`). `npm.cmd run test:e2e -- tests/e2e/retention.spec.ts tests/e2e/evolution.spec.ts` passed **12/12** including the previously failing unknown-telemetry axe case. `npm.cmd run test:e2e -- tests/e2e/access.spec.ts -g 'phone'` passed **2/2**, asserting deadline text, absolute machine-readable time and real approve/write/diff behavior at 320/390px with additional viewport transitions through 1920px and short landscape. These are fixture-provider workflows, not live model acceptance.

Inspected the rendered desktop execution record, 390px approval and 390x420 approval action region. The deadline is readable in the scrollable approval context and decision controls remain reachable at short height. This verifies the addition within the existing UI, not the complete redesign. Retained [desktop baseline](evidence/before-desktop-1440.png), [phone baseline](evidence/before-phone-390.png), [execution record](evidence/deadline-execution.png) and [short approval](evidence/deadline-approval-short-390x420.png). Native PostgreSQL and current-commit three-OS checks remain distinct gates.

## Native reliability acceptance, 2026-10-10

Docker Desktop was installed but stopped. Starting it through its CLI made the local Linux engine available without a configuration change. The original Relay host and LM Studio were not restarted. All integration containers are script-owned, bound to loopback and removed in `finally`; preexisting unrelated containers were untouched. Docker Desktop remains running for subsequent sandbox work.

`node scripts/native-integrations-docker.mjs` now pins the official image digests and passes PostgreSQL 17.11 migration/locking/recovery and actual dump/restore plus Docker isolation/cancellation/emergency acceptance. [Native evidence](evidence/native-integrations-windows.json) includes image identities, nine database checks, row hashes for all 32 restored public tables, isolation checks and measured cancellation (431 ms on this run). The first real sandbox run failed because two removals raced; Docker reported removal already in progress. The owned-cleanup fix passed a failing-before regression and a failure/retry marker test. Focused read-only review found no concrete defect.

`node --import tsx scripts/backup-acceptance.ts` passed an offline encrypted round trip: 1,332 files / 47,632,853 plaintext bytes, 100 conversations, 2,000 tasks, 4,000 messages, 10 pending decisions, 50 memory notes, 10 schedules, two account permission records and 200 referenced artifacts. Every retained row/hash and artifact matches, except the documented safety transformation of pending approvals to denied; their arguments remain intact. Sessions are revoked and new execution is refused until restoration review. An initial assertion incorrectly expected pending approvals to remain pending; inspection confirmed existing intentional recovery policy, and the drill now explicitly asserts the safe transformation. [Restore evidence](evidence/encrypted-restore-windows.json). This is synthetic representative data, not a backup of the owner's live installation.

After the cleanup fix: strict types and **1216 tests / one skip, 113 files** passed in 246.81 seconds (`sandbox-final-check.log`); production build passed. Added acceptance scripts also pass the subsequent strict check (`native-final-typecheck.log`). GitHub host checks for `b5ebc30` pass on all three OSes; browser jobs are still separate pending gates. The native integration workflow now also runs for relevant modernization-branch pushes, since PR creation is unavailable through the connector.

[Hosted native Linux run 38062805371](https://github.com/YardenNitsan/Relay/actions/runs/38062805371) passed on `d53cc91`: PostgreSQL 17.11 upgrade/locking, all 32 restored public tables and real Docker isolation/cancellation/emergency checks. Reported cancellation was 315 ms on that runner; this is one acceptance observation, not a latency guarantee.

## Independent controls during telemetry failure

A Windows browser run had timed out waiting for resource-policy controls. Source inspection showed that the entire hardware screen withheld independent controls until telemetry arrived. A deterministic 503 browser regression reproduced that user-visible defect. The screen now mounts configuration, retention and diagnostics independently of telemetry, with stable component positions as measurements load or recover. No simulated measurement replaces missing data.

Strict types/production build passed (`hardware-policy-build.log`); both resource-policy browser scenarios passed (`hardware-policy-verified.log`, 17.0 seconds), including actual save/restore while telemetry returns 503, failed-save handling, persisted policy and axe. Inspected the rendered [telemetry error with usable controls](evidence/hardware-unavailable.png). This is a workflow fix in the existing UI; B02–B11 redesign remains open.

Windows browser job 114241379497 on `b5ebc30` finished with 109 passing/two failing cases: missing policy controls during telemetry loading, and the unknown-meter fixture waiting for live telemetry before supplying its unknown values. The first is fixed in `21eb31b`. The second now supplies a complete typed deterministic snapshot without live WMI/GPU discovery; it retains the same unavailable-label and axe assertions. Strict types and the exact browser case pass (`telemetry-fixture-typecheck.log`, `telemetry-fixture-browser.log`). This is deterministic UI-state coverage, not native telemetry acceptance. Latest hosted Windows/browser results still gate A02.

## Before-design inspection

Inspected fresh fixture captures of the welcome/composer at 1440x900 and 390x844 and the 390px approval view. Existing strengths: readable text, labeled permission scope, prominent decision block. Weaknesses to address: desktop navigation mixes administration with the primary work surface; mobile composer and welcome content compete for short-height space; execution evidence lives behind generic activity navigation; the approval exposes the raw tool identifier before a plain-language operation. Retain exact arguments as inspectable evidence while improving the primary hierarchy. These observations do not establish full baseline visual/a11y coverage.

## Studio and Workbench integration checkpoint

New semantic light/dark tokens, an adaptive Studio shell, pane-aware welcome and a modular dependency Workbench replace the previous shell and linear agent list. The Workbench separates model output, tool work, changed files and independent verification. Same-level dependencies do not imply parallel execution. Existing session, draft, approval and mutation contracts remain in use. API/MCP version reporting now derives from package.json, fixing stale 0.1.1 text without a version bump.

The initial Studio subset passed 28 cases; the six-width model-label regression plus shell checks passed 12. A full foundation run passed 115/117: one obsolete exact palette expectation, and a Chrome `ERR_NO_BUFFER_SPACE` while loading a JavaScript chunk. The later integrated 52-case subset passed 51; its final long-objective approval setup hit the real context safeguard. Selecting an explicit 16,384-token budget through Advanced controls made that exact case pass (6.3 seconds total). No production safeguard was weakened. All previously failing affected flows, the controlled pending-telemetry regression, keyboard resize focus, actual approval/diff actions and new light/dark axe checks pass in those scoped runs. Logs: `studio-full-browser.log`, `workbench-browser.log`, `workbench-landscape-verified.log`. Full checkpoint gates remain pending.

Hosted Windows save latency was reproduced locally before the fix: a successful policy POST persisted Balanced while the UI awaited deliberately held telemetry. Acknowledgement now follows the committed POST; query refresh continues independently with its own loading/error state. Focused read-only review found no actionable remaining defect. Hosted CI of this change is still required.

Opened and inspected retained [phone shell](evidence/studio-shell-390-light.png), [desktop shell](evidence/studio-shell-1440-dark.png), [phone Workbench light](evidence/workbench-390-light.png), [phone dark](evidence/workbench-390-dark.png), [desktop Workbench](evidence/workbench-1440-light.png), [branching presentation fixture](evidence/workbench-branching-1024.png) and [short landscape approval](evidence/workbench-landscape-approval.png). Focused reviews found and drove fixes for cramped 701px panes, hidden-control focus loss and objective context crowding the approval. The short-screen approval remains a candidate for a dedicated review surface. These results are fixture-provider/UI acceptance, not real model quality or full redesign completion.

Fresh checkpoint `npm.cmd run check` passes strict types and **1218 tests / one platform skip across 114 files**, 245.75 seconds (`studio-workbench-check.log`). The production build including package-derived version reporting passes (`studio-workbench-build.log`). Full browser acceptance is running against this frozen build (`studio-workbench-full-browser.log`); no complete-suite or hosted success is claimed yet.

Update: the frozen Studio checkpoint `c8616968b4f65a8c9ad64b67a1c2571b4cb42550` passed **all 125 browser cases in 16.1 minutes** (`studio-workbench-full-browser.log`). All three hosted host-check jobs in run38066150868 pass; its browser jobs remain pending at this update. Subsequent focused-approval changes are a separate increment and are not covered by this full-suite result.

## Required scenario definitions

All remain open until fresh evidence is linked. Historical/fixture results are not live acceptance.

| ID | Scenario | Pass definition |
|---|---|---|
| S01 | Local-only chat/fallback | Actual local result; permitted fallback only; no cloud egress |
| S02 | Real coding task | Isolated multi-file change, actual tests, diff and independently verified outcomes |
| S03 | Multi-agent analysis/implementation | Meaningful isolated collaboration, safe integration, cancellation and outcome evidence |
| S04 | Approval pause/deny/resume | No unauthorized dispatch; exact current approval; preserved budgets/receipts |
| S05 | Interruption/recovery | Durable evidence retained; uncertain effects never replay |
| S06 | Competing resource pressure | Fair bounded service; memory reserve enforced; truthful wait/failure |
| S07 | Disable account during tools | Fresh revocation prevents subsequent effects and data exposure |
| S08 | Browser folder writeback | Explicit local selection/review; conflict protection; verified file result |
| S09 | Companion delegated operation | Two authorized devices, local independent grants, real file/test receipt |
| S10 | Evaluation/routing | Versioned held-out comparison and actual task outcomes with hard gates |
| S11 | Scheduled recovery | No duplicate occurrence/effect; restart and revoked grants respected |
| S12 | DB upgrade/restore | Native locks, historical records/references preserved, restored execution gated |
| S13 | Mobile review/approval | Actual rendered exact-consequence review, reachable controls, keyboard/axe/visual checks |
| S14 | Remote auth/revocation | Genuine authorized gateway/session; no cross-account access; revoked streams/tools stop |

## Focused approval and draft increment - 10 October

The frozen c861696 Studio build completed all **125/125 browser cases in 16.1 minutes** (`studio-workbench-full-browser.log`). Subsequent approval/draft changes passed strict types and production build (`approval-build.log`), **nine focused unit tests** (`approval-unit-check.log`: seven approval provenance, two graph layout), and **41/41 affected browser cases in 5.2 minutes** (`approval-browser.log`). Command: `npm.cmd run test:e2e -- tests/e2e/approval-review.spec.ts tests/e2e/composer-draft.spec.ts tests/e2e/conversation-create.spec.ts tests/e2e/access.spec.ts tests/e2e/workbench.spec.ts tests/e2e/product.spec.ts tests/e2e/refinement.spec.ts`. The prior full 1218-test backend check belongs to c861696; no fresh full-test total is inferred.

New approval cases cover 320/1440 light/dark, actual denial and approved write/diff, Escape/focus restoration, axe, geometry, and 844x390 decision rejection feedback. The rejection response is controlled UI evidence, not live account revocation. Five real UI captures are retained as `evidence/approval-review-*.png`. Fallback identity regressions failed before the provenance fix; delayed-send draft retention failed before the conditional-clear fix and now survives send completion and reload. Existing authorization APIs and grants were preserved. This is a verified increment, not completion of B or the full directive.

## Presence-aware publication increment - 10 October

`npm.cmd run check` passes strict types and **1237 tests/one platform skip across114files in259.39s**, followed by the production build and **5/5 publication browser cases in38.1s**. Logs: `publication-full-check.log`, `publication-final-build.log`, `publication-final-browser.log`. The initial browser run passed4/5; the remaining fixture used visible theme text instead of its actual accessible name. The corrected rebuilt run passes all5.

Actual disposable source files, a real database and the normal authenticated/CSRF UI exercise modifications, creation, deletion, a rename pair, empty-versus-absent state, unrelated-edit preservation, conflict refusal, explicit rollback and legacy journal compatibility. Focused security regressions reproduce and fix revocation immediately before unlink/exclusive create and stale-preview ordering after rollback. Cancellation, missing creation identity, directory replacement and linked parents refuse unsafe recovery. The UI shows Add/Delete/Modify and exact absence, plus metadata consequences. Phone320 light anddesktop1440 dark captures were opened and retained as `evidence/publication-presence-*.png`; axe and overflow checks pass. This extends the existing Projects view; B06 redesign remains open.

Limits: existing destination directories only, text files,20files/2MiB per review; rename is creation/deletion and content rollback does not restore old filesystem metadata. No Git stage/push, no host shell, no publication agent tool. Same-user native filesystem races remain a documented limit. Real model multi-file coding acceptance and new-directory/Git integration remain open.

## A03 host mutation authorization (10 October)

FE-011 ordinary host dispatch omitted the durable callback used by publication. Six real-file/database regressions reproduced unauthorized create/delete/continued writes after revocation; all failed before the one-line dispatch fix. Fresh durable task/account/session/grant/deadline checks now run inside HostFileBroker mutation boundaries. Partial writes retain their prepared checkpoint. 49 focused tests pass; full strict types and 1243 tests/one skip across 115 files pass in 262.31s. Production build and both host-access browser cases pass (12.2s). Internal review found no actionable remaining defect in this scope. Broader security review remains open. Logs: output/final-evolution/host-mutation-auth-{red,green,check,build,browser}.log.

Hosted approval/draft run [38067674196](https://github.com/YardenNitsan/Relay/actions/runs/38067674196) passed. Publication run 38069003236 remains pending at this checkpoint; no hosted pass is assumed.

## Native cleanup follow-up (10 October)

Run [38069750202](https://github.com/YardenNitsan/Relay/actions/runs/38069750202) passed native PostgreSQL locking/upgrade and 32-table restore, then failed on daemon AutoRemove competing with Relay cleanup. Removing Docker `--rm` gives Relay sole removal ownership; durable recovery remains mandatory. The new regression fails before the change; 59 affected tests across four files pass after (1.41s). `node scripts/native-integrations-docker.mjs` passes locally after the fix, including actual cancellation (446ms), emergency stop and PostgreSQL upgrade/restore. This does not substitute for the pending hosted Linux rerun. Evidence: `evidence/native-integrations-windows-explicit-cleanup.json`; logs under `output/final-evolution/sandbox-autoremove-*`.
