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

## First passing actual coding configuration

[coding-0O93wv evidence](evidence/coding-acceptance-success-windows.json) records the same fixed514-file corpus and required smaller installed9B model with explicit32768context/8192output. Eight calls complete in256978ms. Four file reads, two guarded writes, two actual terminal runs and one Git diff are recorded. The model corrects seconds-to-milliseconds conversion and filters activity by the selected task ID. Fresh independent grading passes9/9, published source passes9/9, and rollback restores the entire seeded snapshot exactly. Non-target files remain unchanged.

This is one actual targeted repair under unchanged Safe reserves/local-only/approval/grading limits. It is not a broad coding success rate, full application build, single-vs-multi comparison, or causal evidence that more output tokens improve quality or speed. The model's narrative contains an imprecise "off-by-60-second" description; the behavioral grader and actual diff establish the general units correction. Earlier failed attempts remain part of the evidence.

The [identical repeat](evidence/coding-acceptance-repeat-windows.json) does **not** reproduce successful completion. It uses 9 calls/293,050 ms, receives a denial for an unapproved node-e date calculation, and stops at waiting_for_user despite passing both visible tests. A separate [fresh native diagnostic](evidence/coding-repeat-independent-windows.json) finds 8/9 tests pass: the model filters TOOL_STARTED only, leaving unrelated AGENT_STARTED activity visible. The final tree preserves non-target files, but the repair is incomplete. No publication occurs; cleanup closes the private host and leaves zero stored sessions.

These two trials show one accepted repair and one failed repeat, not a reliable population success rate. Exact model weight digest, sampling seed and temperature are not retained in these summaries; the requested installed ID and task budgets are recorded. No further retries were used to manufacture a clean result. Broader frozen executable benchmarks and recovery behavior remain D02/C05 work.

## D07 pretrained multilingual comparisons

The [retained protocols and reports](../../benchmarks/semantic-routing/README.md) compare actual CPU inference through existing Semantic Router/Transformers libraries. Frozen v1 MiniLM satisfied26/64 constrained cases versus phrase baseline25/64; E5 satisfied17 and MiniLM NLI13. Frozen v2 calibrated MiniLM satisfied23/64 versus22/64 baseline, with English regression and more forbidden predictions. Both predeclared promotion gates failed. [Router research](router-replacement.md) records language outcomes, latency, RAM, initialization, model revisions and licensing. No primary replacement or downstream task-success improvement is claimed.

Development-only larger-model exploration did not justify GPU/router overhead. A proposed SetFit custom classification head was stopped when the owner clarified that the router must be an existing ready-made tool. No head was trained or integrated. Complete reannotations of consumed material are evaluation reference data only; independent AI reviewers are not human validation. Original partial labels and failed reports remain immutable; neither old test corpus is unseen anymore. The shortlist is expanding to additional published routing systems and pretrained decision models.

Two additional ready-made default configurations now have actual sequential two-thread CPU evidence on consumed v2: GLiClass multilingual mini15/64 (EN8,HE7), p95362.34ms/endRSS1.846GB; published Vela2 ONNX30/64 (EN13,HE17), p95289.65ms/endRSS1.411GB/peak2.318GB. Both used unchanged vendor weights and no examples or custom training. Both miss existing quality/latency gates. Independent review verified all128 recorded predictions, aggregates and source hashes. [Detailed reports and reproduction](../../benchmarks/semantic-routing/README.md) retain failed cases and licensing/input limits. These are not unseen or downstream task-success results.
## Supporting Studio build observation, 11 October

The fresh supporting-view build emits a505.57kB minified entry JavaScript chunk (153.89kB gzip) and96.64kB entry CSS (17.34kB gzip). Lazy feature JavaScript: Usage5.60kB, Clients10.09kB, Memory13.13kB, Google Workspace17.43kB, Scheduling19.65kB and Access36.38kB. These are Vite artifact sizes from `output/final-evolution/supporting-studio-build.log`, not network transfer measurements or input/startup latency. Vite still emits its500kB chunk warning; no arbitrary warning-limit increase was used. No new frontend dependency was added for these views. Real startup, long-conversation rendering, input latency and physical-phone performance remain acceptance work.

## 0.1.3 unchanged coding repeat and context failure, 12 October

