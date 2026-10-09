# Choosing among installed local models

Research checked **9 October 2026**. This supplements [the broader runtime/routing evaluation](research-model-routing-tools.md). No router, classifier, executable or model was installed or benchmarked for this comparison. Recommendations below are engineering judgments, not measured improvements.

## Decision

Keep Relay's authorization, resource admission and runtime adapters. Add task-specific quality evidence before replacing the router with a third-party proxy. Evaluate **llmfit as an optional hardware/catalog advisor** and **Aurelio Semantic Router with a local encoder as an optional intent classifier**. They solve different problems. Neither can certify that a newly downloaded model is the best model for a particular request.

The lowest-overhead first improvement is a small, explainable task-category layer in Relay plus per-model evaluation records. A separate learned router becomes worthwhile only if it improves held-out task success enough to justify loading another model or running another service. This recommendation deliberately preserves room to reuse an existing classifier rather than build one from scratch.

## What Relay currently does

The inspected [selectModel implementation](../server/orchestration/router.ts) filters discovered models by provider grants, offline/error status, local-only policy, explicit required selection, tools, context and hardware admission. It then scores explicit preference, locality, ready state, tool support and measured throughput. It penalizes mandatory-thinking variants because bounded calls can exhaust their output budget before producing an answer.

The 0.1.1 continuation adds an explicit specialist/keyword category derived from the objective and optional artifact-bound fixed-probe scores. A bounded score adjustment follows the hard eligibility checks; reasons disclose missing evidence and the small probe's limits. All specialists use this shared path. More installed models enlarge the safe candidate pool, but the category heuristic and six public JSON probes do not establish which model will solve an arbitrary prompt best. Speed calibration is valuable, but tokens per second is not task accuracy. See [calibration](calibration.md) for the implemented protocol and evidence binding.

## Current candidates

| Candidate | What it supplies | Cost to Relay / limits | Recommendation |
| --- | --- | --- | --- |
| llmfit | Native hardware fit, catalog and use-case recommendations | Catalog/family estimates need exact installed-artifact matching; does not establish prompt-level task success | Optional advisor first |
| Aurelio Semantic Router | Intent matching with configurable embeddings and route thresholds | Python integration plus encoder; local inference still uses host resources; a route label needs a separately justified model mapping | Best focused classifier candidate to evaluate |
| LiteLLM auto_router | Heuristic, classifier and adaptive model-pool routing | Larger gateway overlaps existing adapters/accounting; beta contract; classifier calls may add egress | Evaluate only when gateway consolidation also helps |
| lm-sys RouteLLM | Learned strong/weak routing and evaluation | Default MF embedding path is cloud-based; model-pair calibration and dependency maintenance required | Offline research reference |
| vLLM Semantic Router | Dedicated inference-routing platform | More operational/classifier footprint than a small desktop host needs | Dedicated-server option, not default dependency |
| Arch-Router 1.5B | Small model selecting among described routes | Extra model residency/inference; custom model license; intent matching is not verified quality | Research-only until licensing and measured value are established |
| llm-checker | Node CLI with hardware/catalog/Ollama workflows | Different license and overlapping functionality; not a prompt-quality oracle | Do not bundle by default |

### llmfit

