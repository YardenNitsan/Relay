# Google Workspace read-only connection

Relay has a separate Gmail and Google Calendar connection. It never reuses Gemini OAuth consent, provider API keys, environment credentials or another Relay account's Google token. The connector remains **unconfigured and disconnected** until the host owner supplies an application and each user explicitly completes consent. Current verification uses injected Google responses and isolated databases; no real account consent, mailbox read or calendar request has been performed during development.

## Configure a real application

Use a dedicated Google Cloud project with Gmail API and Google Calendar API enabled. Create an OAuth **Web application** client for this host/browser flow. Register each exact callback URL shown by Relay: for example `http://127.0.0.1:4317/?relay_workspace=1` and, if remote access is configured, the corresponding approved HTTPS origin plus `/?relay_workspace=1`. A desktop-only public client does not cover remote browser callbacks. Raw LAN IP origins are not supported by this flow.

The local owner supplies `clientId`, `clientSecret` and `separateProjectAccepted: true`. The public client ID/revision and separation acknowledgement are stored in PostgreSQL; the client secret goes only to the OS credential vault. Relay rejects exactly reusing the configured Gemini client ID. It **cannot prove Cloud project separation from the client ID**, so the acknowledgement records an owner assertion, not independently verified project identity. Verify separation in Google Cloud Console. Google documents that revoking a token invalidates grants for all OAuth clients in the same project, making project separation relevant even when local credential namespaces differ. [Google web-server OAuth and revocation](https://developers.google.com/identity/protocols/oauth2/web-server).

Configure Google's consent screen and eligible test users or complete the applicable publishing/verification process. `gmail.readonly` is a restricted scope; public availability and account acceptance depend on Google's requirements. Relay does not bypass consent, test-user restrictions, application verification or Workspace administrator policies. [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes).

Requested scopes are exactly:

- `openid` for a signed account subject and nonce binding.
- `https://www.googleapis.com/auth/gmail.readonly` for mailbox search and reading.
- `https://www.googleapis.com/auth/calendar.events.readonly` for event detail reads.
- `https://www.googleapis.com/auth/calendar.freebusy` for availability queries supported by the consenting account's grant.

No send, draft, mailbox modification or calendar-edit scope is requested. Missing or unexpected granted scopes reject connection. Setup, cached credential presence and a successful live API read are distinct facts: `connected` means usable local credentials for the current account/configuration revision are saved, not that Google has just verified them.

## Authorization and storage

Every sign-in uses random one-use state, an OIDC nonce and S256 PKCE. State expires after five minutes and binds the Relay account, browser session, session version, application revision, redirect and connection generation. The server verifies Google's JWT signature, issuer, audience, age, nonce and authorized-party binding. PKCE follows Google's documented verifier/challenge flow; browser-host callbacks use the configured web client. [Google PKCE flow](https://developers.google.com/identity/protocols/oauth2/native-app), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

Refresh tokens are partitioned by account and connection epoch in the `relay-local.google-workspace` OS-vault namespace. Access tokens stay in bounded process memory. There is no plaintext fallback or inherited owner credential. Durable grant records bind the session version as well as configuration revision; account revocation and restored snapshots that increment the version require reconnection. Replacing application configuration invalidates existing grants and pending sign-ins. Old orphaned vault records can remain if an OS-vault removal fails; their old epochs/revisions do not authorize use.

Reads check the current enabled/approved Relay user and live session before dispatch and after receiving data, and serialize per account. Disconnect invalidates active work and pending sign-ins, disables the durable grant, removes the local refresh credential and attempts Google's fixed revocation endpoint. `revoked: false` means local disconnection succeeded but upstream revocation was not confirmed; review Google Account application access if needed. No mail content, search terms, event bodies or credentials enter connector audit events. Direct panel content is returned only to the authenticated requesting account and is not inserted into conversations. Explicit agent-tool reads described below persist selected content in task context and tool receipts; connector tokens never enter either.

## Supported reads and limits

- **Search mail:** Gmail `users.messages.list` for `users/me`, followed by metadata reads for the selected results. Defaults to ten messages, maximum twenty per explicitly requested page. Queries are at most 1,000 characters; spam/trash inclusion is disabled. Only From, To, Subject and Date headers plus a bounded snippet are returned. [Gmail messages.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).
- **Read mail:** Gmail `users.messages.get` with `format=full`, using a bounded message ID. Returns selected headers, snippet and plain-text MIME parts. It never fetches attachments, renders HTML, follows email links or marks a message read. HTML-only messages report `bodyUnavailable`; they are not silently presented as empty plain-text messages. MIME traversal is depth/node bounded and decoded content is limited. [Gmail messages.get](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).
- **List events:** one explicit calendar (default `primary`), RFC3339 time bounds spanning at most 31 days, at most fifty events per page. Recurrences are expanded with `singleEvents=true` and ordered by start time. Descriptions and locations remain untrusted text. Returned all-day dates and time-zone metadata are preserved; pagination/limit indicators disclose partial results. [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).
- **Free/busy:** at most ten explicit calendar IDs, a 31-day window and at most 500 busy intervals per returned calendar. Missing calendars, per-calendar errors, invalid intervals or oversized interval collections return unavailable with `busy: null`, never an empty free schedule. Group expansion is tightly bounded and group lookup is not a supported product feature. [Calendar freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).

All outbound URLs use fixed Google OAuth/Gmail/Calendar endpoints. Redirects are refused. Token responses are limited to 64 KiB, other JSON responses to 1 MiB, and an active read operation to 30 seconds. Reads do not automatically retry. Queues are bounded to sixteen operations per account and one hundred active account queues. The registered routes share a twenty-per-minute account limit for explicit connection mutations and reads across listeners. Partial search/calendar pages are never labeled complete.

External text can contain instructions, HTML-like strings or misleading claims. Render it as inert text. Do not treat content as permission, execute links, send messages in response to it or automatically insert it into a model prompt. The direct read-only UI remains independent of task opt-in: opening it never grants agent access.

## Server and browser contract

Construct `GoogleWorkspace(store, {allowedOrigins, ...testOverrides})`. Production uses the OS vault, global fetch and Google's pinned JWKS URL. Test overrides inject vault/fetch/time/identity verification; production must not replace signature verification. Every account operation receives `WorkspaceActor = {principal, live, signal?}`. `live()` checks the actual authenticated Relay session for browser operations. The internal read-only tool adapter instead checks durable task ownership, session version, task scope and stop generation before/after every Google request. It cannot create or change OAuth grants. `configure` additionally requires a local owner and rechecks its durable role.

Register `registerGoogleWorkspaceRoutes(app, service, principal, owner, live)` inside Relay's existing authentication, Host, Origin and CSRF boundary. The registration function exposes:

| Route | Operation |
| --- | --- |
| `GET /api/admin/google-workspace` | Owner setup metadata and callback origins |
| `PUT /api/admin/google-workspace` | Owner application configuration |
| `GET /api/integrations/google-workspace` | Current account connection status |
| `POST .../start` | `{origin}` â†’ authorization `{url}`; Origin header must match |
| `POST .../complete` | `{state, code?, error?}` â†’ current status |
| `DELETE /api/integrations/google-workspace` | Disconnect current account |
| `POST .../mail/search` | `{query?, maxResults?, pageToken?}` |
| `POST .../mail/read` | `{id}` |
| `POST .../calendar/events` | `{timeMin, timeMax, calendarId?, maxResults?, pageToken?}` |
| `POST .../calendar/freebusy` | `{timeMin, timeMax, calendarIds?}` |

Here `...` means `/api/integrations/google-workspace`. Private queries and object IDs use POST bodies to keep them out of request URLs. Routes never accept a different account ID. APIs must retain `Cache-Control: no-store`. The callback is the inert application entry `/?relay_workspace=1`, which requires the same narrow cross-site top-level-document exception as Gemini. It does not grant a cross-site API exception. The browser must remove code/state from its URL immediately and complete authorization in the original authenticated Relay session. Only explicitly pressed read actions should fetch private content; opening settings or rendering a specialist must not fetch mail.

## Sending and calendar changes: intentionally unavailable

There is no callable send/draft/calendar-write method or route in this foundation. A later implementation must obtain separate explicit write consent and pass every mutation through durable broker authorization. Before approval, normalize and present the exact sender/account, recipients including Cc/Bcc, subject, full body, attachments with hashes, reply/thread identity, and calendar object/attendee/time-zone changes. Bind approval to an immutable payload digest, user/session version and stop generation; changes invalidate approval.

Before dispatch, transactionally claim a single-use approval and persist a pending operation receipt. Never let a queued operation reuse revoked approval. Record provider resource identity and confirmed outcomes without claiming idempotence the upstream API does not guarantee. A timeout or crash after sending may mean delivery already occurred: mark the receipt uncertain, do not automatically retry, and require state inspection plus an explicit new decision. An in-memory confirmation dialog alone is insufficient. Mail and calendar text cannot authorize these actions.

Live consent, OS-vault availability on each target platform, Google application approval and real account read acceptance remain owner/environment prerequisites. Fixture tests establish local authorization and parsing behavior, not deployment acceptance or external service availability.


## Explicit agent reads

Advanced controls contain separate Gmail and primary-calendar read checkboxes. They remain disabled until this account is connected and the task uses local-only models, read-only access, disabled website access and no MCP servers. Conflicting settings are rejected; selecting a connector never silently enables cloud sharing or changes permissions. The General agent can use either selection. Email gets `gmail_search`/`gmail_read`; Calendar gets `calendar_events`/`calendar_freebusy`. Other specialist allowlists remain unchanged. Auto requires a tool-capable local model for the applicable worker.

Task options store `googleWorkspace: {mail, calendar}`. Every call passes the broker, which checks that exact durable scope after waiting and before/after each Google request. Account revocation, task cancellation, emergency stop, connection changes and session-version changes reject queued work or discard returned results. Reads use only the task owner's connected token. A live browser session is not required for an already authorized task, but a copied account role alone grants nothing.

Opting in permanently restricts this conversation through its retained task history, even if no read completes. Future tasks in the conversation cannot use cloud models, writes, host access, website requests or MCP. Admission checks run in the task transaction; actual cloud dispatch and broker tools recheck the durable history. Completed/failed/cancelled tasks and soft-deleted conversations retain the restriction. History retrieval is scoped to the same conversation. Unchecking the boxes removes new read capability; it does not remove the conversation restriction. Start a separate conversation for cloud use.

Selected mail/event content is untrusted input to local models and is stored in ordinary private task context, tool receipts and activity records. The fixed Google endpoints are authorized by the separate connector consent; they do not require or grant general website access. This is an application boundary, not comprehensive data-loss prevention: a user can explicitly copy/export content or save a memory manually. It does not prevent the same OS account from reading Relay data. No send, draft, event mutation, attachment, arbitrary calendar or link-following tool is exposed. The direct UI's broader explicit calendar-ID API remains separate.

Deterministic tests use injected Google responses with real PGlite task admission, the real broker and Engine. They do not establish live Google acceptance. Browser fixtures mock connection metadata and make no external account calls.
