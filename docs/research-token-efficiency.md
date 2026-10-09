# Token efficiency without sacrificing verified results

Research and source inspection: 9 October 2026. This document records evaluated options and recommendations, not implemented savings or measured quality improvements. There is no universal minimum-token strategy that guarantees the best answer.

## Baseline inspected before this update

Inspected `server/orchestration/context.ts`, `engine.ts`, `router.ts`, `receipts.ts`, and the provider adapters. Ordinary Balanced conversation uses one worker. Context includes bounded recent messages and same-conversation PostgreSQL retrieval, excludes the current task's duplicate conversation messages, and protects tool-call/receipt pairs, objective instructions and required review evidence. Large receipts preserve hashes and execution metadata. Task call/time/iteration/cost limits are enforced separately.

Current limitations matter more than adopting an orchestration framework:

- Context admission uses UTF-8 JSON bytes as a deliberately conservative token proxy. This can discard useful context much earlier than a model-specific tokenizer would require.
- Every role currently receives the same output ceiling: `min(2048, contextTokens / 3)`. A ceiling is not an instruction to consume that allowance. Lowering it alone does not necessarily save tokens and may truncate useful work.
- Routing checks availability, permissions, tools, context and hardware, then scores local/ready models, measured throughput and a penalty for mandatory-thinking variants. This is a suitability heuristic, not a measured quality ranking.
- Output-token reservation must agree with the actual provider request and context fit. Changing only one calculation can undermine cost limits.

## Existing tools evaluated

| Candidate | Verified license and function | Fit for Relay |
| --- | --- | --- |
| `js-tiktoken` | MIT; pure JavaScript OpenAI tokenizer port. Repository manifest currently shows 1.0.21. Lite imports allow selected bundled ranks. | Smallest useful dependency for known matching OpenAI encodings; backend only, offline bundled ranks. Not an accurate universal tokenizer for Qwen, Claude, Gemini, Grok or DeepSeek. |
| `tiktoken` JS/WASM | Same repository/license; WASM bindings and explicit encoder cleanup. | Viable after measuring speed/memory, but adds packaging requirements. Pure JS is simpler for this cross-platform service initially. |
| LiteLLM | MIT outside separately licensed `enterprise/`; provider gateway and load-balancing/routing strategies. | Valuable if a future deployment needs many provider deployments or a dedicated gateway. Today it duplicates Relay's per-account credentials, budgets and adapter layer and adds another service/runtime. Its deployment routing does not establish task-answer quality. |
| RouteLLM | Apache-2.0; trained strong/weak model routing and evaluation. | Requires representative calibration. Current documented `mf` and `sw_ranking` setups require OpenAI embeddings even with local model endpoints; that default conflicts with offline local-first operation. Do not insert it into every request without a fully local configuration and measured benefit. |
| Microsoft LLMLingua | MIT; model-based prompt compression. | Extra model/runtime/resource load and lossy context transformation. A research candidate for large retrieved documents, not for code, exact hashes, authorization, tool arguments, or verification evidence. No automatic adoption. |

