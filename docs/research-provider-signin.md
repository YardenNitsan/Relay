# Provider sign-in and delegated model access

Research checked against official documentation on 9 October 2026. This is a feasibility report, not an implemented OAuth feature or a live authentication acceptance result.

Signing in to Relay with Google establishes a Relay identity. It does not grant access to every cloud model account associated with that email. Model access needs a separate provider authorization and billing entitlement. Keep those connections owned by the authenticated Relay user; never fall back to the host owner's credentials.

| Provider | Official alternative to entering an API key | Practical boundary for Relay |
| --- | --- | --- |
| OpenAI | ChatGPT-plan OAuth for eligible open-source/local applications; enterprise workload federation separately | A real documented route exists, but needs a separate adapter and eligibility review for shared remote hosting. |
| Google Gemini | Google OAuth with a Cloud project and enabled API | Feasible with a registered OAuth application, consent, explicit quota project and refresh-token handling. |
| Anthropic | API workload federation; native Console CLI browser authentication | Consumer Claude subscription login cannot be offered inside Relay as a model connector. |
| Grok / xAI | Native Grok Build sign-in exists | Public inference documentation specifies API keys; no general third-party consumer OAuth inference grant was established. |
| DeepSeek | None established in the public API documentation examined | Continue using the user's DeepSeek API key. |

## OpenAI: supported ChatGPT-plan OAuth now exists

OpenAI documents an optional Sign in with ChatGPT capability for open-source/local apps that permits eligible Responses requests against the user's plan. This grants no ChatGPT conversation history. Paid or remotely hosted applications are directed to an interest process. The generic commercial client-ID page also describes partner access; it must not be mistaken for a prohibition on the separately documented dynamic OSS registration. Relay currently has `private: true` in `package.json` and no root LICENSE file; those observations alone do not establish eligibility. Confirm the intended distribution/hosting category before promising deployment to other users. [Plan-usage overview](https://developers.openai.com/siwc/token-sharing-open-source), [Commercial client registration](https://developers.openai.com/siwc/request-client-id).

The documented first-registration identifier is `dynamic_agent_client`; it is not a borrowed first-party client ID. Registration uses Relay's actual name, a stable opaque host ID, random state/nonce and PKCE S256. OpenAI returns an issued client ID bound to the user/workspace; save that ID for exchanges and later sign-ins. Required plan scopes include `offline_access`, `resource.invoke`, and `chatgpt.tokens.use.direct`, alongside OIDC identity scopes. Validate the ID token and actual granted scopes. The callback is HTTP on `127.0.0.1`, with an exact callback path and per-attempt URI. No client secret or partner API key is needed for this direct flow. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

Use the authorized account's model catalog from public `/v1/models` and inference at public `/v1/responses`. This flow returns a `models` array with slugs/display names, unlike Relay's API-key discovery parser. Never substitute consumer `backend-api` URLs. [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference).