The original [AlexsJones project](https://github.com/AlexsJones/llmfit) is MIT licensed and supports native Windows, Linux and macOS. The [release feed](https://github.com/AlexsJones/llmfit/releases) shows v1.1.17 dated 8 October 2026. Its [CLI](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/cli.md) supplies JSON recommendations and use-case/context controls; use a pinned binary and contract-test supported flags.

The documented [scoring](https://raw.githubusercontent.com/AlexsJones/llmfit/main/docs/how-it-works.md) combines memory fit, speed, context and quality. Task alignment uses curated family benchmark values where present, with heuristics otherwise. Quantization/context can be adjusted during fit search. Therefore a catalog recommendation may describe a different quantization or context than the installed artifact. Do not silently substitute those settings or call a family score a measured result on this PC.

**Integration:** run an owner-configured, bounded JSON command without a shell, dashboard, model download or benchmark sharing. Send a task-category enum and requested context, not conversation content. Intersect output with exact runtime identities/digests. Preserve estimated-versus-measured provenance. Relay's fresh admission and memory lease remain authoritative.

### Aurelio Semantic Router

The [MIT-licensed project](https://github.com/aurelio-labs/semantic-router) supports local encoding and threshold-based route matching. Its [Ollama encoder](https://raw.githubusercontent.com/aurelio-labs/semantic-router/main/semantic_router/encoders/ollama.py) allows an installed local embedding service. Example cloud encoders must not be mistaken for an offline configuration. In-memory/local indexing is enough for a small route set; an external vector database is unnecessary.

The repository warns that main is a breaking 1.x rewrite while examples still describe 0.x; the [release feed](https://github.com/aurelio-labs/semantic-router/releases) includes a development release. Pin a reviewed stable version rather than installing unqualified latest.

**Integration:** evaluate a local-only classifier returning a constrained category and score. Provide curated example requests per category, measure false matches and add an abstain threshold. Do not let a natural-language result name arbitrary model IDs. Its principal advantage is reusable semantic intent matching; **which installed model serves that intent still needs Relay-specific evidence**.

### LiteLLM

Current [beta auto routing](https://docs.litellm.ai/docs/proxy/auto_routing) supersedes the deprecated semantic-only router. It supports heuristics, LLM classification, keyword rules, custom classifiers and fixed/random/adaptive pools. A heuristic route need not make a model call; classifier and embedding modes can. Published latency claims are not measurements on Relay's host. The [license](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE) is MIT except separately licensed enterprise code.

Relay already owns normalization, per-user credentials, budgets, retries, cancellation and scheduling. A new proxy duplicates those boundaries unless it replaces substantial gateway work. Adaptive selection also needs a credible reward: successful HTTP generation is not evidence that code is correct. If evaluated, supply only pre-authorized candidates, partition usage per user and disable prompt-retaining callbacks. Cloud classifiers require independent egress permission even when the selected answering model is local.

### RouteLLM

The original [lm-sys implementation](https://github.com/lm-sys/RouteLLM) is Apache-2.0 licensed and targets strong/weak trade-offs. Its [matrix-factorization source](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/routellm/routers/matrix_factorization/model.py) uses OpenAI embeddings for prompt representation. Changing that representation requires compatibility work or retraining, not just an endpoint toggle. The inspected [main history](https://github.com/lm-sys/RouteLLM/commits/main/) tops at August 2024; that is insufficient current maintenance evidence for a default dependency. Other similarly named repositories are different projects.

Use its evaluation approach as a reference. Do not assume a router trained on one strong/weak pair transfers to arbitrary quantized local models downloaded later.

### Other options and licensing

[vLLM Semantic Router](https://github.com/vllm-project/semantic-router) is Apache-2.0 and offers a broader serving layer. See the existing research document for its containers, classifier memory and stable-versus-development distinctions. Its richer deployment is better suited to a dedicated inference server than this default cross-platform installation.

[Arch-Router 1.5B](https://huggingface.co/katanemo/Arch-Router-1.5B) matches requests to supplied domain/action descriptions. That is useful routing machinery, but it still does not benchmark the target models. Its [model license](https://huggingface.co/katanemo/Arch-Router-1.5B/blob/main/LICENSE) is a custom research license with separate commercial terms; do not infer permissive weight redistribution from a related gateway's software license. No adoption is recommended here.

[llm-checker](https://github.com/signerless/llm-checker) offers a Node-based catalog/hardware workflow. Its current README identifies NPDL-1.0 and restricts paid distribution/hosted use without a separate commercial license. It is not a drop-in permissively licensed dependency. This is a reason to defer bundling, not a claim that all personal use is prohibited.

## Concrete implementation sequence

1. **Preserve hard eligibility.** Discover installed models dynamically; reject unavailable/ungranted models first. Apply modality, tools, context, privacy and resource requirements before ranking. Required manual selection stays required. A catalog suggestion cannot become an installed candidate.
2. **Add task intent transparently.** Classify obvious coding, explanation, extraction/structured-output and general-chat requests with conservative rules and explicit specialist/task settings. Mark this as heuristic. Avoid treating a model name containing “coder” as measured coding quality. Ambiguous prompts fall back to the existing safe ranking.
3. **Record evidence by exact artifact.** Key measurements by model digest, runtime/version, quantization, context, generation settings, hardware fingerprint and evaluation-suite version. Store throughput separately from category success, tool-schema compliance and visible-answer completion. New downloads start with unknown evidence; changed artifacts invalidate old scores.
4. **Run owner-started calibration.** Use synthetic/public prompts under the existing scheduler, cancellation and resource budgets. Test deterministic extraction/JSON constraints, real tool schemas, simple conversation, reasoning with verifiable answers and coding cases with executable tests where an approved sandbox exists. Skip unavailable verification rather than award a pass. Do not retain other users' prompts as a training set.
5. **Evaluate reusable advisors.** Start with llmfit's bounded recommendations. Compare the local Semantic Router classifier against the simple rules on the same held-out prompts. Count classifier memory, cold-load time, total model calls, latency and load churn. Only enable automatic classifier use after it demonstrates a useful improvement.
6. **Explain every selection.** Example: “Coding task; installed model; tools supported; 8/10 tests on local calibration; 18 tok/s measured; fits the requested context.” Unknown quality must remain unknown. Estimated family fit and measured local success must have different labels.

Use disjoint calibration and evaluation examples, repeated runs for nondeterministic models, multilingual prompts relevant to users, mixed-intent requests, out-of-domain prompts and prompt-injection attempts. A routing label never expands file access, provider grants, cloud spending or network permissions. Recheck availability and memory after selection, before acquiring resources. Prefer abstention/fallback over a classifier that confidently names an ineligible model.

**Acceptance gate:** improve held-out task success or reduce measured latency/resource use at comparable success, without privacy/policy regressions. Until that evidence exists, call the result a recommendation—not “the best model.”
