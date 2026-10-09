# Gmail and Google Calendar agents

Research: 9 October 2026. Status: implementation plan. This document does not establish a working Google connection, completed consent verification, or successful Gmail/Calendar API execution. No Google credentials or live mailbox data were used for this research. Assistant roles alone do not provide account access.

## Product boundary

Implement two first integrations: a mail assistant that searches selected mail and prepares replies, and a calendar assistant that inspects a bounded time window and proposes events. Start with reads and local proposals. Saving a Gmail draft, sending mail, and creating or changing an event are separate externally visible actions with exact approval. Account consent does not itself approve these actions.

Each Relay user connects their own Google account. Host ownership permits configuring the OAuth application, but does not grant access to another user's mailbox or calendar. Google login through Cloudflare authenticates access to Relay; connector consent authorizes specific Google APIs. Neither supplies OpenAI, Anthropic, or Gemini API access. Keep identity, connectors, and AI-provider configuration separate.

Use a verified Google OpenID Connect `sub` as the connected account identifier; show an email address only as a label. Verify issuer, audience, expiry and nonce server-side. A changed email must not remap an account. Request `openid email` when establishing this connector identity, without unnecessary profile access. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

## Minimal scopes and staged release

The table uses suffixes under `https://www.googleapis.com/auth/` except `openid email`.

| Feature | Proposed scope | Scope boundary |
| --- | --- | --- |
| Gmail search and selected message summaries | `gmail.readonly` | Restricted; no mailbox mutations. |
| Optional headers-only inspection | `gmail.metadata` | Restricted; no bodies. This is not the default summary mode. |
| Prepare reply text inside Relay | No additional Gmail scope | A local proposal, not a saved Gmail draft. |
| Save/manage Gmail drafts | `gmail.compose` | Restricted; also permits sending at Google. Relay must independently block unapproved sends. |
| A standalone send-only feature | `gmail.send` | Sensitive; suitable when mailbox reading/draft management are unnecessary. |
| Read events on owned calendars | `calendar.events.owned.readonly` | Initial calendar read scope. |
| Show a calendar picker | `calendar.calendarlist.readonly` | Request separately when needed. |
| Availability only | `calendar.freebusy` | Prefer for scheduling that does not need event details. |
| Create a dedicated assistant calendar and events there | `calendar.app.created` | Preferred initial calendar mutation option. |
| Write to existing owned calendars | `calendar.events.owned` | Optional explicit expansion. |

