# Acceptance results

## Fresh baseline, 2026-10-10

- Origin/main and local clean checkout: `9d563bc973dbcc177921ab918db88561c8280e48`.
- Locked install succeeded; Node 24.11.1, npm 11.6.2; dependency audit reported zero vulnerabilities.
- [Actual GitHub run 38057272645](https://github.com/YardenNitsan/Relay/actions/runs/38057272645): Windows 23 failed files / 184 failed, 956 passed, 55 skipped tests; macOS 18 failed files / 163 failed, 1010 passed, 22 skipped tests. Many are cascading setup failures, not independent defects. Linux 1194 passed / one skipped, then cancelled during browser tests at the job time limit.
- Open GitHub issues query returned no entries. `main.protected` is false. No repository settings changed.
- Docker client installed; Linux-engine named pipe absent. Ubuntu WSL is installed. Real Docker acceptance unavailable at baseline.
- Fresh Windows baseline `npm.cmd run check`: strict types and 1194 passed / one skipped, 110 files, 237.57 seconds (`output/final-evolution/baseline-canonical-check.log`). Locked install and production build passed. The earlier hidden-root run had 24 refusals; moving to an ordinary sibling restored valid fixture paths without changing production policy.
- New harness regression: two tests passed. The alias fixture first reproduced the refusal, then canonical test setup passed while explicit alias inspection remained refused. A native Windows child created account-owned fixtures and returned failure code 37 unchanged. This standard-user run does not prove the elevated hosted-runner case.
- Read-only focused code review found no concrete defect in the CI/harness changes; hosted results remain required. Full browser baseline is running; do not infer its outcome from partial passes.

## Before-design inspection

Inspected fresh fixture captures of the welcome/composer at 1440x900 and 390x844 and the 390px approval view. Existing strengths: readable text, labeled permission scope, prominent decision block. Weaknesses to address: desktop navigation mixes administration with the primary work surface; mobile composer and welcome content compete for short-height space; execution evidence lives behind generic activity navigation; the approval exposes the raw tool identifier before a plain-language operation. Retain exact arguments as inspectable evidence while improving the primary hierarchy. These observations do not establish full baseline visual/a11y coverage.

## Required scenarios

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