Primary sources: [js-tiktoken manifest](https://raw.githubusercontent.com/dqbd/tiktoken/main/js/package.json), [MIT license](https://raw.githubusercontent.com/dqbd/tiktoken/main/LICENSE), [lite usage](https://raw.githubusercontent.com/dqbd/tiktoken/main/js/README.md), [WASM implementation](https://github.com/dqbd/tiktoken), [LiteLLM routing](https://docs.litellm.ai/docs/routing), [LiteLLM license split](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE), [RouteLLM usage/calibration](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/README.md), [RouteLLM license](https://raw.githubusercontent.com/lm-sys/RouteLLM/main/LICENSE), [LLMLingua](https://github.com/microsoft/LLMLingua), [LLMLingua license](https://raw.githubusercontent.com/microsoft/LLMLingua/main/LICENSE).

## Token accounting and privacy

Use a provenance-bearing count: `provider_reported`, `matching_tokenizer_estimate`, or `conservative_estimate`. Text tokenization does not automatically include provider chat templates, tool schemas, hidden framing or images. Unknown models must retain conservative admission; never treat every model as `o200k_base`.

For a future `js-tiktoken` integration, pin the audited package, load only known ranks on the server, cache bounded encoder instances, and encode literal special-token-looking user strings as ordinary text. Its API supports explicit allowed/disallowed special-token lists. Do not fetch tokenizer ranks from a CDN during ordinary local operation. [Implementation](https://raw.githubusercontent.com/dqbd/tiktoken/main/js/src/core.ts)

Claude has a structured token-count endpoint, whose result remains an estimate; Gemini also provides `countTokens`. Both require sending the content to a provider. Therefore counting must occur **after** cloud-egress authorization, not during speculative local model selection. Avoid adding a network preflight to every tiny request. [Claude](https://platform.claude.com/docs/en/build-with-claude/token-counting), [Gemini](https://ai.google.dev/gemini-api/docs/tokens)

Ollama reports actual prompt/generation counts and timings. Store these for measurement; do not claim a statistical bytes/token ratio is a hard bound for arbitrary new documents. OpenAI prompt caching can reduce repeated-prefix processing cost; it is different from shortening context. Keep stable instructions before changing task data, record reported cached usage, and never share private context between users to improve cache hits. [Ollama](https://docs.ollama.com/api/chat), [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching)

## Recommended bounded implementation

1. Introduce one deterministic call-budget function used by context fitting, provider requests and cost reservation. Respect model-specific output limits when known; keep unknown limits explicit. Start with the current worker allowance rather than silently reducing answer quality.
2. Make planner/reviewer instructions concise and structured. Evaluate smaller role ceilings with multilingual reasoning/tool tasks before defaulting to them. Detect length termination; never mark a truncated response or incomplete tool proposal as completed, and never retry indefinitely.
3. Keep exact objective, security instructions, current candidate, failed checks, tool hashes and call/receipt correspondence. Deduplicate only exact optional context. Do not summarize away evidence or reuse stale file-read results after mutation.
4. Compare candidate policies on deterministic task outcomes, completion rate, real checks passed, retries, actual token counts and latency. Include short chat, long explanation, multilingual text, code repair, stale-file conflict and tool-heavy tasks. Add live calibration only with explicit model availability and budgets.
5. Adopt a matching tokenizer when the measured context-retention benefit justifies the dependency. Keep the interface ready for runtime-specific local tokenization. Defer learned routing/compression until Relay has representative per-model quality evidence.

User-facing reporting should describe actual usage and the selected policy. It must not advertise guaranteed optimal quality, fictitious savings, or inferred remaining subscription tokens.

## Implemented bounded policy

The composer now offers **Token efficiency**: Efficient (default) or Standard, plus **Maximum output tokens per model call** (256–8192, default 2048). For example, choose Standard and 1024 to retain the previous broad tool definitions while setting a smaller per-call ceiling. This is an output allowance, not remaining account credit. Neither choice changes the selected depth or removes review/verification requirements.

Efficient adds concise-but-complete response instructions and removes known forbidden file-mutation/terminal schemas from read-only calls. The broker still enforces permissions independently. Required objectives, review candidates, evidence and tool receipts retain their existing context protections. No learned router or lossy compressor was installed.

One call-budget policy now supplies the same output ceiling to context fitting, the provider request and conservative cloud reservation. It clamps the requested allowance to one third of the selected context and to a positive integer provider-advertised output limit when available. Unknown limits stay unknown. `CALL_BUDGET` activity reports the actual applied ceiling, UTF-8 sizing method, removed tool count and serialized tool-schema bytes removed; these bytes are not claimed token savings.

Recognized output-limit termination preserves reported usage, rejects partial tool proposals and pauses the task without immediately repeating the same constrained request on another model. Start a new task with a larger allowance or narrower objective. Missing/incomplete provider terminal records also fail closed. Failed cloud calls retain conservative reservation accounting until settled; a partial answer is never marked complete. These changes have deterministic tests, not a measured percentage improvement in answer quality or token consumption.
