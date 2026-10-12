# Independent review: bounded revolution increment

Reviewed on 12 October 2026 in `Relay-revolution`, branch `modernization/ui-agents-revolution`. The reviewer was separate from the implementation agents. Initial scope was `fda18f490d30befc66be88f25bad4e5f44c49b5d..754bd01` plus the task-feed working changes; subsequent source reviews covered G2, Dispatch navigation, Agent Studio recent work and the Android LAN preview, including corrections made during review. This records the inspected source, not a certification of the entire product or production readiness.

The backend, Dispatch, Agent Studio and native source findings below were corrected and reinspected. No blocking source finding remains in this bounded review. Wider browser acceptance, authenticated native integration, physical-device security and release supply-chain gates remain open.

## Review method and evidence

The reviewer read repository operating rules, the phase implementation/design decisions, native architecture and threat model, relevant backend authorization/context code, frontend state/cache/focus code, Android transport/storage/presentation code and the native CI workflow. Findings were sent directly to the root and relevant implementer before source reinspection. The reviewer changed only this report; product fixes belong to their implementers.

Independently executed during the initial review:

```powershell
npm.cmd test -- tests/task-feed.test.ts tests/required-verification.test.ts tests/cloudflare-worker.test.ts --maxWorkers=1
git diff --check
```

Result: **69 tests passed across 3 files**, exit 0, 25.27 seconds; diff check passed. This is the initial reviewed snapshot, before the later G1 coverage extension/G2/native/frontend corrections. It must not be presented as a rerun of final integrated source. Later reviews were source-only, avoiding the root browser/build and native build/emulator workloads. Implementer and root acceptance evidence is recorded separately in [agent-capabilities.md](agent-capabilities.md), [testing.md](testing.md) and [android-validation.md](android-validation.md).

## Backend contracts and agent boundaries

- **G1:** `authorizeOptions` rejects a selected profile that cannot perform required `file_read`, before task/message admission. Engine checks the profile ceiling and global tool availability before entering graph/model execution. Existing broker/evidence authority is retained; no router or grant broadening was found. Review identified a low-priority regression-coverage gap: missing-tool testing covered only Fast, where the old worker guard could mask removal of the new early guard. The corrected test now covers all four depths and asserts zero provider calls and zero durable `callsUsed`.
- **Task feed:** SQL selects explicit summary fields, bounds objectives to 200 Unicode code points, requires both task and conversation ownership and excludes deleted conversations. Pagination seeks immutable creation timestamp plus ID and retains database microseconds; cursors are scoped navigation positions, not credentials. Native app hooks and the existing Worker authentication/Origin gates are retained. No account disclosure or private-field projection finding was established.
- **Browser fixture:** authenticated API workspace creation remains; the native seeding helper validates a disposable temporary root and uses the broker. No production limiter, request authority or UI assertion was relaxed by that helper.
- **G2:** reviewer context receives persisted, bounded planner acceptance as a separate explicitly untrusted user message. The protected fitting prefix retains it or rejects an oversized request before spending. Reviewer reconstruction retains assistant/tool pairs and rebuilds the suggestion message once after repair/recovery. Tool filtering, routing, budgets and objective evidence classification remain unchanged. The new test source covers malicious suggestions, omitted criteria, restart/repair, oversized context and unplanned-review compatibility; the implementer reports 44 focused passes, not independently rerun here.

## Dispatch findings and verified source corrections

| Finding | Severity | Correction inspected |
|---|---|---|
| A delayed first-message admission could reopen Conversation after the user switched to Work. | P2 | `navigateScreen` increments navigation intent; acknowledged send checks the captured version. |
| Work and execution navigation were absent from URL/history, so refresh/Back restored the wrong surface. | P2 | `view` is written/read, `popstate` restores it, and Work/Conversation plus all three execution-opening callbacks use the shared navigation helper. |
| A failed background feed/detail refresh removed already loaded work and evidence. | P2 | Error notices render alongside cached data; loading/error states no longer replace valid cached records. |
| Narrow task inspection hid the initiating control before a loading/error focus target existed; resizing could hide inbox/intro focus. | P2 | A persistent focusable detail region is focused on selection; the 900px transition covers both inbox and intro. Back falls back to search if its task row has disappeared. |
| Acknowledged conversation deletion left task summaries and selected details available in cache. | P2 | Feed queries are cancelled before summaries are pruned across cached pages; matching task caches are removed, selection is cleared through the deleted-conversation signal and the feed is invalidated. |

The conversation stays mounted behind `hidden`, preserving its draft and scroll owner during surface changes. New feed/detail reads use the existing API/session epoch boundary; invalidation cancels and clears caches. No added permission bypass or automatic task mutation was found. The delayed-admission and URL/Back regression sources were inspected; root owns their browser results. Source inspection does not replace final keyboard, reflow, populated-history, offline-cache and deletion-race browser acceptance.

**Final narrow navigation review:** root reported a 34-case regression run with 32 passes and two phone focus failures after chained Models/Usage dialogs. The new masthead placed Command before More in DOM order, so the old combined fallback selector chose Command on phones. `Modal` now preserves its existing original-trigger and explicit fallback precedence, then searches visible More before Command at the same 700px breakpoint as the shell, reversing that fallback order on desktop. The reviewer inspected this correction and confirmed that both existing phone More-focus expectations remain intact. The Stop all control now retains a 44px minimum height, including phone/short-height styles, matching the existing touch-target assertion; authority and stop behavior are unchanged. Root owns the final focused browser rerun, not this source review.