[coding-9HTadP](evidence/coding-context-pause-windows.json) uses the same frozen514-file corpus, requested local9B model,32Kcontext/8192output and unchanged reserves/approval limits. Sandbox preflight passes. After9calls/378543ms, the live task pauses at CONTEXT_BUDGET before another request; no final answer or publication is accepted. The retained receipts show two target files edited, repeated reads and three approved visible test runs.

A separate fresh native diagnostic grades the final tree9/9, confirms unrelated files unchanged, preserves the diagnostic stage and finds zero stored browser sessions after cleanup. This is a repaired tree from an incomplete task, not a third successful end-to-end trial. The prior success and8/9failed repeat remain unchanged.

[Offline admission replay](evidence/coding-context-fit.json) on this exact saved context observes26157serialized input bytes including unchanged tool schemas against24192available bytes. Shortening3superseded structured receipt texts gives22701bytes, with0messages removed and all exact actions and original input unchanged. It preserves all metadata and the complete durable tool records. This is a deterministic context-admission result, not a measured inference speedup or proof of future live task success. Fresh live acceptance is pending.

## Successful unchanged repeat after context fix

[coding-vwOFL5](evidence/coding-context-repeat-windows.json), source a8bded9:6calls/218119ms, actual reads/writes, approved visible tests and git_diff. The unchanged fresh independent grader passes9/9, published source passes9/9 and exact rollback succeeds. No CONTEXT_COMPACTED event occurred: this run needed fewer calls, so no causal speedup or compaction-success claim is justified. The prior failure context separately fits under the new deterministic helper. All four32K/8192trials remain retained (two end-to-end successes, an8/9failed repeat and a context-paused task with a9/9diagnostic). This small consumed task set is not a reliability rate.

## Studio long-conversation laboratory, 12 October

The new `npm.cmd run benchmark:ui` serves the production frontend against a disposable authenticated host with40saved messages and20long code-rich responses. Three cold and three warm navigations per profile; CPU profiles are collected separately. [Raw-sample summary and hashes](evidence/ui-performance-windows.json) retain the exploratory baseline, corrected measurement baseline, first candidate and final verified result.

| Profile / cache | Baseline median (range), ms | Final median (range), ms |
| --- | --- | --- |
| Desktop cold |223.3 (217.0-223.6)|134.4 (133.0-195.0)|
| Desktop warm |185.1 (180.1-193.0)|119.3 (111.7-127.8)|
| Phone-layout cold |1940.3 (1871.2-2002.3)|1657.5 (1634.0-1711.2)|
| Phone-layout warm |1452.3 (1424.0-1468.7)|1131.8 (1120.9-1220.2)|

Phone-layout is390x844 desktop Chromium at4xCPU,80ms synthetic latency,10Mbpsdown/2Mbpsup on the recorded20-thread Core Ultra host. It is not physical Android. Median keyboard-to-two-frame observations across repetitions are20.65ms before/12.25ms after; desktop4.80/4.85ms. These are lab proxies, not field INP or exact screen-paint measurements. The candidate meets the predeclared15percent warm-phone improvement gate (22.1percent), with final behavior checks.

Native content visibility skips layout of older offscreen message articles; latest two messages render normally and full content remains accessible. Actual profile identified scrollHeight-triggered layout. Keyboard focus now pauses following only when it reveals earlier/offscreen content. Initial candidate failures are retained: older-code focus was repinned; the landscape fixture needed native anchoring disabled to force its existing adverse condition. No assertions/timeouts were relaxed. Full22affected browser cases pass2.9min, then final3focus/landscape cases pass21.2s; fresh strict build/final types pass. The broader performance matrix, field observations, physical phone and model/runtime measurements remain open.

## Source editor lab observation

A95,780-byte/2,001-line TypeScript fixture renders36 DOM lines and retains exact full contents after editing the last line. One actual file-click-to-editor-DOM-plus-two-frames observation is338.3ms on local desktop Chromium at390px; driver-inclusive setup is1,997ms. This is a single unthrottled browser lab observation, not field INP, paint time or physical-phone performance. The lazy source editor adds457.47kB minified/160.34kB gzip JS and2.86kB CSS; the entry remains515.39kB/156.77kB gzip. No code-editor download for ordinary text. Full repeated UI performance remains covered separately by ui-performance-windows.json.
