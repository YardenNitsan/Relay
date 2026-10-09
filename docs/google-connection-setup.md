# Google account connection: owner setup

Relay implements a **Connect Google** flow for Gemini using Google's supported OAuth and GenerateContent APIs. The host owner must configure an application before users can connect. Automated protocol and browser tests cover this flow; a live Google registration, consent and Gemini quota check remain required on a new host. Other providers retain their supported API connections.

## What users do

Open **Models & providers → Gemini → Connect Google**, choose an account and consent. You register the Relay application once; ordinary users do not create their own OAuth application or paste your client secret. Google consent alone does not guarantee model availability: verify the connection and check the chosen project's API permissions and quota.

Google login does not grant access to another company's model subscription. A Relay login, a Gemini API authorization, Gmail consent and Google Calendar consent are separate grants. Keep their scopes and disconnect controls separate.

## Prepare the application once

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project named **Relay**. Record its **Project ID**, not just its display name. It is not a secret.
2. In **APIs & Services → Library**, enable **Generative Language API**.
3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview). Configure **Relay** as the app name, select a support/developer email, and choose **External** for invited users outside a single Workspace organization.
4. Keep the application in **Testing** initially. Add your account and each participating account to **Audience → Test users**. Testing restrictions and token expiry still apply; this is not production verification.
5. Do not enable paid billing just to complete these preparation steps. Eligibility and the available free API quota must be checked for the actual project/model before use. Free quota is not unlimited.
6. Create a **Web application** OAuth client. Open Relay locally as the owner, then **Models & providers → Gemini**. Copy the exact redirect URIs shown in application setup into Google's **Authorized redirect URIs**. For the current host these include `http://127.0.0.1:4317/?relay_google=1` and `https://relay-host.yarden-relay.workers.dev/?relay_google=1`. Register `http://localhost:4317/?relay_google=1` too only if using that browser origin. Raw LAN IP callbacks are not supported; users can use the protected public URL while on the LAN.
7. In Relay's Google application setup, enter **Client ID**, **Client secret** and **Project ID**, acknowledge the shared quota/billing boundary, then save. The backend stores the secret in the OS keyring; it is never returned to the browser or stored as a plaintext database field. Do not send the secret in chat.
8. Grant explicitly invited test users the necessary **Service Usage Consumer** permission on this project, then have each user connect their own Google account. Keep Relay's provider grants and spending ceilings restrictive. A successful connection replaces that user's earlier Gemini API key; disconnecting Google does not silently revive the old key.

The consent uses OpenID identity and the documented Generative Language scope. Gmail and Calendar scopes are not requested. Relay binds the PKCE exchange to the current user/session, validates Google's signed identity token and stores each refresh token separately. Changing the application configuration requires users to reconnect. Google Testing mode and revoked/expired grants can also require renewed consent.

Before public production use, Google's verification may require an app homepage, privacy policy, justified scopes and proof of domain ownership. A Cloudflare URL by itself does not satisfy every Google verification requirement. Validate the actual hostname/consent configuration rather than promising that a shared hosting suffix will pass.

## Quota and billing are a separate choice

OAuth identifies the consenting user, but Gemini API requests need an authorized Cloud quota project. A shared project means **shared project quota and, if enabled, shared billing**; it does not consume each user's personal Gemini subscription. Users must have the required `serviceusage.services.use` permission on the chosen quota project. Grant only the necessary role to explicitly invited identities; do not add everyone as project editors or owners.

If every user must pay through their own API project instead, each user needs that project and permission. There is no supported promise of both arbitrary consumer-account sign-in and automatic separate subscription billing for this API integration. Relay must display the chosen project and enforce host quotas before accepting usage.

## Other model providers

| Provider | Keyless connection status |
| --- | --- |
| OpenAI | Official Sign in with ChatGPT exists for eligible local/open-source apps; Relay needs a separate adapter and a resolved shared-host/callback design. This is not a generic Google OAuth grant. |
| Anthropic | Consumer Claude login cannot be repackaged as third-party API authorization. Keep API access separate from native Claude Code. |
| xAI / DeepSeek | Public APIs examined use API keys; a supported general third-party consumer OAuth grant has not been established. |

See [provider sign-in research](research-provider-signin.md) for the exact official interfaces and limitations. No consumer cookies, copied first-party OAuth client identities or undocumented subscription endpoints should be used.

## Sources

- [Gemini OAuth setup](https://ai.google.dev/gemini-api/docs/oauth)
- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Quota project permissions](https://docs.cloud.google.com/docs/quotas/set-quota-project)
- [OAuth production compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
