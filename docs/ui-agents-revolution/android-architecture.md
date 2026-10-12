# Native Android architecture audit

Date: 12 October 2026. Source baseline: `fda18f490d30befc66be88f25bad4e5f44c49b5d`, branch `modernization/ui-agents-revolution`. This document records the initial source audit and proposed remote architecture. A subsequently authorized LAN-only native preview was implemented and built: see [Android validation](android-validation.md) for current pins, actual APK and bounded evidence. Initial toolchain observations below are historical; official SDK 37 and build dependencies were subsequently downloaded for the approved build. Production, Cloudflare settings, routing and credentials were not changed. Remote authentication remains unproven.

## Decision

Build a Kotlin/Jetpack Compose Android client of the existing Relay host. Keep execution, provider credentials, approvals, durable tasks and permission enforcement on that host. Native screens should operate through authenticated HTTP and replayable SSE. The app is a remote account client; being the owner's phone must not confer local-owner privileges.

The preferred authentication candidate is Cloudflare **Managed OAuth with a public client, authorization code and S256 PKCE**, followed by the existing Relay session cookie/CSRF handshake. This is documented by Cloudflare but is not verified on this deployment. Do not begin by replacing the host's identity boundary or distributing a shared service credential. A runnable native shell can be built independently; production connectivity must remain gated on the authentication proof below.

## Verified existing boundary

| Contract | Source at the audited commit | Consequence for Android |
|---|---|---|
| Public Worker targets one fixed VPC service; validates RS256 Access application identity with issuer, audience, expiry, issued-at, subject and email | `deploy/cloudflare/worker.ts:103` | Use the existing protected public origin. Never use owner port 4317, raw model ports or an alternate public origin to evade Access. |
| Host independently verifies Access assertions and binds invited accounts to issuer plus subject; owner identities cannot bootstrap remote owner sessions | `server/auth/remote.ts:36`, `server/auth/remote.ts:88` | Access login and Relay approval are separate decisions. Show pending, denied and identity-changed states explicitly. |
| `GET /api/session` opens/reuses an approved remote session | `server/api/app.ts:156`, `server/auth/sessions.ts:35` | Retain the returned host-only Secure/HttpOnly/SameSite=Strict cookie in the native HTTP cookie jar; retain the returned CSRF token privately. |
| Session tokens are hashed at rest server-side; remote expiry is one hour; admission caps active sessions at 20 | `server/auth/sessions.ts:22`, `server/auth/sessions.ts:55` | Reuse a session across requests and rotations. Do not open a new session on every screen. Expiry is separate from OAuth expiry. |
| Every mutation requires Relay CSRF, and Worker mutations require exact configured Origin | `server/auth/sessions.ts:32`, `deploy/cloudflare/worker.ts:51` | Native client sends `X-Relay-CSRF` and the configured HTTPS Origin. This header is a request-boundary compatibility requirement, not native identity proof. |
| Worker does not forward `Authorization`; it forwards the verified `Cf-Access-Jwt-Assertion` | `deploy/cloudflare/worker.ts:18`, `deploy/cloudflare/worker.ts:128` | OAuth bearer belongs at the Cloudflare edge. Do not add downstream bearer forwarding just to make native login work. |
| Local-only routes are blocked at Worker and host | `deploy/cloudflare/worker.ts:38`, `server/auth/policy.ts` | No remote global emergency stop, owner pairing, host policy editing, source publication or owner-only integration. Per-task cancel remains available when authorized. |
| TypeScript interfaces and runtime schemas describe the wire shape; no Android module/Gradle wrapper or native contract generation was found | `shared/types.ts`, `server/api/app.ts`, `web/api.ts`, repository file inventory | Add explicit Kotlin DTOs and compatibility tests. TypeScript types are not a runtime protocol guarantee for an independently shipped app. |

The existing architecture and security documents were read: `docs/product-spec.md`, `docs/architecture.md`, `docs/implementation-plan.md`, `docs/security-model.md`, `docs/remote-access.md`, `docs/cloudflare-free.md`, and `docs/final-evolution/security-review.md`. Historical acceptance claims in these files are not fresh Android evidence.

