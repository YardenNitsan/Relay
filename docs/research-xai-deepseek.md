# Grok and DeepSeek provider integration

Research checked **9 October 2026** against official documentation. This extends Relay's existing provider gateway; it does not add another agent framework or proxy service.

## Decisions and sources

| Concern | Grok / xAI | DeepSeek |
| --- | --- | --- |
| Relay provider ID | `xai` | `deepseek` |
| Authentication | Backend Bearer API key | Backend Bearer API key |
| Discovery | `https://api.x.ai/v1/models` | `https://api.deepseek.com/models` |
| Generation | `POST /v1/responses` | `POST /chat/completions` |
| Streaming | Responses SSE events | Chat Completions SSE deltas |
| Private continuation | Native Responses output, including encrypted reasoning | Assistant `reasoning_content` alongside content and tool calls |
| Owner environment option | `XAI_API_KEY` | `DEEPSEEK_API_KEY` |

The [xAI model API](https://docs.x.ai/developers/rest-api-reference/inference/models) discovers models available to the authenticating key. The [DeepSeek model API](https://api-docs.deepseek.com/api/list-models/) supplies its available model IDs. Relay never creates available models from a hard-coded catalog. Disconnected providers are a normal state.

The [Grok 4.7 guide](https://docs.x.ai/developers/grok-4-7) identifies Responses as the supported API. Reusing an arbitrary Chat Completions adapter would miss that distinction. Relay shares the existing Responses normalization with OpenAI while preserving provider identity. System messages are sent in the xAI `input` array, using the documented format. `store:false` disables retrievable response storage; this is not a claim of zero provider retention under every policy. See [xAI text generation](https://docs.x.ai/developers/model-capabilities/text/generate-text).

The [xAI reasoning guide](https://docs.x.ai/developers/model-capabilities/text/reasoning) requires encrypted reasoning items to be returned unchanged for continuation. Relay requests those items and keeps them in backend-only provider context. Reasoning summaries/deltas are not emitted as visible answer text. Only broker-approved function definitions are submitted; provider-hosted search, code execution and multi-agent tools are not enabled.

DeepSeek's [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) exposes content, reasoning and function deltas separately. Its [thinking-mode guide](https://api-docs.deepseek.com/guides/thinking_mode/) requires reasoning replay for earlier assistant turns when tools are present, including turns without a tool call. Relay preserves this field privately, assembles fragmented function arguments, validates completion and allowed tool names, then returns proposals to the existing broker. It does not print reasoning in activity or final answers. Native continuation is never replayed to another provider.

DeepSeek's [current model details](https://api-docs.deepseek.com/quick_start/pricing/) list `deepseek-flash` and `deepseek-v4-pro`, alongside documented legacy aliases. Discovery determines which IDs this account can use. Model-specific context hints are dated documentation, not measurements. The adapter supports text and function calls; image uploads, JSON response-format controls and provider-specific reasoning controls are not exposed through Relay's current normalized request.

## Security and operational behavior

Saved credentials use the existing OS-backed, account-scoped SecretManager. Personal accounts cannot inherit the owner's environment credentials. API keys go only to fixed HTTPS provider origins. Redirects are rejected. No browser cookies, consumer subscriptions or Google account sessions are used as API credentials.

The existing user/provider grants, cloud-egress approval and spending policies apply. Unknown prices remain `null`, never zero. Hard monetary budgets reject unknown pricing. This integration does not claim live billing reconciliation or automatic pricing refresh; those require separate work. DeepSeek's peak/off-peak pricing and xAI's context-tier pricing make a single unqualified static price misleading.

Generation uses bounded SSE parsing, an abort signal, provider-disable cancellation, and a ten-minute transport deadline. Truncated or filtered DeepSeek completion cannot dispatch tool proposals. Upstream error bodies are not surfaced, preventing reflected credentials or context from becoming UI errors. Rate-limited discovery records an unavailable provider state. Requests are not automatically replayed after uncertain failures; existing supervisor rerouting remains authoritative.

## Verification and remaining acceptance

Deterministic provider tests cover authenticated discovery, no-key operation, personal credential isolation, fixed URLs, storage-disabled xAI requests, encrypted continuation, DeepSeek fragmented tools and private reasoning replay, incomplete streams, unavailable tools, cancellation and sanitized rate-limit failures. Existing OpenAI, Anthropic, Gemini and local provider tests remain part of the regression run.

Review added two compatibility safeguards: documented `grok-build-0.1` is tool-capable, and DeepSeek explicitly disables thinking for tool requests when earlier assistant history lacks native reasoning (for example, a saved conversation or a redacted proposal). Complete native continuation stays intact; no reasoning is fabricated. Four regressions failed before these corrections; the focused provider suite then passed 58 tests.

No live xAI or DeepSeek account was used during this change. Actual account model access, provider responses and billing must be verified after a user connects a supported API key. API availability does not follow automatically from a Grok or DeepSeek consumer subscription.