Gmail has no draft-only scope. Do not request `gmail.modify`, full-mail access, or add-on-specific current-message scopes for this ordinary browser application. [Gmail scope definitions](https://developers.google.com/workspace/gmail/api/auth/scopes)

Shared-calendar support can later request `calendar.events.readonly` or `calendar.events` when the user actually needs it. Avoid calendar ACL, sharing and deletion authority for these assistants. Confirm Calendar scope sensitivity in the project's current Google Auth Platform Data Access screen; its API scope reference does not classify every scope. [Calendar scope definitions](https://developers.google.com/workspace/calendar/api/auth)

For Gmail, use `users/me`, bounded searches, at most 25 message IDs per initial page, and explicit follow-up fetches for selected messages. The list endpoint does not return complete messages. Its `q` search is unavailable under `gmail.metadata`, so that scope cannot implement ordinary content search and summaries. [Gmail message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)

Proposed rollout:

1. Connect/disconnect and display the actual account, granted scopes and token state. Implement bounded Gmail/calendar reads; keep reply/event proposals local.
2. Add an optional Google draft-saving action with a complete preview. Continue distinguishing a saved draft from a sent message.
3. Add event creation in an app-created secondary calendar, initially without attendees. Add owned-calendar changes only after conditional-write tests.
4. Add separately approved sending, attendee invitations and event updates. Do not add bulk mailbox deletion, calendar sharing, domain-wide delegation or arbitrary Google API calls in this release.

## OAuth transaction and strict-cookie design

Use a confidential Web application OAuth client for the multi-user host. Keep its client secret in the host vault. Redirect URIs must be registered exactly; use fixed configuration, never an incoming Host header. Request offline access and incremental authorization as needed, and inspect actual granted scopes after consent. Missing permissions disable only the corresponding feature. [Google server authorization flow](https://developers.google.com/identity/protocols/oauth2/web-server)

Use the maintained `google-auth-library` package, pinning its version when implementing. Its source moved into Google's `google-cloud-node-core` monorepo; do not treat the archived standalone repository as the maintained release source. Use its OAuth/token verification facilities rather than custom token cryptography. [Current Google Node authentication library](https://github.com/googleapis/google-cloud-node-core/tree/main/packages/google-auth-library-nodejs)

Proposed transaction:

1. An authenticated, CSRF-protected POST starts authorization for the current Relay user and requested feature. Bind a 32-byte random state to the user ID, session ID/version, connector revision, exact origin and optional verified Cloudflare subject. Store only its hash for lookup. Keep the PKCE verifier, nonce and transaction details in a bounded private pending store, with a five-minute expiry and per-user/global limits.
2. Send an S256 PKCE challenge and OIDC nonce with the authorization request. The confidential client secret remains an additional server credential. Prove with the configured Google client that a missing/wrong verifier fails before shipping; do not silently downgrade. PKCE is recommended for confidential clients in the OAuth security BCP; Google's installed-app guidance explicitly documents it. [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html), [Google installed-app authorization](https://developers.google.com/identity/protocols/oauth2/native-app)
3. Add one exact callback GET path to the request boundary. Accept only bounded expected parameters, consume state once, and hold the returned code privately without exchanging it yet. Reject unknown, expired, replayed or ambiguous parameters. Return a fixed redirect to a same-origin completion page without the code or state in its URL. Use no-store, no-referrer responses and no third-party assets or query logging on this route.
4. That page performs a first-party CSRF-protected POST. Require the original live session/user/version and connector revision before exchanging the code. If remote, also require the same verified Cloudflare identity. Recheck all bindings after asynchronous token/vault work before saving; a concurrent disconnect or account disable wins. Clear pending secrets on every terminal path.
5. Verify OIDC identity and actual scopes, save the connection, and display the connected account. This flow must never create a Relay owner session or change platform permissions.

Relay's strict SameSite cookie is absent on an initial cross-site callback. Therefore the callback must not assume the cookie is present or weaken all API cookies to accommodate Google. The first-party completion step above needs real-browser validation: if a browser still withholds the original cookie, leave the connection pending and require reopening Relay to finish, rather than minting a new authorized session. [Browser SameSite behavior](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)

The callback exception permits only this navigation; normal Origin, Host, CSRF and authorization checks remain. On a public browser hostname, Cloudflare's human Access identity remains required. Google redirects the user's browser, so this is not a reason to bypass Access for all callbacks. Test Access reauthentication during the OAuth round trip. Never mount connector callbacks on the service-token inference gateway.

Google's Web-client redirect rules reject non-loopback raw IP hosts. A private LAN address such as `https://192.168.1.20:4319` is therefore not a valid production callback choice. Use an owned DNS HTTPS origin, which may resolve privately, or the configured public browser origin. A host-local loopback callback is an explicit local option; a phone's localhost is the phone, not the host. A Desktop-client loopback flow would need its own separately tested implementation. [Redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)

## Per-user secrets, lifecycle and data ownership

Create a connector secret namespace separate from cloud model providers, keyed by durable Relay user ID and connection ID. Persist refresh tokens and the OAuth application secret through OS-protected storage: Windows credential protection, macOS Keychain or the available Linux secret service. If native storage is unavailable, offer clearly labelled session-only credentials or leave persistent connection disabled. Never fall back to plaintext database fields or browser storage. Google recommends protected storage, handling invalidated tokens, and incremental authorization. [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)

Proposed metadata tables contain user ID, connection ID, Google subject, display label, granted scopes, status, secret reference, revision and timestamps. Token bytes, authorization codes and PKCE verifiers never enter task context, API responses or audit payloads. Short-lived access tokens stay in bounded process memory. Connector contents must be filtered by user at the repository layer, not only in the UI.

Serialize refresh, reconnect and disconnect per connection. Capture a revision before vault access and recheck it before requests and credential persistence. Invalidate and abort active calls before disconnecting. An `invalid_grant` transitions to reconnect-required and pauses dependent work; it must not trigger an unbounded refresh loop. Token expiry is normal: external applications in Testing usually receive seven-day refresh tokens for these scopes, and grants can be invalidated by user revocation, Gmail password changes or token limits. [Google token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration)

Disconnect should cancel connector work, invalidate outstanding approvals, revoke the Google grant where reachable, erase local credentials and clear temporary content. If the network prevents revocation, report that local removal succeeded but Google-side removal remains unverified, with instructions to remove the grant in the Google account. Do not report remote revocation as successful without a response.

Account disable immediately blocks use and cancels calls. Session logout cancels that session's unfinished authorization flow; it need not silently revoke a separately consented background connector. Whether background tasks are enabled is a visible user choice.

## Deterministic tool and mutation boundary

Expose narrow structured tools through the existing broker: search/read mail, read calendar windows, propose draft/event, and separately commit an approved proposal. The backend supplies the current user's connector; an agent cannot choose another user or a secret reference. Restrict requests to fixed Google API endpoints, prohibit credential-bearing redirects, and bound pages, time, response bytes, parsed MIME depth and attachment size.

Mail bodies, quoted replies, calendar descriptions and attachments are untrusted data. They cannot grant permissions, select another account, approve a send, or override privacy policy. Do not load remote HTML images or execute active content when rendering email.

An approval binds to the exact user, Google subject, connector revision, task, operation and canonical payload hash. Mail previews include recipients (To/Cc/Bcc), sender identity, subject, body, attachment hashes and reply/thread target. Calendar previews include calendar, title, time zone, start/end, recurrence, attendees and notification settings. Changes invalidate approval. Initial external mutations require allow-once; a generic task grant must not authorize arbitrary later mail or invitations.

Calendar `start` is inclusive and `end` is exclusive; preserve all-day dates versus zoned timestamps. Show DST ambiguity before approval. `sendUpdates` changes attendee notification behavior; `none` is not a promise that no email can be sent and can cause synchronization problems. [Calendar event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)

Use event ETags with `If-Match` for updates/deletes, treating HTTP 412 as a changed proposal requiring review. Conditional modification is not supported for insert; use a permitted client-generated event ID to reconcile an uncertain create. A successful lookup must match the approved payload before reporting success. [Calendar conditional operations](https://developers.google.com/workspace/calendar/api/guides/version-resources)

Do not automatically retry an uncertain mail send or draft creation. Persist an uncertain receipt and reconcile provider evidence where possible; otherwise ask the user to inspect the account. A send receipt demonstrates API acceptance, not delivery to the recipient. Tool results must accurately distinguish a local proposal, a stored draft, a created event and an accepted send.

## Privacy and retention

Default Google-derived context to local models. Connecting Gmail/Calendar does not authorize transferring their content to an AI provider. Cloud egress requires the user's separate explicit data policy, scoped to the content being sent, and must satisfy applicable Google data-use requirements. Treat summaries and extracted findings as derived private data, not automatically public context.

Google Workspace policy constrains use and transfer to disclosed user-facing purposes and prohibits using Workspace data to train generalized AI models beyond the permitted personalized use. Implement retention/deletion controls before connecting real accounts. Do not use mail for advertising, unrelated analytics or shared-model training. [Google Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

Initially avoid mailbox-wide sync and embeddings. Keep bounded transient content with explicit expiry; persist only user-requested artifacts under that user's access controls. Audit operation kind, account reference, provider IDs, time, approval and verification status without copying whole messages or tokens. Document separately what a user saves in a conversation; disconnecting a connector must not misleadingly imply all previously saved artifacts disappeared.

## Concrete Google Cloud setup

These are required deployment inputs, not configuration already performed:

1. The owner creates/selects a Google Cloud project and enables Gmail API and Google Calendar API.
2. Configure Google Auth Platform Branding, Audience and Data Access: app name, support/developer contacts and only the feature scopes implemented. Use External for consumer Gmail or users outside one organization; Internal is limited to the eligible Workspace/Cloud Identity organization. Add named test users while Testing. [Consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent)
3. Create a Web application OAuth client and register the exact chosen callback URI, for example `https://relay.example.com/api/connectors/google/callback`. Configure each permitted origin explicitly. Store the client ID as configuration and the client secret in the host vault. Do not commit downloaded client JSON.
4. Each Relay user independently selects Connect and consents to their Google account. An owner-supplied service account or Workspace domain-wide delegation is not the solution for ordinary personal Gmail access.
5. For a public release, prepare verified domains, accurate homepage/privacy disclosures, scope justifications and a video demonstrating consent and each feature. Restricted Gmail scopes ordinarily require additional verification and, for applicable server data access, an annual security assessment. Personal/testing/internal exceptions have conditions; “local-first” alone is not an exemption, especially when the host handles other users' data. Confirm the deployment's category before distribution. [Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
6. A send-only release still uses the sensitive `gmail.send` scope and must meet its applicable verification requirements; removing read scopes does not make every public OAuth release unreviewed. [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

## Implementation sequence and acceptance evidence

First add connector schemas, user-owned metadata and secret lifecycle; then implement the OAuth transaction and feature-specific reads. Add broker capabilities and local proposals before mutation tools. Finish approval receipts and uncertainty handling before enabling any write scope. Build the responsive account/scopes/proposal views alongside each functioning backend stage.

Required deterministic tests cover cross-user ID guessing, scope omission, state replay, wrong session/origin/nonce/verifier, revoked-session completion, refresh/disconnect races, missing keyrings, secret redaction, malicious MIME/HTML, prompt injection, exact-recipient/payload approval binding, ETag conflicts, API failures after possible writes, and cancellation. Fakes must not be displayed as connected production accounts.

Required browser tests cover Chrome/Firefox/WebKit, strict cookies, callback failure and retry, Cloudflare reauthentication, LAN versus public origins, phones, keyboard navigation, clear account identity, and large approval targets. No callback code/state/token may reach browser storage, referrers or logs.

Live acceptance requires a dedicated Google test account and real consent, bounded read receipts, and explicitly approved draft/event operations. Verify actual draft/event contents and disconnect behavior against Google. A send test needs its own explicit recipient and approval. Record these as outstanding until executed; passing mocked OAuth tests or showing agent cards does not establish a working integration.
