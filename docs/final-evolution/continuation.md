# Continuation

**INCOMPLETE - CONTINUATION REQUIRED** before the owner's full definition of done. Continue A-G; foundation commits are intermediate.

Read AGENTS.md, progress.json, master-plan, requirements, architecture decisions and acceptance results. Inspect status/log first. Active worktree: C:/Users/yarde/Documents/codexp/Relay-modernization; branch modernization/final-evolution. Preserve original Relay, other products and the production host. Hidden worktrees deliberately fail direct-host policy.

Pushed: 57ba8d9 CI/research, 26e2a6a TLS diagnostics, 6d9b8e0 native ACL/unknown telemetry fixes. Deadline milestone is verified and ready to commit. Baseline: 1194 passed/one skip, build, full 110 browser cases. Hosted 38059861461/38060383041 pass Linux/macOS host gates; Windows TLS timeout and macOS unknown-meter ARIA failures now have fixes awaiting hosted results. Draft PR connector returned 403; pushes work. No merge, production restart, settings or license change.

A04 is locally verified: durable 24h overall deadline (30s-7d), legacy compatibility, queue/active/approval/resource/offline enforcement, evaluation/broker/finalization guards, migration 10 partial index and UI timing. Review findings fixed: clock disagreement, slow cleanup blocking, history scanning, evaluation guard. Shutdown joins scheduler reads; blocked-read fixture now releases while shutdown waits and still asserts zero dispatch.

Latest passing gates: deadline-verified-check.log (strict types, 1214 passed/one skip, 112 files, 245.99s), deadline-build.log, deadline-browser.log (12 evolution/retention), deadline-approval-browser.log (2 phone approvals). Selected actual screenshots inspected and retained in evidence/. Benchmark 50,000 retained/100 pending: median 0.498ms indexed vs 4.575ms unindexed; disposable embedded evidence only.

Next:
1. Commit/push any remaining verified deadline changes. Update ledger with exact commit. Inspect latest hosted CI; A02 remains open until all applicable gates pass.
2. Continue A native PostgreSQL/backup/retention and B Studio implementation. B01 research/concept selection complete; new tokens/shell/conversation/workbench and other screens are NOT implemented. Use existing research and plan, preserve APIs/account gates and .conversation-scroll ownership.
3. Continue C-G; no coding/Companion/model-quality/live integration acceptance follows from fixture tests.

Commands: npm.cmd ci; npm.cmd run check; npm.cmd run build; npm.cmd run test:e2e. Build before browsers; heavy checks/inference sequential. Deadline measurement: node --import tsx scripts/benchmark-deadlines.ts. Current tests have finished. Do not restart production or LM Studio for acceptance. Docker engine, second device and OAuth prerequisites remain; finish independent implementation first.