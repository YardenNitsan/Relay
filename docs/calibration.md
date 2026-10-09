# Local calibration

The owner can open Models & providers → Measure local performance. The button submits one fixed public prompt through the regular task controller. It uses the global queue, current hardware admission, local-model lease, durable 120-second budget and emergency stop. File, network, MCP and cloud capabilities are absent. The selected model is required; an unavailable model cannot silently become a benchmark of another model.

The bounded `relay-text-v1` protocol requests approximately 220 words about a library catalog. Results are linked to their persisted conversation, task and model call. The browser shows only counters returned by the runtime: generated tokens, model-load duration, total runtime duration and token throughput where reported. Missing counters remain absent. Failed, truncated or cancelled calls do not establish successful measurements. Stop calibration uses the ordinary task-cancellation endpoint.

For Ollama, nanosecond timings are converted to milliseconds. Generation throughput uses `eval_count / eval_duration`; prompt throughput excludes `prompt_eval_cached_count` when provided. These meanings follow the [official chat API](https://docs.ollama.com/api/chat). Cached/warm runs are not presented as cold-load tests. This small sample is not a reasoning-quality benchmark, measured peak-memory requirement, sustained thermal test or guarantee for another context length.

Durable throughput identity includes model digest, runtime/provider and reported runtime version, plus CPU/GPU/driver and physical-memory identity. A runtime version change invalidates the previous identity. When the runtime does not expose a version the identity records that limitation. Historical records remain available but do not override current capabilities, availability or safety admission. No prompt, private continuation, hostname or provider credential is written into model-profile metadata.

HTTP routes are owner-only: `POST /api/models/calibrations` with `{modelId,contextTokens}` and `GET /api/models/calibrations`. The response links the real task and conversation. Calibration does not bypass active-task quotas or revive a stopped scheduler.

## Optional task-fit probes

**Run task-fit probes** selects `protocol: "relay-task-fit-v1"`. One fixed public JSON prompt contains two tiny coding, two arithmetic/reasoning and two extraction probes. Deterministic code compares the answers with known results. Invalid JSON is a failed format check, not a favorable model opinion. Scores appear separately from throughput and can influence Auto's ranking for an explicitly disclosed specialist/keyword category.

Only completed owner-run probes with matching model ID, digest, provider, runtime and runtime version attach to current model discovery. Changed artifacts invalidate the match. This small protocol is not a benchmark of broad coding/reasoning ability, does not cover multilingual quality and does not prove a model is best. It currently does not bind task-fit scores to every generation/hardware/context setting or use age-based decay. Hardware admission and user/privacy policy remain mandatory regardless of scores. Read [the comparison and evaluation plan](model-routing-comparison.md) before extending the router.
