# Token usage and remaining limits

Open **Usage** from the desktop header, phone navigation, or command palette. It opens a side drawer on desktop and a full-screen sheet on a narrow device. Conversation space remains uncluttered when it is closed.

## What the numbers mean

- **Reported tokens:** actual input/output counts returned by providers and recorded on this host for the signed-in account today, from 00:00 UTC until the report time. Both in-app tasks and external-client inference metadata count; external chat content is not retained.
- **Requests:** recorded model calls, including failed or unfinished calls. Missing token reports are labelled partial; they are not treated as measured zero consumption.
- **Last observed rate limits:** selected documented OpenAI and Anthropic response headers, including remaining tokens or requests and reset information when supplied. These values can apply to shared provider buckets across models or other applications. The observation timestamp matters; the drawer does not claim a live credit balance or infer refills.
- **Remaining tokens not reported:** the provider has not exposed a supported remaining-token measurement to Relay. This applies to an unobserved cloud model and currently to Gemini, Grok and DeepSeek. Their recorded input/output counts still appear.
- **Local models:** no prepaid token balance. Hardware, context and host scheduling limits still apply.

API billing credits, consumer subscription allowances, context-window capacity and rate-limit capacity are different things. The panel does not convert between them or scrape consumer sessions. A connected ChatGPT/Claude/Grok consumer subscription is not an API credential.

## Scope and freshness

`GET /api/usage` derives the account from the authenticated session; an account ID supplied by a client cannot change its scope. Records and model catalog entries are filtered by that account's provider grants. A model used today can still appear after runtime discovery stops reporting it. Its presence is historical usage, not a claim that it is available to run.

The drawer refreshes every 15 seconds only while open. Refresh reads stored usage and ordinary cached discovery; it does not generate paid probe completions. Rate observations are held in the account's provider gateway, bounded to 500 models, and cleared on credential changes, provider disable, revocation or host restart. Persisted usage remains after restart. At most 1,000 model rows are returned; truncated reports are labelled partial.

No API keys, prompt text, private reasoning or tool results are included in the report. Strict money budgets still refuse unknown model prices; remaining rate capacity does not authorize spending.

## Sources and validation

Header formats were checked against [OpenAI rate limits](https://developers.openai.com/api/docs/guides/rate-limits) and [Anthropic rate limits](https://platform.claude.com/docs/en/api/rate-limits) on 9 October 2026. Anthropic token headers may be rounded. Other provider limit APIs are not assumed compatible.

Deterministic tests cover account isolation, UTC bounds, missing measurements, malformed rate headers, credential-change clearing, failed-call observations and HTTP session revocation. Browser coverage exercises phone/desktop layout, keyboard focus, accessibility, unknown values, partial totals, errors and retry. Live cloud quota reconciliation still requires a connected provider account.
