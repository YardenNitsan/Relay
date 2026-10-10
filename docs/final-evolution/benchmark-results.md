# Benchmark results

No new model-quality or application-speed improvement is established.

Baseline source: `9d563bc973dbcc177921ab918db88561c8280e48`. Fresh `npm ci`: 291 installed packages, no reported vulnerabilities, Node 24.11.1/npm 11.6.2, Windows. Dependency installation is not application startup latency.

Measure before modifying: compiled-host cold startup, frontend initial render and input latency, navigation, long history, discovery, model load/first observed content/cleanup, tool overhead, queue waits, memory, bundle bytes and retrieval. Keep inference intervals separate from app overhead. Record hardware, model artifact/settings, dataset version, repeated samples and uncertainty. No lowered memory reserves.

Routing experiment must freeze v0.1.2 decisions and version development/held-out labels before candidate tuning. Label agreement measures classification/routing selection, not model task success. Real executable task outcomes are a separate gate. Single-agent/multi-agent comparisons need the same tasks, models, authority, hardware and budget reporting.

## Deadline reconciliation, 2026-10-10

Repeat with `node --import tsx scripts/benchmark-deadlines.ts`. Windows, Node 24.11.1, Intel Core Ultra 7 265KF, disposable PGlite with the actual current migrations. Synthetic data: 50,000 completed tasks and 100 overdue pending tasks. Thirty measured samples after five warmups, same process and query; indexed condition runs first. Median/p95 indexed: **0.498/0.695 ms**; same database after dropping only its disposable partial index: **4.575/5.740 ms**. The query plan uses `tasks_pending_deadlines`. [Raw sample summary and query plan](evidence/deadline-reconciliation-windows.json).

This narrowly supports indexing bounded expiry discovery as retained history grows. It is not native PostgreSQL evidence, production-scale load testing, a before/after v0.1.2 application benchmark, or an inference improvement. Real installations can have more unfinished tasks, different storage and clock behavior; ordering and single-host measurement limit generalization.

## Studio bundle observation

Same local Node/dependency lock and Vite production command: the fresh v0.1.2 baseline entry chunk was 486.47 kB / 148.69 kB gzip; the initial integrated Studio/Workbench build is 492.63 kB / 150.58 kB gzip (Vite's decimal kB report). Entry gzip increased 1.89 kB, approximately 1.3%. This is a chunk-size comparison, not total route transfer, rendering speed, or inference latency. Offline font assets and lazy feature chunks remain separate. Logs: `baseline-build.log`, `workbench-build.log` under ignored local output. No new dependency was added. Full frontend runtime budgets and repeatable latency/memory measurements remain G03 work.

## Controlled source-scale coding baseline

[Actual Windows evidence](evidence/coding-acceptance-windows.json) contains a fixed public Relay commit with 534 tracked paths, 21 recorded policy/binary omissions and one added visible harness: 514 text files, 3,980,270 bytes. Two deliberately seeded defects affect deadline units and cross-task activity attribution. This is a targeted repair in substantial source, not a full application build or broad coding benchmark.

Pinned Node24.21.0 Docker executes the pristine visible cases (2 pass), seeded cases (2 fail), expanded pristine grader (9 pass) and a stale-result counterexample (1 fail). The final grader reruns both visible and hidden cases against final contents; previous passing receipts cannot substitute. Five deterministic scope tests reject test edits, unrelated changes, path substitution and incomplete repair.

| Actual local attempt | Result | Observed task duration |
| --- | --- | --- |
| Larger installed Qwen3.5 9B, 16K | RAM admission refused under unchanged Safe policy | No task admitted |
| Smaller installed 9B GGUF, 16K | Load paused; LM Studio log reports missing internal temp directory | 6.050s |
| Same smaller model after directory repair, 16K | Three source reads and actual failing tests; conservative context bound pauses before edits | 66.781s |
| Same model, explicit 32K | Two approved source writes, rerun still fails, subsequent repair hits 4096-token output cap | 450.425s |

All attempts used explicit required local models, normal admission/watchdog and no cloud credentials/fallback. Missing LM Studio temporary directory was recreated without changing settings or restarting the owner service; loaded-instance discovery was empty before retry. The 32K attempt corrected deadline units but used the wrong field for activity ownership. No final partial tool proposal or source publication occurred. Durations are driver-observed task intervals, not inference-only or internal first-token latency. C05 remains open. Context sizing and model recovery need improvement; these observations do not justify weakening reserves, discarding receipts or claiming routing superiority.

A fifth coding candidate, installed Gemma4 12B QAT at32K context, was refused before inference by unchanged safe RAM admission (estimated14,680,508,671bytes RAM). Evidence coding-IZXsS1 is retained. This is resource admission evidence, not model task-quality evidence.

Native language checks: fixed Node execution197ms, Python303ms and offline C# build/run2026ms in separate512MiB/one-CPU containers. These are small correctness-fixture receipt durations on Windows Docker Desktop; no before/after inference speed or medium-project performance claim is made.

## D01 frozen bilingual intent comparison

[Protocol and candidate results](../../benchmarks/task-intent/results-v1.md), [initial report](evidence/intent-heldout-initial.json) and [quiet-host reproduction](evidence/intent-heldout-quiet.json) retain the baseline and rejected alternative. The independently authored synthetic held-out set has56cases,28perlanguage. Phrase rules satisfy26cases against the shipped baseline14; required-label recall57.89%vs28.95%; explicit forbidden-label violations5vs11. Lexical prototypes satisfy7and are rejected. Partial labels do not support precision/F1 claims. Thirty phrase cases still fail and were not used to retune the frozen candidate.

Quiet Windows/Core Ultra7 265KF/Node24.11.1 short-objective median/p95: phrases0.074/0.183ms, baseline p95 0.0036ms. Single16KiB Hebrew stress input:11.06ms for phrases. This is additional bounded CPU work without inference/egress, not faster routing or inference. The declared quality/short-input latency gate passes. The initial freeze omitted evaluator identity; that defect is disclosed and v2 binds evaluator and thresholds for reproduction, not a newly unseen evaluation. No semantic encoder/local classifier model or actual model task-selection quality improvement is established.
