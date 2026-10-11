# Pretrained router replacement, 0.1.3

Status: two frozen quality gates failed; no candidate promoted. D07 remains incomplete.

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

The datasets have partial required/forbidden annotations and sparse coverage for some labels. They do not establish general multilingual accuracy. Before another promotion attempt, improve annotation coverage and evaluate a genuinely separate corpus. [SetFit](https://github.com/huggingface/setfit) is a maintained existing classifier framework worth evaluating with a pretrained multilingual encoder and a small classification head; its [multilabel support](https://github.com/huggingface/setfit/blob/main/docs/source/en/how_to/multilabel.mdx) needs fully specified labels, which these partial annotations do not provide. It is researched, not implemented or selected.

Production worker failure handling, downstream individual-model selection, cross-platform measurements and real end-to-end task outcomes remain unverified for all candidates. No experiment report substitutes for those acceptance gates.
