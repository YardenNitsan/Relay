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
