# Reusing model-routing and local-runtime tools

Research date: **9 October 2026**. This is a source-based evaluation, not an integration or benchmark result. No candidate was installed, enabled, or given Relay requests during this research. Release observations below are dated evidence; development documentation can describe features absent from a stable release.

## Recommendation

Relay should reuse existing inference runtimes and evaluate **AlexsJones/llmfit as an optional, local recommendation helper**. It should retain its small deterministic authorization and resource-admission core. A model recommendation cannot grant access to another account's provider, authorize data egress, or reserve memory.

For task-quality routing, conduct a controlled evaluation before adopting a learned classifier. **LiteLLM's current beta auto-router** deserves consideration if Relay needs a broader provider gateway. **RouteLLM** is a useful research reference but has maintenance and default privacy concerns. **vLLM Semantic Router** is better evaluated on a dedicated inference host than added to every desktop installation.

These tools address different questions:

| Question | Reusable component | Authority that remains in Relay |
| --- | --- | --- |
| What is installed or loaded? | Native runtime discovery and lifecycle APIs | Account-visible registry; distinguish downloaded, resident and usable models |
| What might fit this computer? | llmfit; runtime-specific estimates | Fresh RAM/VRAM admission, reservations and safety headroom |
| Which eligible model may solve this task well? | Evaluated routing rules or classifiers | Capability requirements, privacy, grants, budgets and objective verification |
| How should a model process load or unload? | Ollama, LM Studio, llama.cpp; optionally llama-swap | Ownership of the runtime, cancellation and preventing disruption of other applications |

## Starting point in Relay

The current [router](../server/orchestration/router.ts) already filters discovered models by account grants, availability, privacy, explicit model choice, tools, context and admission. Its score prefers local/ready models and measured throughput, with penalties for known output-budget problems. This is an explainable heuristic, **not a trained estimate of task success**.

The [hardware module](../server/hardware/index.ts) accounts for weights, supported architecture-specific KV estimates, buffers, host reserves and current pressure. It distinguishes unified memory from discrete VRAM and can fail closed when measurements are insufficient. [Local providers](../server/providers/local.ts) and [calibration](../server/models/calibration.ts) already reuse runtime APIs and record measurements. See [local inference](local-inference.md) for their limits.

The useful additions are richer metadata, better measured recommendations and, eventually, validated quality routing. Replacing these boundaries with a general proxy would duplicate per-user secrets, budget accounting, retries, cancellation and the shared host lease.

## Candidate comparison

| Candidate | Useful capability | Operational fit | Decision |
| --- | --- | --- | --- |
| **llmfit** | Hardware detection, model-fit ranking, JSON output, runtime discovery and optional benchmarks | Native Rust executable; no always-running service needed for the proposed integration | **Evaluate first**, advisory only |
| **LiteLLM Router / Proxy** | Provider normalization, deployment balancing, fallbacks; newer task-aware auto-routing | Python component/service; optional infrastructure and logging integrations need explicit configuration | **Defer default dependency**; evaluate when adapter breadth justifies a gateway |
| **RouteLLM** | Learned strong/weak-model selection and evaluation | Python/ML dependencies; trained models and embedding assumptions | **Research/evaluation only** initially |
| **vLLM Semantic Router** | Rich classification, routing decisions and inference policies | Container/classifier footprint; stable and development interfaces differ | **Dedicated-host evaluation**, not default desktop dependency |
| **Ollama / LM Studio / llama.cpp** | Discovery, inference, loading, unloading and runtime measurements | Already fit the runtime-adapter boundary | **Reuse official APIs**, version-detect capabilities |
| **llama-swap** | On-demand process/model swapping across configured backends | Go executable, plus the inference runtimes it manages | **Conditional option** for an explicitly Relay-owned runtime fleet |

### llmfit: the smallest useful new integration

