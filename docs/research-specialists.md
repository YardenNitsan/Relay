# Specialist agents and connected capabilities

Research and implementation direction, 9 October 2026.

Relay separates three choices: **agent** (task specialization), **model** (available intelligence), and **authority** (account, task and tool policy). The ten catalog entries in `shared/assistants.ts` supply bounded instructions and a concrete tool allow-list. They do not issue permissions. An omitted `assistantId` preserves general orchestration; existing tasks do not silently become Personal assistant tasks.

## Product behavior

| Specialist | Useful without a connector | Connected work needs |
| --- | --- | --- |
| Email | Drafts, supplied thread summaries, reply preparation | Mail account authorization and mail tools |
| Calendar | Proposed schedules, time-zone comparisons, event details | Calendar account authorization and calendar tools |
| Research | Source analysis and synthesis | Authorized public HTTPS retrieval for live sources |
| Coding | Explanations, code review, solution design | Workspace grants; a verified isolated terminal for commands |
| Files | Organization plans and text analysis | Managed workspace grants, or confirmed owner host-file access |
| Personal assistant | Prioritization and practical plans | The supplied personal task-list tool for persistent items; scheduled notifications are a separate capability |
| Browser | Public-page analysis and workflow preparation | Public HTTPS permission; interactive browsing needs a separate integration |
| Finance | Budget reasoning and educational scenarios | Supplied data or authorized sources; no bank or trading integration is implied |
| Learning | Explanations, practice and study plans | Optional authorized study materials and sources |
| Computer | Computer guidance and permitted file operations | Explicit file scope and isolation; no desktop/mouse/keyboard control is implied |

The browser loads current availability from `/api/assistants`. `available` means a profile can be selected, including useful drafting/planning. `status` distinguishes ready, limited and connection-required capabilities. Limitations and connected tool names are disclosed before selection. The server remains authoritative if availability changes after the dialog opens. There are no decorative Connect buttons for unimplemented integrations.

Selecting a specialist changes only the next objective's `assistantId`. It does not choose a cloud provider, raise computer access, expand network origins, connect accounts or replace orchestration's planner/reviewer roles. The default general option remains available.

## Google authorization research

Google recommends the narrowest scopes required by an explicit feature. Gmail's `gmail.send` permits sending without granting general mailbox reading. Reading and draft-management scopes carry different sensitivity classifications; many mailbox scopes are restricted and can require verification and security assessment. A future Gmail integration should separate draft-in-Relay, send-mail and read-inbox grants instead of requesting full mailbox access at sign-in. [Gmail scope documentation](https://developers.google.com/workspace/gmail/api/auth/scopes), [send endpoint](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send).

Calendar provides separate read, free/busy, event-write and app-created-calendar scopes. Scheduling proposals require no calendar scope. Checking availability and creating events should request distinct capabilities in context; blanket calendar administration is unnecessary for ordinary scheduling. [Calendar authorization](https://developers.google.com/workspace/calendar/api/auth).

The supported server authorization flow uses a registered OAuth client, an exact registered redirect URI, a state binding and server-side code exchange. Offline access adds refresh-token handling. Incremental consent lets the user authorize a feature when needed; rejecting a scope must disable the dependent action. These requirements are separate from Cloudflare Access Google identity sign-in. [Google server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

Google's policy requires secure token storage, least privilege, correct client registration and revocation handling. A future connector must keep account tokens in the host secret store, scoped to the Relay user, out of model context and browser storage. Disconnect must revoke and delete credentials. Public distribution may require verification; Relay must not advertise a working Gmail/Calendar connection before authorization, tool enforcement and real API acceptance exist. [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies).

## Interface decisions

The specialist picker extends the existing reading-focused visual system: descriptive rows, compact status text, expandable tool detail, and explicit selection. A two-column desktop catalog becomes a single column on phones; controls retain touch targets and normal keyboard focus. Agent, model and compute controls use separate labels. The composer adds one compact agent control rather than another permanent settings panel. These choices apply the adaptive hierarchy guidance in [Apple's layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout) and [responsive accessibility guidance](https://web.dev/articles/accessible-responsive-design), without copying a platform's visual identity.

LAN pairing requests a one-use account invitation and never shows owner-native pairing instructions. Session transport distinguishes local, LAN and remote access, including sign-out behavior. External model clients use separately issued, expiring, revocable credentials shown once. The UI describes a limited compatible inference interface; real coding-client compatibility requires separate acceptance and is not inferred from token creation.

## Validation boundaries

Browser tests cover specialist selection/persistence, availability disclosure, viewport ranges, LAN pairing errors, external-token lifecycle and missing grants. Some identity/pairing responses are explicit UI fixtures; backend authorization tests establish the actual security boundary. No live Google mailbox, calendar, interactive browser or desktop automation is claimed by this catalog. Build, test counts and manual screenshot findings belong in the final validation record after the integrated run.
