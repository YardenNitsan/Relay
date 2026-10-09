# 0.1.1 — one host, personal accounts

The owner's PC executes all local inference and tools. Browsers are clients, including phones. Local operation remains independent of Internet availability.

## Decisions

1. Retain the separate loopback remote gateway and Cloudflare Access JWT verification. A named tunnel with an owner-controlled hostname preserves the address across Relay updates. Never publish port 4317 or model-runtime/database ports. Google is an Access identity provider, not a model API credential.
2. Resolve a user's intelligence pool from their persisted identity. Share local discovery and inference through the host scheduler; isolate cloud credentials, availability, enabled preferences and cancellation controllers per user. Never inherit owner environment credentials for a remote user. Existing owner credentials remain compatible.
3. Keep admission, workspace grants, quotas and egress authorization separate from authentication. New accounts receive no host control. An optional approval registration mode allows verified identities to request access, bounded to prevent unlimited account creation. Local owner administration stays protected.
4. Expose personal provider settings with truthful authentication guidance. Google login cannot be substituted for OpenAI/Anthropic API authentication. Gemini OAuth requires an application registration, consent and Cloud API configuration; it is not consumer Gemini subscription access.
5. Improve phone layouts, host/account identity, connection states and owner onboarding. Retain the same conversation/activity surfaces and large approval controls.

## Delivery sequence

- Add user-scoped secrets/gateway resolution and preferences; prove cross-user isolation with deterministic tests.
- Add bounded opt-in access requests and owner approval visibility.
- Integrate personal provider controls and responsive identity/setup surfaces.
- Document permanent hostname/Google identity setup and limitations; bump version.
- Run strict types, security/integration tests, build and browser checks; inspect phone and desktop screenshots, then restart the actual host.

## Research (9 October 2026)

- [Cloudflare Google identity integration](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Cloudflare Tunnel deployment](https://developers.cloudflare.com/tunnel/get-started/)
- [OpenAI API authentication](https://developers.openai.com/api/reference/overview)
- [Anthropic third-party authentication](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- [Gemini OAuth requirements](https://ai.google.dev/gemini-api/docs/oauth)

Live public acceptance depends on the owner's domain, Access application and tunnel configuration. Do not claim a public deployment, Google login acceptance or cloud inference until those have actually been exercised.