## Authentication proposal and proof gate

Cloudflare documents Managed OAuth for non-browser public clients, identity-based Access policy enforcement, opaque client tokens, and conversion at the edge into signed assertions for the origin. Its settings allow HTTPS redirect URIs and optional localhost/loopback clients; token refresh re-evaluates policy. This feature is shown as Beta in the documentation navigation. These are vendor capabilities, not confirmation that the deployed application enables them. [Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/)

Cloudflare's public-client example documents discovery, registration with no client secret, S256 PKCE, resource indicators and `Authorization: Bearer` transport. Its sample is a CLI workflow, not an Android implementation. Do not copy its secret-printing examples into logs or product diagnostics. [Authenticate coding agents](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/)

Proposed end-to-end sequence:

1. Load a trusted, exact Relay HTTPS origin and expected Access team configuration. In the initial release, support one configured host; adding arbitrary hosts expands phishing, credential-routing and cache-isolation obligations. Validate discovered endpoints against the expected HTTPS Access issuer before following them.
2. Start an in-memory authentication transaction with unpredictable state and PKCE verifier. Use the system browser/Custom Tab and an OAuth library whose public-client PKCE and resource-indicator support have been checked. No embedded login WebView and no APK client secret. Follow native OAuth security guidance. [RFC 8252](https://www.rfc-editor.org/info/rfc8252/)
3. Prefer an exact verified HTTPS Android App Link callback. Bind state, redirect URI, issuer, resource, client identifier and verifier to one attempt; reject stale, unsolicited and duplicate callbacks. Preserve an attempt across process death only through protected, bounded storage, otherwise restart login. Codes never become Relay credentials and must never appear in analytics.
4. Exchange the code at the discovered, validated token endpoint. Present the resulting opaque access token only to the protected Relay origin over HTTPS. Cloudflare, not the app, produces the signed assertion the Worker and host already validate. Confirm the deployed assertion's type, identity binding, audience and expiry match the current verifiers without logging credential values.
5. Call `GET /api/session`; bind the returned account to the current host/authentication epoch. Accept only expected JSON and a successful status. Store the remote cookie in a private host-scoped jar and CSRF in session memory. Mutations include both proofs and exact Origin. Disallow automatic cross-origin redirects with bearer/cookie/CSRF attached.
6. Refresh OAuth through a single shared operation before expiry. On Relay session expiry, invalidation or revocation, stop streams and in-flight work, hide private content, and require deliberate reconnection; never silently resurrect a revoked session. A still-authorized Access user may be able to establish another Relay session, as in the existing browser model. Account disablement or session-version revocation is the stronger owner control.
7. Explicit logout posts `/api/session/logout` with CSRF, attempts supported OAuth revocation, then clears local tokens, cookies, cached private views and pending sensitive notifications. If offline, clear locally and report that remote session termination was not confirmed; do not claim server logout succeeded. Browser IdP SSO may remain, so the UI must distinguish app sign-out from identity-provider sign-out.

Callback infrastructure is a concrete blocker. Android verifies HTTPS associations through the domain's `/.well-known/assetlinks.json` and the release signing certificate identity. The current Worker rejects this path, and an Access-gated association file is not a usable anonymous OS verification endpoint. Prefer a separately reviewed public static association/callback hostname with no Relay API routing, no tokens and no analytics. This would not bypass Relay Access, but it is new infrastructure and has not been created or authorized by this audit. An exact registration and physical-device callback test are required. A localhost callback is a vendor-documented alternative for CLI clients, but Android process/background behavior and local interception need a separate proof; custom-scheme support must not be assumed from the HTTPS allowlist. [Verify App Links](https://developer.android.com/training/app-links/verify-applinks)

Before any production setting change, prepare a reviewable candidate: current configuration diff, retained Allow policies, exact callback allowlist, no broad wildcard/loopback permissions unless selected, expected rollout/rollback, and browser regression results. Test with a disposable Access application first where available. Required proof: one permitted human identity reaches `/api/session`, an uninvited one is refused, no service token is accepted, the Worker and host both validate unchanged assertions, and browser login still works. Neither an opaque OAuth token pasted into `Cf-Access-Jwt-Assertion` nor a Relay cookie alone satisfies these checks.

If the deployed application cannot support this documented flow, native remote authentication remains blocked. Browser sign-in can remain available as a separate user option; it does not turn a browser wrapper into the requested native app. Do not scrape browser cookies, export IdP credentials, embed service tokens, relax signature/type/issuer/audience checks, create an unprotected `/mobile` API, or tunnel the owner listener.

## Native composition

Proposed package boundaries within a new `android/` tree:

| Area | Responsibility |
|---|---|
| `app` | Application lifecycle, dependency construction, top-level adaptive navigation and release configuration |
| `core:model` | Versioned transport DTOs, task states, immutable screen models; unknown event types retained safely |
| `core:network` | Bounded HTTP, explicit redirects, cookie jar, error mapping, SSE parser, cancellation and timeouts |
| `core:auth` | OAuth attempt state, single-flight refresh, host/account epoch, token protection and logout |
| `core:data` | Repository orchestration, snapshot/event reconciliation and account-scoped drafts |
| `core:designsystem` | Relay typography/colors, accessible components, motion and shared pane rules |
| `feature:conversations`, `feature:agents`, `feature:projects`, `feature:account` | Screen state and native Compose surfaces using the same server authority |

Start with a small number of Gradle modules or packages and split where build/test isolation helps. Use ViewModel plus StateFlow, immutable UI state and unidirectional user actions. Views never own refresh logic or create extra streams. Do not run inference, agent tools or a second permission engine on the phone.

Use Navigation 3 for typed destinations and saved back stacks; Material 3 adaptive list/detail scaffolds for conversation list plus thread and agent list plus inspector. Compact windows display one pane with predictable Back; expanded windows keep selection visible. Width, height, posture, IME and font scale drive layout rather than a phone/tablet device label. Draft state must survive rotation, pane changes and temporary failures; private content must be removed on forced account teardown. [Adaptive list/detail guidance](https://developer.android.com/develop/ui/compose/layouts/adaptive/list-detail)

Native first increment: account/connection screen; conversation/history list; composer; ordered activity; task/agent inspection; exact-action approval details; permitted per-task cancel/resume; read-only project files/diffs. Subsequent increments may add expected-hash file edits and system-picker imports. Android device files require Storage Access Framework consent and content URIs, not browser folder handles or raw path permission. Source publication, branch integration, local model loading and global stop remain constrained by existing owner-only contracts.

Do not represent ten assistant profiles as ten running agents. Render actual task steps, roles, model identities and statuses from durable data. Unknown model assignments remain unknown. Role, assistant profile, model and capability grants remain distinct. Server task status is authoritative; a dropped stream is connection loss, not task failure or success.

## API and replay contract

| Flow | Existing contract | Native handling |
|---|---|---|
| Start conversation | `POST /api/conversations/start` with `requestId`, `content`, full `options` | Keep the exact request ID and payload through an uncertain response. Server compares the original objective/options and can return the original result. Never reuse an ID for changed input. |
| Follow-up | `POST /api/conversations/:id/messages` | No equivalent caller idempotency key exists here. After a lost response, fetch/reconcile the conversation and ask for deliberate retry if outcome remains uncertain. Do not queue blind background retries. |
| History/details | `GET /api/conversations`, `/api/conversations/:id`, `/api/tasks/:id` | Account-scoped snapshots; task detail includes steps, events, approvals, verification and changes. Reconcile after reconnect or unknown event types. |
| Approvals | `POST /api/approvals/:id` | Display exact operation, arguments, scope and consequences. Refresh stale decisions; do not infer task-wide authority from a one-action grant. |
| File changes | `/api/workspaces/:id/file`, existing expected-hash contract | Preserve exact content/hash and collision handling; uncertainty requires reconciliation, not automatic overwrite. |
| Models | `GET /api/models` | Display server-discovered eligibility and actual availability. The app does not invent provider access. |
| Events | `GET /api/events?after=<id>&scope=<scope>`, optional `Last-Event-ID` | One shared foreground stream per signed-in app instance; authenticated header-capable SSE client, not browser EventSource. |

Server event details are in `server/api/app.ts:333` and `server/api/activity-replay.ts`. The stream starts with `retry: 1500` and a `replay` event containing `{scope, after}`, then `activity` events with numeric IDs and durable payloads. Comments are heartbeats. The scope is an opaque namespace tied to Store lifetime, session, account and version; it grants no authorization. Account filters still apply.

The native reducer must handle split UTF-8/chunk boundaries, multiline SSE data, comments, malformed/oversized frames, duplicate events, unknown types, and cancellation. Persist a cursor only after its entire corresponding batch is applied. If persisting a cursor across process death, persist the matching materialized state transactionally; otherwise discard the cursor and fetch a fresh snapshot. A changed scope resets replay state. Never interpret gaps in globally allocated IDs as missing private-account events. Keep ordering, deduplicate by event ID, and avoid treating replayed historical completion as a new notification. Browser reference behavior: `web/useRealtime.ts`, `web/realtime-state.ts`, `web/useTaskNotifications.ts`.

On backgrounding, close the foreground stream and reconcile when the app becomes active. Host execution continues subject to its existing lifecycle. Android scheduled background work cannot guarantee an indefinitely live stream, and Relay has no implemented closed-app push service. Initial release therefore makes no instant-background-notification promise. Future push needs explicit consent, generic payloads, a separately authorized server service and notification taps that reauthenticate before fetching details. [Android background tasks](https://developer.android.com/develop/background-work/background-tasks)

## Dependency research, 12 October 2026

These are versions observed in official documentation, not a verified combined build matrix. Pin exact dependencies and wrapper checksum when creating the project; never copy alpha dependency examples from a release page simply because they appear first.

| Component | Current documented stable candidate | Evidence / adoption note |
|---|---|---|
| Kotlin | 2.4.21, released 8 October 2026 | [Kotlin releases](https://kotlinlang.org/docs/releases.html). Match the Compose compiler plugin to the effective Kotlin compiler. |
| Compose BOM | 2026.09.00 | [Official BOM guide](https://developer.android.com/develop/ui/compose/bom). Use the stable BOM artifact, not alpha/beta variants. |
| Navigation 3 | 1.2.0 | [AndroidX release table](https://developer.android.com/jetpack/androidx/releases/navigation3), updated 7 October; 1.3.0-alpha02 is a separate preview. |
| Material 3 Adaptive | 1.3.0 | [AndroidX release table](https://developer.android.com/jetpack/androidx/releases/compose-material3-adaptive); preview 1.4.0-alpha03 is not the default. Verify resolved Navigation 3 compatibility. |
| Android Gradle Plugin | 9.4.0 | [AGP 9.4 compatibility](https://developer.android.com/build/releases/agp-9-4-0-release-notes): Gradle 9.6.0, JDK minimum 17, Build Tools 36.0.0, supports API 37. |

AGP 9 uses built-in Kotlin; follow its supported compiler-version override mechanism if selecting a newer Kotlin, rather than applying conflicting legacy Android Kotlin plugins. Resolve and compile the entire set before calling it compatible. Initial minSdk 26 is a proposed support tradeoff, not a discovered product requirement. A current release target/compile SDK must be selected and tested explicitly; API 37 is not installed in the audited SDK tree. [Built-in Kotlin guidance](https://developer.android.com/build/migrate-to-built-in-kotlin)

## Local readiness evidence

Read-only checks on this Windows host:

| Check | Observed result |
|---|---|
| Repository inventory using `rg --files` for Gradle, Kotlin and manifest names | No Android project files found at this baseline |
| `Get-Command java,javac,adb,gradle,sdkmanager,emulator,android` | None resolved on the current PowerShell PATH |
| `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` presence | All unset in the current process; values of unrelated environment variables were not read |
| `C:/Program Files/Android/Android Studio/product-info.json` | Studio build `AI-253.30387.90.2532.14935130` |
| Bundled `jbr/bin/java.exe -version` | OpenJDK 21.0.9 runs successfully |
| `%LOCALAPPDATA%/Android/Sdk` inventory | Platform `android-36.1`; Build Tools `36.0.0`, `36.1.0`; platform-tools, emulator, cmdline-tools/latest and system-images present |
| Direct SDK `platform-tools/adb.exe version` | ADB 1.0.41, platform-tools `37.0.0-14910828` |
| Direct SDK `emulator/emulator.exe -list-avds` | `Medium_Phone_API_36.1`; emulator was not launched |
| SDK license file existence | Present; this is not proof every proposed package license is accepted |

No ADB server was started, no device was paired, no software was downloaded, and no build, emulator boot, install or APK signing was attempted. Installed files do not establish working virtualization, physical-device access, network resolution of dependencies or release reproducibility. Configure the build per project using known tool locations; machine-global PATH edits are unnecessary.

## Reference provenance

Cursor's current official mobile documentation describes a native iOS client for starting and following remote agents and inspecting reviewable changes; it explicitly says Android is planned. Adopt the functional pattern of persistent host work plus a phone control surface, not proprietary visuals, unsupported APIs or claims that Cursor has shipped Android. Relay cannot promise Cursor's PR merge, voice or cloud-machine capabilities without its own authorized backend implementation. [Cursor mobile documentation, inspected](https://cursor.com/docs/cloud-agent/mobile)

Google's [Android skills documentation](https://developer.android.com/tools/agents/android-skills) links to the official [android/skills repository](https://github.com/android/skills). Its README and repository inventory were inspected; the repository identifies Apache-2.0 licensing and contains Navigation, Compose, security, testing and AGP guidance. This establishes provenance, not installation or compatibility with Relay. No skill package was installed or executed. Before using a particular skill during implementation, read its exact `SKILL.md` and referenced scripts at a pinned commit, scope it to Android work, and preserve higher-priority authorization constraints. [Inspected README](https://raw.githubusercontent.com/android/skills/main/README.md)

## Delivery gates and exact blockers

1. **Authentication proof:** Managed OAuth enablement, exact callback registration, public association hosting, correct edge assertion and physical-device browser return are unverified. No production policy changes are included here. Keep the existing human Access protection intact.
2. **Build foundation:** native project, pinned wrapper/dependency graph, chosen SDK support policy, signing identity and CI job do not exist in this baseline. SDK 37 requires deliberate provisioning if chosen; currently installed SDK 36.1 can support a separately pinned prototype.
3. **Contract compatibility:** no independent mobile API version/capability negotiation exists; define a supported host/app compatibility range. Follow-up mutation idempotency is absent; initial app must reconcile uncertain responses rather than auto-retry them.
4. **Native vertical slice:** verify real login, own conversation start, streamed task progress, exact approval, result, cancellation, app restart, Access expiry, Relay revocation and host outage. Fixtures and web phone emulation do not satisfy this gate.
5. **Release artifact:** produce a signed APK with package/version, checksum, certificate fingerprint and install/upgrade evidence; retain build provenance and R8 mapping privately. Signing keys never enter Git or the APK. No artifact exists from this audit.
6. **Accessibility/device acceptance:** TalkBack, large text, Hebrew/RTL, compact/expanded/foldable windows, IME, edge-to-edge, rotation, Back and reduced motion on emulator and a physical Android device. User permission for a connected physical device may be necessary when the OS prompts; elapsed time is not permission.

The security test inventory and residual risks are in [threat-model.md](threat-model.md). Completion means observed native behavior and a real installable artifact, not a Compose mockup, successful browser test, or an architectural proposal.
