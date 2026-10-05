# Providers, local inference and resource admission

Researched and implemented on 2026-10-04. These decisions describe the current `server/providers` and `server/hardware` modules. Availability and performance are discovered at runtime; unknown values are not fabricated. Cloud contract tests use deterministic transports and incur no provider charges.

## Runtime decision

| Option | Strengths for this product | Current decision |
| --- | --- | --- |
| Ollama native API | Windows, Linux and macOS host installation; installed/running model discovery; GGUF metadata; tool calls; per-request context and CPU offload; measured timing | Primary local path. Native `/api/chat`, `/api/tags`, `/api/show`, `/api/ps`. |
| llama.cpp server | Direct control of GPU layers, cache precision, slots and context; CPU, CUDA, Metal and Vulkan backends | Architectural reference and future adapter; Relay does not spawn or configure a second inference runtime. |
| LM Studio | Native model metadata and load/unload API; desktop operation; compatible model APIs | Live native discovery and compatible streaming adapter. Automatic admission remains unavailable without attention geometry or a calibrated memory profile. |
| vLLM | Batching and high throughput on dedicated inference hosts | Deferred. Current GPU installation requirements are Linux oriented; desktop stability and native Windows support outweigh server throughput here. |

Sources: [Ollama chat API](https://docs.ollama.com/api/chat), [installed models](https://docs.ollama.com/api/tags), [running models](https://docs.ollama.com/api/ps), [Ollama API types including model metadata](https://github.com/ollama/ollama/blob/main/api/types.go), [llama.cpp server options](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [LM Studio native REST API](https://lmstudio.ai/docs/developer/rest), [vLLM GPU requirements](https://docs.vllm.ai/en/latest/getting_started/installation/gpu/).

The browser never talks directly to inference runtimes. Local adapter origins are restricted to HTTP loopback; redirects are rejected. Ollama can itself forward cloud models, so `remote_host`/`remote_model` metadata marks those profiles as nonlocal and unavailable in this adapter. A local URL is not proof of local execution. For installations requiring local-only runtime behavior, set `OLLAMA_NO_CLOUD=1` on the Ollama process and restart it. Relay does not change another application's global configuration. See [Ollama cloud support](https://docs.ollama.com/cloud) and [the cloud-disable setting](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features).

## Model and provider contracts

`Providers` implements `ProviderGateway`: `listModels()`, `statuses()`, `stream(request)`. Concrete controls include `verify(provider)` and `setEnabled(provider, enabled)`. Disabling immediately aborts that provider's active transports. Task cancellation and transport timeout are combined into the same signal.

Models carry a stable provider-prefixed ID, capabilities, context limit, quantization, file size, runtime state, optional prices and measured throughput. `details` records provenance, native metadata, digest and measurement conditions. Installed models are not claimed to be loaded; only runtime process discovery sets `ready`. A successful discovery request indicates reachability/authentication, not that every model invocation will succeed.

Provider health distinguishes configuration, enabled state, reachability, authentication, rate limiting and last check time. An unconfigured optional cloud provider has no error. Discovery refreshes at most every 15 seconds, with explicit verification available. Root policy, authorization, workspace egress and budget checks remain outside the provider adapter. Provider-specific failures cannot grant permissions or cause tool execution.

Registry capabilities use live metadata where supplied and conservative documented family compatibility elsewhere, labelled as such. In particular, OpenAI's model-list API does not supply a comprehensive capability, context or pricing table. Unknown prices remain null; a strict cost budget cannot be safely interpreted as zero. See [OpenAI model listing](https://developers.openai.com/api/reference/resources/models/methods/list) and [Anthropic model metadata](https://platform.claude.com/docs/en/api/models/list).

## Cloud API choices and wire correctness

| Provider | Request and streaming contract | Tool continuation |
| --- | --- | --- |
| OpenAI | Responses API, SSE, `max_output_tokens`, `store:false`, encrypted reasoning included privately | Function declarations are flat `type:function` objects; calls use `call_id`, results use `function_call_output`; native output items replayed privately |
| Anthropic | Messages API, SSE, `max_tokens`, `anthropic-version:2023-06-01` | `tool_use` content blocks and user `tool_result` blocks; partial JSON collected until block completion; thinking/signatures retained privately |
| Gemini | Current Interactions API, SSE, `generation_config.max_output_tokens`, `store:false` | Stateless native steps include model output, calls, results and private thought signatures; `arguments_delta.arguments` is assembled until step completion |

Sources: [OpenAI Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), [OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [Gemini Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview), [Gemini streaming](https://ai.google.dev/gemini-api/docs/streaming), [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Interactions API reference](https://ai.google.dev/api/interactions-api).

Native continuation is deliberately separate from visible text in `ModelMessage.providerData`. It is backend-only context, never an activity event. Dropping provider-native reasoning items/signatures between tool turns can invalidate subsequent requests; exposing them as user-facing reasoning is also incorrect.

The stream parsers handle split UTF-8, CRLF, NDJSON and SSE boundaries. A record is limited to 1 MiB and a stream to 32 MiB. EOF alone is not success. The adapter requires a valid provider completion event, rejects truncated output and buffers all tool proposals until completion and JSON validation. Unknown tools, array-valued arguments and malformed JSON fail before any callable proposal is emitted. A model tool proposal must still pass the orchestrator's capability, policy, approval and schema boundaries.

Usage is emitted only when both input and output counts are explicit finite nonnegative numbers. Missing usage is unknown, never a zero-cost response. Anthropic cumulative output and separately reported cache input are normalized; detailed cache billing tiers are not currently priced by the registry. Transport errors have sanitized messages; raw provider errors may contain request data and are not passed to the browser. There is no invisible transport retry: the controller decides whether retry is safe after recording the failure.

`store:false` does not mean zero provider retention. Account-level data controls and provider policies still apply; see [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data). Authentication is server-only and fixed official HTTPS endpoints are used. Current execution is text and structured tool proposals. A discovered vision capability is metadata, not a claim that Relay implements image input yet.

## Real Qwen3 failure and correction

The installed `qwen3:4b` on this host resolves to Qwen3-4B-Thinking-2507, not a switchable nonthinking model. Its model metadata says `general.finetune: Thinking`; its template always starts the assistant with a thinking prefix. Forcing `think:false` disabled Ollama's thinking separation without stopping reasoning generation. This behavior is also reported in [Ollama issue 12022](https://github.com/ollama/ollama/issues/12022) and [issue 12736](https://github.com/ollama/ollama/issues/12736).

Controlled local comparison on Ollama 0.32.15 used identical tool schemas, context 8192, seed 42 and maximum 256 generated tokens. With `think:false`, the response had 1,145 ordinary content characters and no separate thinking; with the field omitted, it had zero ordinary content characters and 1,138 private thinking characters. Both stopped at the token limit without tools. No tool was executed in this comparison.

Relay therefore preserves the runtime's default reasoning mode. Dedicated thinking fields remain private, and explicit `<think>...</think>` blocks are withheld even when the tags split across stream chunks. An unclosed private block is never flushed. Untagged ordinary text cannot reliably be classified as private reasoning; a prompt asking the model not to think is not a technical fix. The official [qwen3:4b-instruct](https://ollama.com/library/qwen3:4b-instruct) variant is a better candidate for small output budgets, subject to live tool acceptance. This report does not claim acceptance succeeded merely because parsing is fixed.

## Memory admission

`getHardware()` collects CPU topology and load, physical RAM availability, swap/pagefile use, GPU identity and available memory telemetry, storage and OS/architecture. It uses `systeminformation` and OS fallbacks. Unknown GPU memory use is null, never zero. Vendor detection is not limited to NVIDIA. See [systeminformation graphics](https://systeminformation.io/graphics.html) and [memory](https://systeminformation.io/memory.html).

`assessModel()` currently supports classical attention geometry for an explicit set of GGUF architectures. It rejects unknown and hybrid architectures instead of applying a misleading formula. For supported models:

```text
KV bytes = layers × KV heads × (key dimension + value dimension)
           × 2 bytes per f16 value × requested context tokens
peak     = quantized weight bytes + KV bytes
           + max(512 MiB, 15% of weights) + 512 MiB runtime/load buffers
```

This is an estimate, not an allocation guarantee or measured fit. Buffers are a conservative starting policy, not a universal runtime constant. GGUF quantization reduces weight storage, while KV allocation depends on attention geometry and context. Cache quantization, batch shape, attention kernels, projectors and runtime-specific allocations can change the real requirement. Current admission assumes one active local sequence and reserves f16 KV even if a runtime enables quantized cache. Runtime batching/concurrency must not be raised without corresponding estimator changes. The [llama.cpp server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) describes the independent context, cache, GPU and slot controls; [vLLM engine options](https://docs.vllm.ai/en/latest/configuration/engine_args/) likewise separate KV reservation from GPU utilization settings.

Policy requires a sample no older than 15 seconds. Available physical RAM must cover the estimate plus `max(4 GiB, 20% total RAM)` reserved for the host. Swap is never added to capacity; substantial swap use queues the request. A discrete GPU must fit the estimate while leaving `max(1 GiB, 15% VRAM)` unused. Fresh, same-context resident model allocation is credited only on a single-GPU host. Missing allocation timestamps receive no credit.

If known discrete GPU pressure prevents admission but physical RAM safely covers the full estimate, Ollama receives an explicit execution override `num_gpu:0`. This is an enforced CPU path, not a recommendation the runtime may ignore. Unknown GPU telemetry is rejected rather than treated as free memory. Partial layer offload and multi-GPU placement are not yet calibrated and are not claimed.

The controller serializes local generations and rechecks hardware at admission. Relay does not unload models owned by another application. Current model retention uses a five-minute keep-alive; stopping a request cancels generation, not necessarily the runtime's cached allocation. Aggressive unloading would require ownership and resident-model coordination.

## macOS, AMD, Intel and GPU telemetry

Apple Silicon is unified memory: CPU RAM and GPU capacity are not independent budgets. Admission counts the peak once against available physical RAM and does not add fictitious VRAM. Apple exposes `hasUnifiedMemory`, `currentAllocatedSize` and `recommendedMaxWorkingSetSize`; the last is an approximate GPU working-set recommendation, not all free RAM. This implementation does not yet bind native Metal device telemetry, and its UI warning states that limitation. See [Apple unified memory](https://developer.apple.com/documentation/metal/mtldevice/hasunifiedmemory), [allocated size](https://developer.apple.com/documentation/metal/mtldevice/currentallocatedsize) and [recommended working set](https://developer.apple.com/documentation/metal/mtldevice/recommendedmaxworkingsetsize).

Ollama handles supported Metal, CUDA and AMD runtime acceleration; Relay does not infer support solely from a vendor name. See [Ollama GPU support](https://docs.ollama.com/gpu). Generic AMD/Intel telemetry can be incomplete, in which case unknown values remain visible. CPU-only hosts use the same physical-memory reserves. Tests include an Apple unified-memory profile and a CPU-only profile, but this development host supplies no actual macOS/AMD hardware acceptance evidence.

For future detailed NVIDIA collection, NVML is a more stable interface than parsing human-readable `nvidia-smi` tables. Windows WDDM can limit process-level memory attribution; do not interpret unavailable data as zero. See [NVML reference](https://docs.nvidia.com/deploy/nvml-api/latest/index.html) and [nvidia-smi documentation](https://docs.nvidia.com/deploy/nvidia-smi/index.html). Current implementation uses supported `systeminformation` telemetry instead of introducing a new native NVML binding.

## Credentials

`SecretManager` supports environment credentials, explicit session-only credentials and OS-backed persistence through `@napi-rs/keyring`. Persistent storage uses Windows Credential Manager, macOS Keychain or Linux Secret Service. Linux is pinned to Secret Service because the library's automatic kernel-keyring fallback is volatile. If persistent storage fails or is locked, saving fails explicitly; no plaintext file is written. Tests cover missing keyring, session masking/removal and accurate persisted-storage status.

Sources: [Windows credential handling](https://learn.microsoft.com/en-us/windows/win32/secbp/handling-passwords), [macOS Keychain Services](https://developer.apple.com/documentation/security/keychain-services), [Secret Service specification](https://specifications.freedesktop.org/secret-service/latest/ch01.html), [keyring library platform behavior](https://github.com/Brooooooklyn/keyring-node/blob/main/README.md).

An OS credential vault protects storage, not arbitrary same-user subprocesses. Generic Windows credentials may be accessible to other processes under that user; see [Windows credential kinds](https://learn.microsoft.com/en-us/windows/win32/secauthn/kinds-of-credentials). Agent tools therefore must not inherit provider environments, read host vaults or execute unrestricted host commands. Those boundaries belong to the tool broker. Removing an environment key masks it in the current service session; it cannot erase the service launcher's inherited environment across restarts.

## Measurements and validation

The observed Windows host had an RTX 5070 with 12,820,938,752 reported GPU bytes, Intel Core Ultra 7 265KF and 33,847,615,488 physical RAM bytes. A sample at 2026-10-04T03:51:20Z reported approximately 16.09 GB available RAM and 1.33 GB GPU memory use. The 2,497,293,931-byte `qwen3:4b` passed conservative context-8192 admission at an estimated 4,778,995,307-byte peak. These numbers are historical observations, not hardcoded assumptions.

At that pressure, the existing 14B coder did not meet complete RAM reserves; the hybrid Qwen3.5-family models had unsupported attention geometry and were rejected. No reserves were weakened to make an acceptance test run.

Completed Ollama calls expose runtime prompt/generation counts and durations. Measured throughput is retained across discovery refreshes with model digest, context and execution conditions. `MeasuredProviders` adds durable `model_profiles` records on successfully completed calls with explicit measured throughput. The key combines provider, runtime, model ID, model digest and a SHA-256 hash of hardware configuration. CPU/GPU identity, RAM capacity, platform/architecture and GPU drivers contribute to that hash; utilization, free memory, temperature, usernames and hostnames do not. The hardware configuration is sampled once per service instance. A hardware or driver change requires restarting the service before new measurements are comparable.

Reload validates the complete identity and measurement shape before merging performance fields. Current discovery remains authoritative for availability, capabilities, context limits and pricing. An explicit persistence allowlist excludes arbitrary metadata, prompt content, provider continuation and credentials. Only the latest measurement for a given model/digest/hardware combination is retained, together with its context, execution override and timestamp. Failed calls or calls without current usage cannot recycle an older measurement into a new record. Measurement storage failure is surfaced through `measurementStatus()` and does not turn successful generation into an automatic replay. The wrapper performs no inference on its own; benchmarks enter through ordinary authorized tasks and the local execution lease.

Measurement is not a broad quality benchmark. No cloud model or macOS runtime has been live-tested without credentials/hardware. `tests/model-profiles.test.ts` exercises durable restore, identity mismatches, private-data exclusion, incomplete calls and unavailable profile storage using PostgreSQL and deterministic provider transports.

Run `npm test -- tests/providers.test.ts tests/hardware.test.ts` for deterministic protocol and resource checks. Coverage includes chunk boundaries, terminal checks, invalid tools, missing usage, continuation, cancellation, provider disable, secret handling, cloud forwarding, private reasoning, stale/unknown telemetry, context growth, swap exclusion, CPU overrides, resident-allocation timestamps and unified memory. End-to-end acceptance results are recorded separately by `scripts/acceptance.mjs` and must be checked before claiming real task completion.