This is not a credential-only change: the preview requires streamed, unstored requests and disallows `max_output_tokens`; function/custom tools need namespaces or `additional_tools`. Relay currently sends an output-token cap and ordinary top-level function definitions. A new auth-mode-specific request builder and admission policy are needed. A strict output-token reservation cannot be claimed enforceable merely by aborting after locally counted output. [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

A browser on another LAN computer sends `127.0.0.1` callbacks to that computer. OpenAI's self-hosted VM procedure completes OAuth locally and securely transfers the selected registration to the user's remote runtime, preserving the remote host ID. It does not establish a turnkey multi-user commercial relay permission. A LAN flow would need a trusted client helper or an appropriate approved hosted integration, not a callback changed to the server's private IP. Host-specific revocation of transferred sessions is not yet available. [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

Store registrations separately by verified identity and issued client ID, scoped beneath the Relay user. Serialize refresh-token rotation and revoke renewable sessions on disconnect. Keep tokens out of browser storage and logs. Model plan usage belongs to the connected account, and the provider's settings remain the authority for app limits. [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

Ordinary OpenAI API access separately supports API keys or workload-federated short-lived tokens. Federation needs an administrator-configured trusted identity provider, a mapping and an API project service account; it is not consumer Google sign-in that automatically unlocks OpenAI billing. [API authentication](https://developers.openai.com/api/reference/overview), [Workload identity federation](https://developers.openai.com/api/docs/guides/workload-identity-federation).

## Gemini: Google OAuth, with explicit project ownership

Google's Gemini API OAuth guide establishes the supported alternative: a Cloud project, enabled Generative Language API, configured OAuth consent screen, and a registered OAuth client. Its desktop example uses the user's consent and refreshable credentials, then sends `Authorization: Bearer` with `x-goog-user-project`. The guide's broad example scopes include `cloud-platform` and `generative-language.retriever`; a production integration must verify the least scopes its chosen inference surface needs. The quickstart demonstrates models access, not acceptance of Relay's entire Interactions adapter. [Gemini OAuth quickstart](https://ai.google.dev/gemini-api/docs/oauth).

The user must be authorized to charge/use the selected quota project; `serviceusage.services.use`, included in Service Usage Consumer, is required. Never silently choose the Relay owner's ADC file or billing project. [Quota project permissions](https://docs.cloud.google.com/docs/quotas/set-quota-project).

API usage follows project/billing-account tiers. There is a free tier for eligible models; paid access requires project billing and may require prepayment. OAuth does not remove these requirements. Treat consumer subscriptions and any promotional credits according to their actual API billing eligibility rather than assuming unlimited model access from a Google login. [Gemini billing](https://ai.google.dev/gemini-api/docs/billing).

For a browser-based multi-user connection, register a Web application client, keep its secret on the backend, and configure an exact authorized HTTPS callback. Google disallows raw-IP redirect hosts except loopback. A private LAN IP with a self-signed certificate is therefore not a general Google OAuth callback. Use an owned HTTPS hostname or a supported desktop helper/loopback flow. Production consent/scopes and verification requirements must be satisfied for the intended audience. [Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server).

Gemini CLI's native Google login is a separate documented option for users running that CLI. Most personal accounts can use it without selecting a Cloud project, while organization and some licensed accounts need one. These CLI instructions do not authorize Relay to borrow its OAuth client ID or impersonate its backend. Running the genuine CLI is a different integration from Relay's Gemini API adapter. [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/).

## Anthropic: separate native subscriptions from API authorization

Anthropic explicitly prohibits third-party applications from offering Claude.ai login or routing through users' Free/Pro/Max credentials, and from collecting/intermediating those session credentials. It separately permits hosting the unmodified Claude Code binary under stated commercial conditions, where each user authenticates through its own native flow and pays for their usage. That is a native-agent hosting design, not permission to extract its token into Relay's model adapter. [Claude Code authentication and credential conditions](https://code.claude.com/docs/en/legal-and-compliance).

The Claude API supports API keys, workload federation, and App Attest. Federation requires a service account, trusted issuer and rule; App Attest is for registered iOS/macOS apps and is not an ordinary web-server Google-login flow. [Claude API authentication](https://platform.claude.com/docs/en/manage-claude/authentication).

The official `ant` CLI additionally supports browser OAuth to the **Claude Console** with `ant auth login`. This provides genuine key-free API use through that native client, distinct from consumer subscriptions. The examined documentation does not establish a public Relay OAuth client registration flow; do not reuse the CLI's identity or import its protected token store as an assumed entitlement. [Console CLI quickstart](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart).

## Grok and DeepSeek

xAI's public inference reference specifies bearer API keys created in its Console. Grok Build enterprise documentation also describes native OAuth/OIDC and an inference proxy, but does not establish a general third-party consumer OAuth grant for Relay's public Responses adapter. Preserve API-key connection unless xAI supplies a supported application-specific agreement/flow. [xAI inference authentication](https://docs.x.ai/developers/rest-api-reference/inference), [Grok Build enterprise authentication](https://docs.x.ai/build/enterprise).

DeepSeek's API reference requires creating an API key and using bearer authentication. No public delegated consumer-account inference OAuth flow was established from the official documentation examined. A Google button on a provider's own website is not evidence of an API delegation grant. [DeepSeek API authentication](https://api-docs.deepseek.com/api/deepseek-api/).

## Achievable Relay product flow

The following is a proposed implementation direction, not verified functionality:

1. Keep **Sign in to Relay** independent from **Connect a model account**. A Relay Google session grants only the permissions assigned by the host owner.
2. Offer **Connect Google Cloud for Gemini** after configuring the app's valid OAuth client/callback. Show the connected identity, user-selected quota project and billing tier; verify model access before marking ready. Store each user's refresh token privately and support revocation.
3. Investigate **Continue with ChatGPT** for eligible local deployments using the documented dynamic registration. Resolve shared-host eligibility and callback topology first, then implement its separate catalog, protocol restrictions, rotating credentials and plan-limit handling.
4. Keep personal API-key connections for Anthropic, xAI and DeepSeek. Enterprise federation or genuine native-agent integrations are separate options with their own prerequisites, not generic Google-login buttons.
5. LAN coding clients using host-local models need only their own scoped Relay inference token and allowed local models. They need no cloud-provider login. Credential connections must never expand local file/tool grants or external-client capabilities.

Before any OAuth implementation is considered complete, verify two different users, account switching, consent denial, token refresh, disconnect/revocation, cloud-project isolation and a real model/tool round trip. Do not describe provider sign-in as available merely because the documentation or UI exists.