The original [AlexsJones/llmfit repository](https://github.com/AlexsJones/llmfit) is MIT licensed and provides native Windows, Linux and macOS tooling. Its [release history](https://github.com/AlexsJones/llmfit/releases) showed **v1.1.17 on 8 October 2026**, including ranking and hardware-estimation corrections. This assessment concerns that project, not similarly named forks.

The [CLI](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/cli.md) exposes JSON recommendations filtered by use case and context, alongside benchmark commands. [Provider documentation](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/providers.md) describes installed-runtime discovery. This could improve Relay's model-management recommendations without importing a Python inference stack or forwarding a user's objective to another model.

Its [estimation design](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/how-it-works.md) combines hardware measurements, architecture assumptions and catalog scores. Some performance values are estimated or community-derived; quality can include family-level heuristics. A fit label is neither a reservation nor proof that a particular model follows tools correctly. Relay must preserve provenance and reject optimistic assumptions about shared memory, multi-GPU allocation or current free memory.

Two defaults matter. The [interactive documentation](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/tui.md) describes a dashboard listening on `0.0.0.0:8787` outside JSON mode, with an explicit disable option. [Benchmark sharing](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/benchmarking.md) is a separate publishing workflow; it must remain off. A recommendation helper needs neither a dashboard nor GitHub credentials.

The [quality implementation](https://raw.githubusercontent.com/AlexsJones/llmfit/main/llmfit-core/src/quality.rs) uses rubric/regex scoring and stores a response preview. It also sends inference settings that may differ from Relay's handling of reasoning models. These probes are useful diagnostic inputs, but do not replace compilation, tests, tool-schema compliance or actual task outcomes. Do not label their results as verified coding quality.

**Decision:** evaluate bounded JSON recommendations first. Treat benchmarking as a later, explicitly scheduled operation. Pin and test an exact release: documentation on `main` is not a guarantee that every documented flag exists in the selected binary.

### LiteLLM: useful gateway, with a newer routing option

The established [Router](https://docs.litellm.ai/docs/routing) handles deployment selection, retries, fallbacks and latency/cost/usage policies. Redis can coordinate state across instances; it is not inherently required for a single-process integration. Load balancing by latency is distinct from choosing a model for task quality.

The current **[beta auto-router](https://docs.litellm.ai/docs/proxy/auto_routing)** supports heuristic and classifier-based selection, tier/pool configuration and adaptive choices. That page explicitly deprecates the older semantic auto-router. An assessment based only on older LiteLLM examples would miss this capability. LLM or embedding classification can add another model call, cost and data-egress boundary; local heuristics need not require a cloud service.

The [release page](https://github.com/BerriAI/litellm/releases) showed **v1.104.2 on 8 October 2026** and subsequent release candidates. The [license](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE) is MIT except separately licensed enterprise code. Feature availability must be checked against the chosen edition and version.

The [security policy](https://github.com/BerriAI/litellm/security) states that self-hosted data is not sent to LiteLLM servers. This does not mean configured observability cannot retain prompts: [logging callbacks](https://docs.litellm.ai/docs/proxy/logging) and [OpenTelemetry options](https://docs.litellm.ai/docs/observability/opentelemetry_integration) require deliberate content-redaction settings.

**Decision:** defer a default proxy. Evaluate privately when maintaining many provider adapters becomes the larger cost. Relay must supply an already-authorized candidate pool, separately authorize classifier egress, account for every retry/classification call and recheck admission after a proposed route. Never expose proxy administrative credentials to agents or browser clients.

### RouteLLM: promising research, unsuitable default assumptions

[RouteLLM](https://github.com/lm-sys/RouteLLM) is Apache-2.0 licensed and focuses on routing between stronger and cheaper models. Its published evaluation is evidence for tested workloads, not a guarantee for Relay's current installed models. The inspected [main history](https://github.com/lm-sys/RouteLLM/commits/main/) topped at **10 August 2024**, and [GitHub releases](https://github.com/lm-sys/RouteLLM/releases) were absent. That is insufficient evidence of active 2026 release maintenance; it does not prove abandonment.

The [package definition](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/pyproject.toml) adds Python ML dependencies including Torch and Transformers. More significantly, the [matrix-factorization implementation](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/routellm/routers/matrix_factorization/model.py) embeds the prompt through OpenAI `text-embedding-3-small`. Therefore, two local output models do **not** make this default route decision local-only.

The [router implementations](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/routellm/routers/routers.py) also include local classifier approaches. Replacing an embedding model is not merely a privacy toggle: its representation must match or retrain the learned routing model.

**Decision:** use as an offline evaluation reference. Production adoption would require a maintained dependency path, approved/local classification, training or calibration against Relay's actual model pairs, and a measured benefit over simpler rules.

### vLLM Semantic Router: substantial inference infrastructure

The [project](https://github.com/vllm-project/semantic-router) is distinct from the vLLM inference runtime. Its [architecture](https://raw.githubusercontent.com/vllm-project/semantic-router/main/website/docs/overview/semantic-router-overview.md) places model-call routing and policies between an application and configured backends. It does not replace Relay's durable agent execution or host permission broker. Its [license](https://raw.githubusercontent.com/vllm-project/semantic-router/main/LICENSE) is Apache-2.0; [releases](https://github.com/vllm-project/semantic-router/releases) showed **v0.4.0 on 27 September 2026**.

The [installation guide](https://vllm-sr.ai/docs/installation/) explicitly follows development: standalone gateway/runtime features are newer than stable 0.4.0, which uses Envoy. The documented local workflow needs Python and containers; Kubernetes is not mandatory. Publisher estimates include roughly 5 GB of images, classifier downloads and about 1.3 GB RAM per 307M classifier. macOS container inference for these classifiers is described as CPU-only. None of these figures was measured on Relay's host.

[Optional storage features](https://vllm-sr.ai/docs/installation/storage-overview/) can retain cache, memory or response data. They need explicit disablement or appropriate account partitioning, especially for Relay's metadata-only external inference contract. Basic routing does not require an external vector database. Telemetry and egress still need an integration-specific audit; no blanket zero-telemetry guarantee is assumed.

**Decision:** evaluate on a dedicated, adequately provisioned inference server if richer classification wins a representative benchmark. Do not spend desktop memory on several classifiers merely to choose between two already constrained local models.

## Delegate model lifecycle to the runtimes

### Ollama

Ollama's [resident-model API](https://docs.ollama.com/api/ps) reports loaded allocation and context information. Its [FAQ](https://docs.ollama.com/faq) documents `keep_alive`, unloading, concurrency/queue controls and memory growth with parallel context. It also documents `OLLAMA_NO_CLOUD=1`; a loopback endpoint alone is not proof that a requested model executes locally now that cloud models exist.

The runtime is [MIT licensed](https://github.com/ollama/ollama/blob/main/LICENSE), with **v0.40.2 on 8 October 2026** observed in [releases](https://github.com/ollama/ollama/releases). This does not describe the version installed on Relay's host.

**Decision:** continue native integration. Configure global runtime limits or unload models only when Relay owns the runtime or the owner explicitly grants that control. Do not evict another application's model to satisfy a Relay task.

### llama.cpp

The current [server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) documents model-directory/preset routing, explicit load/unload APIs, lifecycle events and fit options. Runtime fitting adjusts parameters left unset; it is not tenant policy or a guarantee of preserving requested context. A runtime's default model-count limit is not Relay's memory budget.

The [license](https://github.com/ggml-org/llama.cpp/blob/master/LICENSE) is MIT. [Rolling releases](https://github.com/ggml-org/llama.cpp/releases) included **b11524 on 9 October 2026**. [llama-bench](https://raw.githubusercontent.com/ggml-org/llama.cpp/master/tools/llama-bench/README.md) offers prompt/decode measurements and structured output, not agent-task verification.

**Decision:** prefer its own lifecycle APIs for a future Relay-owned llama.cpp runtime. Detect and contract-test the exact server build; do not assume defaults, endpoints or flags remain stable. Require explicit context, private bindings and controlled model sources.

### LM Studio / llmster

[Headless LM Studio](https://lmstudio.ai/docs/developer/core/headless) supports a standalone daemon and public integration APIs. [Model listing](https://lmstudio.ai/docs/developer/rest/list) distinguishes installed/model state, while [TTL and automatic eviction](https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict) are runtime policies. A model exposed through just-in-time discovery is not necessarily resident.

The [load CLI](https://lmstudio.ai/docs/cli/local-models/load) supports estimation without loading; its output must not be assumed to be a stable JSON contract. The [TypeScript SDK](https://github.com/lmstudio-ai/lmstudio-js) is MIT licensed, but the runtime has separate [application terms](https://lmstudio.ai/app-terms). Public API integration and bundling/hosted-service redistribution are different license questions. Do not infer runtime redistribution rights from the SDK license.

The [offline guide](https://lmstudio.ai/docs/app/offline) states that downloaded models can operate offline; discovery/download/update functions have different network requirements.

**Decision:** use the installed runtime's documented APIs. Add its SDK only if typed lifecycle operations remove meaningful adapter complexity. Check the chosen runtime's current terms before packaging it or offering shared hosting; this research makes no redistribution determination.

### llama-swap

[llama-swap](https://github.com/mostlygeek/llama-swap) is an MIT-licensed Go proxy with native releases, configured process launch, on-demand model switching and lifecycle controls. It selects the requested backend; it does not establish which model will best solve an arbitrary objective. Its [release history](https://github.com/mostlygeek/llama-swap/releases) showed **v262 on 3 October 2026**.

**Decision:** consider it only for a Relay-owned heterogeneous runtime fleet. Its executable commands/hooks, administrative surface and logs require trusted configuration and private exposure. Native llama.cpp routing may already cover a homogeneous fleet. Adding another proxy over Ollama without a specific lifecycle gap creates competing queues and ownership problems.

## Proposed first integration: an optional advisory adapter

This is a proposal, **not an implemented feature**:

1. The owner selects an exact, verified llmfit release/binary. Record version, checksum and license. Do not download or upgrade executables in response to an agent instruction.
2. Invoke a bounded, no-shell JSON recommendation command. Probe supported flags; explicitly disable the dashboard. Set a short deadline and strict output-size/schema limits. Missing, malformed or stale output falls back to the existing router.
3. Pass an enum task category and requested context, never the full objective, files, credentials or conversation. Use a minimal environment: no provider/GitHub tokens or inherited remote-runtime overrides. Runtime probes may contact only approved local endpoints. A minimal environment alone is not a network sandbox.
4. Import recommendation provenance and confidence. Resolve model identity against an installed runtime/digest rather than fuzzy display-name matching. Keep downloadable catalog suggestions separate from currently runnable candidates.
5. Filter using Relay's account, tools, modality, context, cost and egress requirements. Treat advisor ordering as one input. Recheck fresh memory and acquire the existing host lease before inference; advisory fit never authorizes execution.
6. Add optional benchmarks only later, using synthetic public prompts within Relay's scheduler and cancellation path. Disable sharing, account for generated calls and inspect local cache retention. Never send external clients' content through a benchmarking workflow.

This preserves offline usefulness and gives a small, replaceable integration seam. It also avoids asking llmfit to perform security decisions it was not designed to own.

## Evidence required before enabling automatic quality routing

Evaluate against the current router and a fixed best eligible local model using the same installed model versions, quantization, context and task set. Include simple conversation, structured tool calls, coding tasks with executable tests, long-context retrieval and constrained local-only requests. Score task success, invalid tool calls, latency, load churn, observed peak memory, cancellation and total model calls—not answer length or a model's self-rating.

Test low-memory CPU hosts, discrete GPUs and Apple unified-memory profiles separately. Measure advisor/classifier overhead alongside model memory. Verify missing-runtime, stale measurements, provider failure, account revocation and stop-all behavior. No classifier should cause a formerly safe request to leak data, exceed its budget, or route to an ungranted provider.

For an LLM-based classifier, count classification as a real model call and authorize its egress independently. For adaptive feedback, keep account data partitioned and require evidence-backed outcomes; user text and tool content cannot grant routing authority. Ship only after a predeclared quality/latency tradeoff beats the simpler baseline.

The immediate reuse opportunity is therefore narrow and practical: **native runtime control plus an optional hardware/model advisor**. A larger learned-routing service becomes justified when measured task outcomes and deployment scale show a benefit.
