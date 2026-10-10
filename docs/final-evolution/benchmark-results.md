# Benchmark results

No new model-quality or application-speed improvement is established.

Baseline source: `9d563bc973dbcc177921ab918db88561c8280e48`. Fresh `npm ci`: 291 installed packages, no reported vulnerabilities, Node 24.11.1/npm 11.6.2, Windows. Dependency installation is not application startup latency.

Measure before modifying: compiled-host cold startup, frontend initial render and input latency, navigation, long history, discovery, model load/first observed content/cleanup, tool overhead, queue waits, memory, bundle bytes and retrieval. Keep inference intervals separate from app overhead. Record hardware, model artifact/settings, dataset version, repeated samples and uncertainty. No lowered memory reserves.

Routing experiment must freeze v0.1.2 decisions and version development/held-out labels before candidate tuning. Label agreement measures classification/routing selection, not model task success. Real executable task outcomes are a separate gate. Single-agent/multi-agent comparisons need the same tasks, models, authority, hardware and budget reporting.
