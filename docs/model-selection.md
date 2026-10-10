# Model and reasoning selection

Open **Choose model** beside the composer. The drawer groups installed local runtimes and the signed-in account's configured cloud connections. Select a provider, search its discovered models, then choose reasoning and apply. **Manage connections** opens the existing API-key/Google connection settings. Saving and verifying a connection refreshes its catalog. A ChatGPT or other chat subscription does not itself provide API credit.

Selection does not send a draft. Manual selection requires that exact model; Relay does not silently substitute another model if it becomes unavailable. Cloud selection requires an explicit sharing policy: ask before sending context, or allow it for the objective. Account provider grants remain mandatory. Cancelling leaves the previous settings and draft intact.

Reasoning controls are model and transport specific. **Auto** chooses an economical supported level; **Provider default** sends no explicit effort. Other choices appear only when provider metadata or exact documented model support establishes them. Unknown variants, numeric-only legacy Anthropic controls and Gemini 2.5 Google OAuth transport retain defaults. Local runtime thinking behavior remains under the existing runtime controls. A higher effort is not a spending limit or a promise of better results.

## Auto and token controls

Auto checks account/provider permissions, required model, cloud policy, tools, context, hardware and initial call cost before ranking. It identifies overlapping task requirements with an explainable keyword classifier; no classifier model call is added. Compatible existing fixed probes remain limited evidence. Otherwise capability hints, availability, comparable speed, local preference and known estimated cost inform ranking. Complex work may prefer an eligible cloud reasoner. Unpriced models are penalized rather than treated as free.

Simple work prefers off/minimal/low where supported. Complex work prefers low at the default allowance, or medium with at least 4,096 effective output tokens. Auto never explicitly selects high/maximum effort. If a model has no supported economical level, its default remains unknown and is disclosed. Auto does not increase the output limit. DeepSeek tool history missing original private reasoning switches Auto to supported reasoning-off before dispatch; an explicit incompatible setting stops before a call or cost reservation.

The default per-call output allowance is 2,048; the effective limit may be lower because of context or advertised model limits. Set output tokens, maximum calls and **Cloud cost cap (USD)** in Advanced. High-effort calls can use their allowance before producing a useful answer. Cost caps require known prices and reserve conservatively; uncapped unknown-price use follows the account's separate permission. Published rates expire and are rechecked after human approval, before each reservation. See [price evidence and limitations](provider-pricing.md). These are estimated safeguards, not a guarantee about the provider's invoice. Keep provider-side spending limits configured as appropriate.

Task activity records actual model, requested/effective effort, output allowance, and routing reasons. Open **Why this model** in execution details. Gemini thought-token usage is included in recorded output totals; incomplete responses retain reported usage. Private reasoning continuations are never exposed as user-facing explanations.

## Official contracts inspected on 10 October 2026

- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning) and [current model guidance](https://developers.openai.com/api/docs/guides/latest-model): effort support varies by model; reasoning can consume output capacity.
- [Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort), [model capabilities](https://platform.claude.com/docs/en/api/models/retrieve), and [extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking): adaptive and legacy numeric thinking are distinct contracts.
- [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking) and [GenerateContent thinking](https://ai.google.dev/gemini-api/docs/generate-content/thinking): Interactions and OAuth GenerateContent need different serialization and usage accounting.
- [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning): supported effort depends on the model. A combined hidden-reasoning/output billing ceiling has not been independently verified here.
- [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/) and [model discovery](https://api-docs.deepseek.com/api/list-models/): supported effort and continuation requirements are validated before dispatch.
- [Native dialogs](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog) and [radio keyboard behavior](https://www.w3.org/WAI/ARIA/apg/patterns/radio/): the drawer retains modal focus, Escape, native radio controls and responsive scrolling.

The maintained-routing comparison remains in [model-routing-comparison.md](model-routing-comparison.md). No semantic routing service or additional resident model was installed: no measured success gain currently justifies its resource cost.

## Verification limits

Deterministic provider-contract, routing, pricing, API and real-database Engine tests validate serialized settings, isolation/budgets, usage and no-call failures. Browser catalog fixtures validate the complete selection/submission UI without using keys or paid inference. Live provider billing/availability, physical mobile browsers and broad task-quality improvement remain unverified. Routing currently compares an initial call against the task cap; the transactional Store checks remaining task/account funds at dispatch. This can pause work even when another model might fit the remaining funds. A future remaining-budget-aware reranking should preserve that durable admission check.
