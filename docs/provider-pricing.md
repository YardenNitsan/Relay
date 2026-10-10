# Published provider price estimates

Checked 10 October 2026. `server/providers/pricing.ts` enriches models already discovered for the signed-in account. It does not discover models, grant access, connect providers, or send an inference request. The exact provider-qualified ID must match; unknown snapshots and family variants retain unknown prices.

`enrichPricing(model, now = Date.now())` runs on every catalog read, including cached discovery, and again after human approval immediately before each call reservation. The call keeps that price snapshot for settlement. Published evidence expires at **2026-11-09 00:00 UTC**. Before the check date or after expiry, these published fields become null. Existing finite nonnegative provider metadata remains authoritative for its individual field, including zero. Malformed cloud rates become null. Re-enrichment tracks which fields came from this table so they cannot survive expiry as apparent provider metadata.

The metadata records source URL, checked/expiry timestamps, USD per-million-token units, conservative basis, and a standard-text scope up to Relay's 131,072-token context ceiling. These values are **estimates**, including when used to settle recorded task costs; they are not a provider invoice. Reasoning output must be included in the provider's output usage. Output ceilings, call limits and task financial reservations remain independent safeguards. Token estimation and uncertain interrupted calls can still differ from billing.

## Included evidence

| Exact API model ID | Estimated input / output USD per million | Official source |
| --- | --- | --- |
| `gpt-6-astra` | 12.50 / 50 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6-astra) |
| `gpt-6.1-sol` | 2.50 / 10 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6.1-sol) |
| `gpt-6-sol` | 2.50 / 10 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6-sol) |
| `gpt-6-luna` | 0.125 / 0.50 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-6-luna) |
| `gpt-5.4` | 2.50 / 15 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5.4) |
| `gpt-5-mini` | 0.25 / 2 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-5-mini) |
| `gpt-4.1-mini` | 0.40 / 1.60 | [OpenAI model](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |
| `claude-sonnet-5-5` | 2 / 10 | [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) |
| `claude-haiku-5-5` | 0.50 / 2.50 | [Haiku model and prompt tiers](https://platform.claude.com/docs/en/models/haiku-5-5/overview) |
| `gemini-3.6-flash` | 0.75 / 3.75 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini-3.5-flash-lite` | 0.30 / 2.50 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini-3.1-flash-lite` | 0.25 / 1.50 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini-2.5-flash` | 0.30 / 2.50 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `gemini-2.5-flash-lite` | 0.10 / 0.40 | [Google pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| `grok-4.7` | 2 / 6 | [xAI model pricing](https://docs.x.ai/developers/models) |
| `deepseek-flash` | 0.30 / 1.20 | [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) |
| `deepseek-v4-pro` | 1.32 / 3.96 | [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/) |

GPT-6 input estimates use the documented cache-write rate (1.25 times ordinary input), covering that category conservatively without assuming a cache hit. Haiku uses the higher prompt-length tier even for short prompts. DeepSeek uses peak cache-miss rates rather than depending on calendar/time discounts. Gemini 3.6 Flash's currently published introductory rate ends after this evidence expires. These deliberate upper estimates can overstate ordinary charges.

The current adapters do not request explicit cache retention/writes, premium service tiers, regional inference, provider-hosted tools, or non-text modalities. Adding any of those requires reviewing pricing and usage accounting first. A customer account with special billing terms can differ. Google free-tier eligibility is not inferred from a key, and cache discounts are not assumed. No automated web scraping silently refreshes trusted prices; future updates must recheck exact IDs, scope and source evidence, then update timestamps and tests.

## Verification

`npm.cmd test -- tests/model-pricing.test.ts` covers all five cloud provider families, exact-ID matching, unknown snapshots, immutable profile enrichment, metadata precedence, invalid numbers, repeated enrichment after expiry, future/invalid clocks and conservative tier selection. These are deterministic tests of pricing evidence; they do not establish live availability or billing acceptance.
