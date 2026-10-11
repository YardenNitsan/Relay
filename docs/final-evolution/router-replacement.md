# Pretrained router replacement, 0.1.3

Status: two frozen quality gates failed; subsequent ready-made default configurations also fail acceptance. No candidate is promoted. D07 remains incomplete.

The owner explicitly rejects further dictionary expansion. Keep the existing safety, account discovery, model evidence and admission boundaries. A CPU pretrained classifier supplies advisory requirements; it cannot load models, issue grants, or establish model quality. Only promote a candidate after a frozen comparison, failure tests and integration checks. The phrase implementation remains the active primary baseline pending a verified replacement. It does not satisfy the owner's pretrained-primary requirement.

## Research and alternatives (11 October 2026)

| Component | Appropriate responsibility | Limits and decision |
| --- | --- | --- |
| [Aurelio Semantic Router](https://github.com/aurelio-labs/semantic-router), MIT | Local pretrained encoders with route examples, thresholds and abstention | Benchmark stable PyPI 0.1.16, not the breaking main rewrite. Python process adds packaging/startup overhead; dependencies include LiteLLM even for local execution. No evidence of downstream LLM quality follows from cosine similarity. |
| [LiteLLM](https://github.com/BerriAI/litellm) | Provider API normalization, retries, budgets and operational routing | Not by itself multilingual intent understanding or task-quality evidence. Existing Relay account-scoped providers already enforce spending/egress; replacement would duplicate substantial working code. GitHub reports NOASSERTION for aggregate license; inspect individual distribution terms before shipping. |
| [RouteLLM](https://github.com/lm-sys/RouteLLM), Apache-2.0 | Learned strong/weak model quality-cost routing | Existing learned pairs do not establish quality for arbitrary installed/account models. Last repository push observed August 2024. Not selected as an individual-model universal catalog or Hebrew intent classifier. |
| [Portkey Gateway](https://github.com/Portkey-AI/gateway), MIT | Provider gateway, retries/fallback and observability | Gateway policy does not solve semantic task understanding. Extra service is unjustified until an unmet transport requirement is measured. |

Pretrained CPU candidates: [multilingual MiniLM sentence embeddings](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2) (Apache-2.0), [multilingual E5 small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT), and [multilingual MiniLM NLI](https://huggingface.co/MoritzLaurer/multilingual-MiniLMv2-L6-mnli-xnli) (MIT). Language coverage in a model card is a hypothesis about Relay's Hebrew tasks, not acceptance. Pin revisions, disable remote model code, CPU only, bound threads/input, record RSS and initialization separately. Production must operate offline after deliberate provisioning.

## Experiment contract

Separate route exemplars, development calibration and held-out objectives. Retain every outcome. Freeze candidate code, model revisions, thresholds and evaluator before held-out execution; never retune against that set. Compare baseline required/forbidden labels, task category and latency, with explicit uncertainty. Record startup/RSS and malformed/missing-worker handling. Synthetic routing outcomes do not establish live downstream task success; that remains a separate gate.

Ruling: first finish and verify the inherited Model Studio increment and the known publication failure so a working checkpoint survives router dependency/inference experiments. This preserves prior work instead of discarding an uncommitted feature.

Ruling: the first attempted semantic-router 0.1.11 dependency solve was stopped before installation after expensive LiteLLM backtracking. Use current stable 0.1.16, verified through PyPI metadata. This is a measured integration-cost concern, not a quality conclusion.

## Measured outcomes

These are constraint-satisfaction counts, not exact-match accuracy or downstream task success. Each 64-case set contains 32 English and 32 Hebrew objectives. The manifests and all individual outcomes live in `benchmarks/semantic-routing`.

| Frozen v1 | Satisfied /64 | English /32 | Hebrew /32 | Missing required | Forbidden predictions | Warm p95 | RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Existing phrase baseline | 25 | 12 | 13 | 43 | 15 | See raw report | Not recorded |
| Semantic Router + multilingual MiniLM | 26 | 12 | 14 | 36 | 11 | 17.63ms | 928MB |
| Semantic Router + E5 small | 17 | 6 | 11 | 44 | 28 | 18.16ms | 933MB |
| Transformers + multilingual MiniLM NLI | 13 | 10 | 3 | 19 | 50 | 165.85ms | 716MB |

MiniLM was selected on development before the freeze. Its one-case gain missed the predeclared eight-case minimum. It was not integrated. V1 outcomes then became consumed development data for per-route calibration. A fresh independently authored v2 set was frozen before evaluation. The baseline satisfied22/64; calibrated MiniLM23/64 (English11 vs baseline12; Hebrew12 vs10), with nine forbidden predictions vs four. The improvement, absolute quality, language and forbidden-label gates failed. V2 is now consumed too.

Subsequent development-only exploration used136 consumed exemplars and calibrated on the consumed v2 corpus: MiniLM34/64, multilingual mDeBERTa26/64, Qwen3 embedding15/64. These are **not held-out results**. Larger models did not solve this task: mDeBERTa used1.72GB RSS/p95 2.36s; Qwen3 used3.03GB/p95 379ms/38.9s startup. Neither meets the original CPU resource gates. No GPU inference was configured; no local-model admission policy was changed.

The datasets have partial required/forbidden annotations and sparse coverage for some labels. They do not establish general multilingual accuracy. Before another promotion attempt, improve evaluation-reference coverage and evaluate a genuinely separate corpus. SetFit head training was considered and then cancelled by the owner clarification below; it is not an authorized next experiment.

Production worker failure handling, downstream individual-model selection, cross-platform measurements and real end-to-end task outcomes remain unverified for all candidates. No experiment report substitutes for those acceptance gates.

## Owner clarification: ready-made routing technology

The owner explicitly reiterated that the router must be an existing tool selected from the web, not Relay's own classifier. The proposed SetFit custom-head experiment is stopped before implementation or training. The attempted constrained dependency install failed without installing SetFit; no product dependency changed. Complete annotations of consumed examples may be retained only as comparison evidence for external pretrained candidates, never as an implicit authorization to train a Relay router.

Expand evaluation to [vLLM Semantic Router](https://github.com/vllm-project/semantic-router), its published pretrained models, [Arch-Router](https://huggingface.co/katanemo/Arch-Router-1.5B), and suitable released multilingual decision models. Integration/configuration and deterministic permission/resource enforcement remain Relay responsibilities. A provider gateway, tier-only classifier or domain label is not sufficient evidence of individual-model task quality. No winner is selected merely from reputation or vendor metrics.

Arch-Router's current card lists English and its documented interface selects one route from supplied descriptions. Its [April2026 license](https://huggingface.co/katanemo/Arch-Router-1.5B/blob/main/LICENSE) includes separate commercial licensing and attribution conditions; it must not be described as Apache/MIT or bundled without resolving suitability. [Raya](https://huggingface.co/TextCortex/raya) publishes CPU ONNX assets and multilingual tier routing, but its own stated scope is2–3tiers, not general multi-intent selection; Hebrew is absent from its reported14-language evaluation. These are shortlist limitations, not Relay measurements.

## Ready-made pretrained models: current evidence

The following are published weights used without training, fitted heads or few-shot examples. A thin benchmark adapter supplies the existing frozen label descriptions and reads vendor scores; it does not implement a new classifier. GLiClass and Vela use their own documented input formats and default thresholds, so this compares those configurations rather than establishing the best achievable model.

| Published candidate | Pinned revision | License and language evidence | Local integration |
| --- | --- | --- | --- |
| [knowledgator/gliclass-multilang-mini](https://huggingface.co/knowledgator/gliclass-multilang-mini/tree/0bd888b6c3ef9fca5f0a9d407bddfbbc7623486b), about 288M | `0bd888b6c3ef9fca5f0a9d407bddfbbc7623486b` | Apache-2.0; the [official multilingual documentation](https://docs.knowledgator.com/docs/models/text-classification/gliclass) explicitly includes Hebrew in training languages. This is not Hebrew task-accuracy acceptance. | GLiClass 0.1.20 multilabel pipeline; local safetensors, no remote model code; FP32 CPU; threshold `>= 0.5`. |
| [knowledgator/gliclass-multilang-edge](https://huggingface.co/knowledgator/gliclass-multilang-edge/tree/d16c08ef70547514081952104e6fc3d190d9ee39), about 140M | `d16c08ef70547514081952104e6fc3d190d9ee39` | Apache-2.0; same multilingual family. | Researched/provisionable alternative; no result in the table below. |
| [vllm-sr/Vela-2.0-0.3B](https://huggingface.co/vllm-sr/Vela-2.0-0.3B/tree/d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409) | `d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409` | Apache-2.0 contributions with inherited MIT notices and [Gemma tokenizer terms](https://huggingface.co/vllm-sr/Vela-2.0-0.3B/blob/d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409/DISTRIBUTION_TERMS.md). Hebrew is absent from the card's 17 listed languages. | Pinned upstream Python implementation, in-process FP32 ONNX CPU, native Set output and shipped strict `> 0.3` threshold; no HTTP server or remote-code autoloader. |

[vLLM Semantic Router v0.4.0](https://github.com/vllm-project/semantic-router/releases/tag/v0.4.0) is pinned to source commit `6573123715e214a9eaa3ad23372ee5157411e519`. Its Vela 1 Domain and older mmBERT "intent" heads classify fourteen subject domains, not Relay's overlapping task requirements. Vela 2 accepts supplied labels through its [Set interface](https://huggingface.co/vllm-sr/Vela-2.0-0.3B/blob/d6f03aa9baca4f9017fa8f8e9c2764d3bed3f409/USAGE.md); its standalone benchmark does not establish integration into that stable router release. The full router's [multi-factor selection](https://github.com/vllm-project/semantic-router/blob/v0.4.0/website/docs/tutorials/algorithm/selection/multi-factor.md) still depends on explicit model-quality evidence, costs and operational observations. A pretrained intent score does not establish individual downstream model quality.

### Actual Windows CPU runs, consumed v2 only

Reports: [GLiClass mini](../../benchmarks/semantic-routing/results/gliclass-mini-development.json) and [Vela](../../benchmarks/semantic-routing/results/vela-development.json). Runs were sequential, FP32 CPU, two threads, with unchanged descriptions and no training. Both processed all 64 cases without errors or truncation. Independent review recomputed selections, constraints and p95 from all 128 retained rows and verified evaluator/data/label/manifest hashes.

| Configuration | Satisfied /64 | EN /32 | HE /32 | Missing required | Forbidden predictions | Warm p95 | End RSS, decimal GB | Peak working set, decimal GB | Initialization |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Frozen phrase baseline on v2 | 22 | 12 | 10 | See retained v2 report | 4 | See retained v2 report | Not recorded | Not recorded | Not recorded |
| GLiClass mini, default 0.5 | 15 | 8 | 7 | 62 | 8 | 362.34 ms | 1.846 | 2.036 | 19.137 s |
| Vela 2, shipped Set 0.3 | 30 | 13 | 17 | 43 | 3 | 289.65 ms | 1.411 | 2.318 | 4.055 s |

Both miss the existing p95 gate of less than 250 ms. Mini also exceeds the 1.5 GiB end-RSS gate and regresses versus the baseline. Vela's end RSS passes that particular gate, but its higher peak must remain visible. Vela's 30/64 is below the v2 absolute quality gate of at least 65%; its eight-case gain on consumed data is not fresh acceptance. Neither default configuration qualifies for promotion. RSS is measured at the end of the run, not immediately after initialization; peak working set and initialization are separately recorded. Configured CPU execution is not an independently sampled VRAM measurement.

The new isolated environment is `output/pretrained-router-venv`; the original 82-package experiment environment remains preserved. Mini recorded GLiClass 0.1.20, Transformers 5.19.0 and Torch 2.14.1. Vela recorded NumPy 2.5.4, tokenizers 0.23.3 and ONNX Runtime 1.31.0. Native Windows CPU operation is measured for these adapters; macOS/Linux packaging and production-worker behavior are not verified. The subsequent GLiNER2.5 measurement is recorded below; no winner is selected.

## Evaluation references and the next sealed test

V4 annotations and adjudication cover consumed development material only. They are produced by AI reviewers, not human-validated ground truth. Their sole current purpose is evaluation of existing pretrained tools. The immutable v4 rubric retains historical "supervised head" wording; that wording does not override the owner's later prohibition on custom training. Preserve unresolved labels and excluded dispositions rather than converting them to negatives. Improved reference completeness cannot make consumed objectives unseen again.

A fresh sealed v5 corpus is being independently authored. The implementer must not inspect objectives or results before freezing the selected candidate, model/code/assets, descriptions, thresholds, input policy, evaluator and acceptance gates. No v5 outcome or unseen pass is claimed. Any later change prompted by its results consumes that test and requires another fresh corpus for an unseen claim. Ready-made model research, development scores and AI annotation agreement do not complete D07.

### Additional GLiNER2.5 measurement and development follow-up

[GLiNER2.5-multi-Decide](https://huggingface.co/fastino/GLiNER2.5-multi-Decide/tree/e173bca1f0c4217d7a55b3b0c705d5ece8a0218d), pin`e173bca1f0c4217d7a55b3b0c705d5ece8a0218d`, uses Apache-2.0 model/library terms and an MIT encoder. The shipped GLiNER2 2.1.0 `Classifier` independent decoder supports multilabel classification with `min_labels=0`; the older card API forces one label when none qualifies. The benchmark uses the former unchanged, two-thread CPU FP32, threshold0.5, frozen description strings and complete processor-token bounds. No examples, head training or custom decoding.

[Actual consumed-v2 report](../../benchmarks/semantic-routing/results/gliner-development.json):15/64 satisfied (EN11,HE4),69 missing required labels,one forbidden prediction,26 empty selections,zeroerrors. Initialization8.769s; p95333.21ms; endRSS1.895GB; peakWindowsworking-set3.178GB. This default also fails quality/latency/memory gates. Official Decide quality evidence is English-only; backbone multilingual pretraining is not Hebrew acceptance.

Post-hoc threshold sensitivity on the already consumed64cases is retained in `results/threshold-sensitivity-v4.jsonl`. Lowering Vela's threshold to0.05 yields40satisfied but eight forbidden predictions; this still misses the existing absolute-quality and forbidden-label gates. It is a development sensitivity check, not a selected threshold or unseen result. Supported request-schema/runtime configuration remains an allowed integration experiment; custom classifier training remains prohibited. Preserve the sealed test until a justified configuration is frozen.

The full v4 AI-reference merge retains200rows:141eligible,59excluded,54with unresolved labels,100conservatively linked families. Only one eligible debugging positive and zero security-review positives remain. Do not claim broad task coverage from that eligible subset or silently turn unresolved decisions into negatives. The standalone builder validates original hashes, all disputed decisions and unchanged agreements without depending on the ignored review packet.
