# Owner acceptance ledger

Status: **INCOMPLETE — CONTINUATION REQUIRED**. Tests below are bounded evidence, not a declaration that the owner's complete phase is finished. The old final-evolution ledger remains intact.

| Owner scenarios | New-phase evidence | Remaining gate |
|---|---|---|
| 1. Web sign-in | Real disposable host browser pairing/session tests | Revalidate configured LAN and protected remote deployment |
| 2–3. Android sign-in and authorized host | Native real-backend HTTPS integration verifies enrollment, expiry and revocation | Installed-client/system-trust acceptance and remote Access flow |
| 4–5. Conversation and streaming | Existing real host API with deterministic browser provider; native implementation built | Real native connected streaming and unchanged real model task |
| 6–8. Agent task, plan, tools | Task feed/detail and execution pane tested; G1/G2 regressions pass | Native connected task/plan/tool presentation; further agent improvement/benchmark work is out of scope |
| 9–10. Files and diffs | Native Linux project matrix19/19; existing web functionality preserved | New project design implemented; native connected diff inspection and physical acceptance pending |
| 11–13. Approve, deny, cancel | Existing web guards retained; native exact-scope allow-once/deny/cancel implemented and reviewed | Native connected decisions, reauthentication, cancellation races |
| 14–16. Ongoing work/reconnect | Work view and cached evidence recovery regressions; native foreground SSE/reconciliation | Real network faults, app background/death, session/device revocation |
| 17–18. Notifications and approval entry | Existing browser notification controls preserved | Native privacy-aware notification transport and deep links |
| 19–20. Draft/back | Web drafts across Work/Chat/history and browser Back tests | Encrypted native drafts implemented with JVM regressions; process death/rotation/physical system Back acceptance pending |
| 21–23. Narrow/wide/themes | Work320–2560 and Agents320–1440, light/dark, axe and actual captures | Remaining full-product surfaces,200%zoom, Samsung Internet/Edge and physical keyboards |
| 24–25. Isolation/logout | Account-scoped feed and backend tests; native source review and cookie lifetime tests | Instrumented native in-flight logout/host switch, OEM Keystore/backup/device tests |
| 26. Router unchanged | No routing/provider/resource implementation diff; existing regression suite passes | Continue preserving architecture; no router research or tuning authorized |
| 27. Hardware admission | Existing host admission regressions in full1451-pass suite | Preserve existing admission; new agent work is out of scope |
| 28. Build/install APK | Real stable-debug-signed APK; emulator install succeeded | Production release signing process and physical installation |
| 29. Launch/connect installed app | Final emulator cold launch succeeded; secure-window flag confirmed | Authenticated connection and Samsung Galaxy S26 Ultra acceptance |
| 30. CI | Host local1451pass/1skip; native29pass/lint0errors9warnings; workflows configured | Exact published-head hosted results recorded in continuation |

Security review corrected private-screen capture, native approval scope/model provenance, stale native task selection, web navigation races, refresh-cache loss, deletion cleanup and focus gaps. [Independent review](independent-review.md) and [threat model](threat-model.md) distinguish source findings from tested operational boundaries. CodeQL/transitive Android dependency verification and production security acceptance remain open; zero scanner findings would not constitute proof of security.

No new public endpoint, port forwarding, firewall/router changes, production replacement, main merge or private signing-key publication occurred. The APK is a LAN testing preview with intentionally incomplete functionality; see [native validation](android-validation.md).

Latest APK: [0.2 testing milestone](android-0.2.md), retained-signature emulator upgrade and cold launch. These incremental results do not complete native remote sign-in, notifications, biometric step-up or physical-device acceptance. The PC preview background launch was rejected by automatic execution policy; no new running web URL has been delivered. Production is unchanged.