The accompanying navigation migrations in Access, MCP, resource-policy/latency, shared-host, refinement and Usage tests replace removed rail entries with actual command-palette routes. The reviewer found no weakening of their permission, persistence, timing, draft, focus, geometry or axe assertions. Shell-class and expected dark-color assertions were updated to the actual new frame/token values rather than removed; the phone chained-dialog and 44px target assertions were preserved.

## Agent Studio follow-up

Source review now includes `AgentStudio.tsx`, `AgentInspector.tsx`, `AgentWork.tsx`, `agents.css` and the root task-opening callback. One shared account-scoped query requests the latest 40 task summaries; per-role previews filter those records without per-row detail fanout. Counts and older-page limitations are explicit. Task status is not presented as specialist readiness or model quality. Registered role descriptions and server-observed tool availability remain distinct from selection and execution permissions; inspection alone does not select a profile or create a workspace.

Cached work/catalog data stays visible alongside refresh errors. Task opening is serialized, prevents duplicate navigation and uses the modal busy guard. Root fetches only the selected task through the existing authenticated API, compares navigation intent after the read, and then opens its actual conversation and task evidence. The API session epoch rejects obsolete account responses; composer options are not rewritten by inspection. No additional account disclosure, authority broadening or draft-loss finding was established.

**Corrected P2 focus finding:** activating the desktop preview's **See all recent work** button previously unmounted that focused button and the specialist pane without directing focus to the new work pane. The preview transition now records explicit focus intent, and a mode layout effect focuses the mounted work-filter select. Normal mode navigation buttons retain their own focus. The reviewer inspected the correction and the exact keyboard regression: Enter on the preview focuses the filter, while Enter on the persistent navigation button retains navigation focus. Root owns execution of that regression against the rebuilt source.

The reviewer inspected fixture browser tests for bounded requests/no detail fanout, filtering, preserved data on refresh failure, short landscape and failed/duplicate task opening. A subsequently added case creates an actual task on the disposable host and opens its recorded conversation/execution from Agents. These are useful assertions, not independently executed results here. Deliberately delayed opening across navigation/session changes still warrants explicit integration coverage. Root owns browser/build execution.

## Android findings and verified source corrections

| Finding | Severity | Correction inspected |
|---|---|---|
| Private conversations/files lacked secure-window protection and could appear in screenshots/Recents captures. | P2 | `MainActivity` sets `FLAG_SECURE` before content creation. Physical-device and dialog/Recents behavior still need acceptance. |
| Approval UI omitted the task and host/workspace scope, making identical relative operations in different workspaces indistinguishable. | P2 | Dialog shows exact origin, task ID/objective, durable task workspace ID/name, complete recorded arguments and allow-once/deny. Cloud egress explicitly describes external data transmission and possible cost. |
| Model provenance was unavailable in native approval review. | P2, part of scope finding | `approvalModel` binds task and exact tool proposal, chooses the latest applicable identity before that proposal, and reports unknown when evidence is absent. Later reroutes and other tasks cannot supply identity; test source covers these cases. |
| Automatic task inspection selected the oldest task from the server's descending list. | P2 correctness | Native selection now uses `firstOrNull`. |

The final transport source disables redirects and connection retries, uses system certificate/hostname verification, and attaches session/Origin/CSRF only to the chosen normalized HTTPS origin. No trust-all implementation, WebView authentication, embedded service credential, provider-secret retrieval or Access bypass was found. The supported connection is the separately authorized LAN listener; the API handshake must identify it as LAN. Public native Access authentication remains unsupported.

Cookie acceptance requires the expected name, Secure, HttpOnly, host-only scope, exact host and root path. `close()` is permanent and serialized against cookie writes; new requests reject closed clients. UI responses are checked against client/session epochs. The new transport tests cover saved-cookie policy and closed-client rejection; they do **not** prove real TLS redirects, delayed in-flight logout/account-switch races or device revocation.

Persisted cookies use Keystore AES-GCM with origin-associated data; CSRF and transcripts are not persisted. Backup/transfer exclusions, inert native text rendering and launcher-only component exposure were inspected. These controls do not establish protection from a compromised device/host administrator or prove OEM backup behavior.

## Native CI and remaining gates

The new `.github/workflows/android.yml` uses SHA-pinned checkout/upload actions, read-only repository permission, checkout without persisted credentials, runner JDK21, official SDK manager installation, wrapper hash checking and debug unit/lint/build tasks. It does not distribute an ephemeral CI-signed APK as the stable upgrade artifact. No secrets or deployment action were added. Hosted execution of this new workflow was not performed by this reviewer.

The reviewer independently fetched the [official Gradle 9.6.0 wrapper checksum](https://services.gradle.org/distributions/gradle-9.6.0-wrapper.jar.sha256) and compared it with the local JAR and checked-in checksum: `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7`, matching. Distribution checksum enforcement is present. Full reviewed transitive dependency-verification metadata remains deferred; fixed direct versions and a verified wrapper do not close that release gate.

Android source corrections are accepted for this **LAN-only debug preview**, subject to the explicitly open validation in [android-validation.md](android-validation.md): real authenticated LAN TLS and session flows; redirect/certificate/response-limit and cancellation tests; Android37 local-network permission behavior; key loss and backup/transfer; physical accessibility, secure dialogs/Recents and lifecycle behavior; stable production signing. Cloudflare OAuth/App Links and connected remote acceptance remain separate gated work. The reviewer did not build, install or inspect an emulator APK, and does not independently attest the implementer's artifact checksum or device observations.

Android's [secure-activity guidance](https://developer.android.com/security/fraud-prevention/activities) supports the secure-window control and explains platform limitations. No finite source review or fixture suite proves zero crashes, universal agent success or complete product security.
