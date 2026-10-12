# Native Android preview validation

Date: 12 October 2026. Source worktree: `Relay-revolution`, branch `modernization/ui-agents-revolution`, derived from `fda18f4`. This is a real native Kotlin/Compose **LAN-only debug testing APK**. A later [isolated real-host JVM integration](android-integration.md) verifies the unchanged native transport against actual LAN APIs. Authenticated installed-app/device connectivity, remote Access login, physical device and production release acceptance remain unverified.

## Delivered artifact

- Package: `app.relay.nativeclient`; version name `0.1.0-lan-preview`; version code `1`.
- APK: `release/android/relay-0.1.0-lan-preview-debug.apk`, 16,713,796 bytes, ignored by Git.
- SHA-256: `9c253dc1e642d4b41ad4def9d4cf9a8f2ca42362c34172bf8452881b69733a8f`.
- Matching checksum: `release/android/relay-0.1.0-lan-preview-debug.apk.sha256`.
- `apksigner verify --verbose --print-certs` succeeds, APK Signature Scheme v2, one RSA2048 signer.
- Certificate SHA-256: `9b855084b949dd2048daa45d0d17a322210c7031d168b12d9d3cb52096cc9b8d`.
- Signing uses the existing user `.android/debug.keystore`. No private key is copied into the repository. This debug identity is stable on this development host, not a production release identity. Builds on other machines normally have a different debug signature and cannot replace this APK in place without the same key or uninstalling it.

## Implemented scope

The native UI uses real existing contracts for invitation login, restored session, logout, conversation history/send, foreground streaming, task details/cancel, allow-once/deny approvals, assistant capability browsing/selection, local model choice, workspace/file browsing and read-only file display. It includes loading, empty and safe error states, in-memory drafts, bounded live text, wide-screen conversation navigation and light/dark system themes. App content contains no fixtures or demo data. New tasks deliberately request read-only/local-only execution and zero cloud spending; the host remains the authority. Existing tasks may have broader pending approvals and their exact consequences are shown.

The connection must be the owner's separately configured LAN HTTPS origin, with a certificate accepted by Android's system trust store. Exact LAN DNS names are allowed; the API must return `connection: "lan"`. The app rejects HTTP, unsafe origin syntax, redirects and remote login pages. It never calls owner pairing, obtains provider secrets, uses a service token or bypasses Cloudflare Access. Existing configured public access remains a browser workflow. No listener, firewall, DNS, trust store, Worker route or production configuration was changed for this increment.

Session cookies are encrypted with an Android Keystore AES256-GCM key and exact-origin associated data; CSRF is fetched from the session and held in memory. Backup/device-transfer exclusions and `FLAG_SECURE` protect normal storage/presentation paths. Closing a client is permanent; callback cookie writes and closure are serialized. Session epochs discard obsolete UI responses, and switching/logout clears in-memory state. Logout does not cancel admitted host work.

## Pinned build and provenance

| Component | Resolved version |
|---|---|
| Gradle / Android Gradle Plugin | 9.6.0 / 9.4.0 |
| Kotlin / Compose compiler | 2.4.21 |
| Compose BOM / core / Material3 | 2026.09.00 / 1.12.1 / 1.4.0 |
| Material3 adaptive / Activity | 1.3.0 / 1.13.0 |
| Lifecycle / coroutines | 2.11.0 / 1.11.0 |
| OkHttp | 5.5.0 |
| compileSdk / targetSdk / minSdk | 37 / 37 / 26 |
| Build tools / local JDK | 36.0.0 / Android Studio JBR21.0.9 (Java17 bytecode) |

Official current sources were inspected: [AGP9.4 compatibility](https://developer.android.com/build/releases/agp-9-4-0-release-notes), [Kotlin releases](https://kotlinlang.org/docs/releases.html), [Compose BOM](https://developer.android.com/develop/ui/compose/bom), [adaptive releases](https://developer.android.com/jetpack/androidx/releases/compose-material3-adaptive), [Lifecycle releases](https://developer.android.com/jetpack/androidx/releases/lifecycle). Gradle scripts/JAR came from the official Gradle9.6.0 tag; wrapper JAR and distribution digests were compared with official Gradle checksum metadata. The pinned wrapper JAR SHA-256 is `497c8c2a7e5031f6aa847f88104aa80a93532ec32ee17bdb8d1d2f67a194a9c7`; distribution SHA-256 is `bbaeb2fef8710818cf0e261201dab964c572f92b942812df0c3620d62a529a01` and is enforced by `distributionSha256Sum`.

Google/Maven Central/Gradle Plugin Portal are the only configured repositories. SDK37 was downloaded by AGP through the official SDK manager using already accepted local licenses. No Android skill package was installed or executed. **Full transitive Gradle dependency verification metadata is deferred:** downloading and accepting a fresh set of hashes is not an independent review of dependency provenance. This remains a release supply-chain gate, despite fixed direct versions and the verified wrapper.

## Commands actually verified

From repository root in PowerShell:

```powershell
$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA/Android/Sdk"
& ./android/gradlew.bat -p android :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
& "$env:ANDROID_HOME/build-tools/36.0.0/apksigner.bat" verify --verbose --print-certs android/app/build/outputs/apk/debug/app-debug.apk
Get-FileHash release/android/relay-0.1.0-lan-preview-debug.apk -Algorithm SHA256
```

APK source build: `BUILD SUCCESSFUL`, 51 tasks, 27 seconds. All **12 original JVM tests pass**: five protocol/encryption/error tests, three SSE framing/size tests, two proposal-model provenance tests and two cookie-policy/client-closure tests. Relevant implementation stubs were observed failing before fixes. Approval tests prove later reroutes and other tasks cannot rewrite the proposed model identity; cloud consent names the requested model. Cookie tests prove name, Secure, HttpOnly, host-only and path policy; these original tests alone are not a real TLS/HTTP acceptance suite. One initial cookie test hit OkHttp's Android-only public-suffix loader in the JVM harness; the test was corrected to use an explicit same-host Domain attribute, which exercises the intended host-only rejection without that unrelated Android dependency. Subsequent real local TLS tests are recorded below.

Lint: **0 errors, 6 warnings**. Remaining findings are KTX/style suggestions, redundant minSdk resource qualifier/empty super call, and deliberate synchronous preference deletion for logout durability. Reports: `android/app/build/reports/tests/testDebugUnitTest/` and `android/app/build/reports/lint-results-debug.html` (ignored generated evidence).

Actual emulator: existing `Medium_Phone_API_36.1`, isolated read-only headless instance on `emulator-5580`. Final APK reinstall succeeded; cold start returned `Status: ok`, 2,372ms. UI hierarchy confirmed the real disconnected connection fields and remote-login limitation. `dumpsys window` confirmed the final activity has `SECURE`; final `screencap` was inspected and app content was blacked out. These are emulator observations, not proof across manufacturers or secure-dialog/Recents acceptance on real hardware. An earlier disconnected login screenshot predates the secure-window correction and is not a screenshot of the final build. No credentials were entered. The isolated emulator is shut down after checks.

## Additional local HTTPS transport tests

After the artifact freeze, seven new `HttpsTransportTest` cases passed against the **unchanged production runtime**. Focused command: `./android/gradlew.bat -p android :app:testDebugUnitTest --tests '*HttpsTransportTest' --console=plain` with the same environment above. Result: `BUILD SUCCESSFUL`, 16 seconds; JUnit XML reports7 tests,0 failures,0 errors. No APK assembly was run for this test-only increment; the delivered APK was rehashed and remains exactly the SHA-256 above.

`mockwebserver3:5.5.0` and `okhttp-tls:5.5.0` are pinned `testImplementation` dependencies only. Their exact official tagged [MockWebServer README](https://raw.githubusercontent.com/square/okhttp/parent-5.5.0/mockwebserver/README.md) and [TLS README](https://raw.githubusercontent.com/square/okhttp/parent-5.5.0/okhttp-tls/README.md) were inspected before use. Each test creates ephemeral certificates in memory and binds its HTTPS peers to loopback with random ports. Test code replaces the private OkHttp instance by reflection with its existing `newBuilder()`, changing only trust to the test CA, DNS to the explicit `relay.test` loopback peer, and event observation. Existing redirect/retry/timeouts and the real hostname verifier remain intact. No production test hook, permissive trust manager, OS CA installation, certificate asset, private key or alternate runtime endpoint is introduced.

Observed coverage:

- Trusted TLS invitation/session exchange followed by a real POST with exact Origin, session Cookie and returned CSRF, with no bearer header; the server records an actual TLS handshake.
- Untrusted CA and trusted-but-wrong-hostname certificates fail before HTTP credentials reach the peer.
- HTTP302/307 responses do not forward a session to a second HTTPS origin, and redirect response cookies are not accepted.
- Successful responses over4MiB and error responses over16KiB fail before new cookies are accepted; no automatic retry occurs.
- Coroutine cancellation after HTTPS response headers cancels the pending body/socket call and preserves the existing cookie.
- Client closure after HTTPS response headers cancels the pending call, clears the cookie, rejects future requests and does not adopt the delayed response cookie.

These are actual local socket/TLS tests of the production transport, using explicitly synthetic API responses. They do not authenticate to Relay, exercise Android's real trust store, test ViewModel logout/account-switch reduction or establish an Android instrumented result. No runtime defect was found and no runtime behavior changed. Independent source review found no blocking issue in the harness or test-only dependencies; it inspected the focused XML without performing an independent build.

After the first host inference trial finished, the complete native JVM suite was rerun together with `./android/gradlew.bat -p android :app:testDebugUnitTest --console=plain`: **19 tests passed across5 classes,0 failures,0 errors**, exit0, `BUILD SUCCESSFUL in 7s` (7.70s command wall time). Only the test task executed; assembly/lint were not requested. The delivered APK hash remains unchanged. Local builds were stopped before the next inference trial.

## Open acceptance and feature limits

- The isolated JVM real-host integration now verifies invitation/session/history/send/cancel/scoped-files/SSE/logout/revocation/expiry with real API policy; all20 native JVM tests pass together. Configure a trusted LAN TLS listener separately through existing owner procedures and repeat the workflows in the installed app, including profile selection and approval UI. The fixture is not actual Android system-trust or configured-LAN acceptance.
- Test Android37 `ACCESS_LOCAL_NETWORK` request, deny/regrant, background/foreground and OS revocation on Android37. The app gates ViewModel/session restoration behind permission; the API36.1 emulator cannot verify the new permission. [Official local-network requirements](https://developer.android.com/privacy-and-security/local-network-permission)
- Repeat TLS/redirect/limit/cancellation tests on Android's instrumented transport; test same-origin redirect refusal, expired/revoked host sessions, and deliberately delayed responses across actual ViewModel logout/host/account switches. The JVM loopback TLS coverage above is not equivalent to those device/session-state checks.
- Verify Keystore key loss/restore and OEM transfer exclusions, physical Recents/screenshots/dialog privacy, TalkBack, large fonts, IME, landscape and Hebrew/RTL on actual phones. No biometric app lock is implemented.
- Conversation follow-up POST is not idempotent in the existing host. The app does not retry mutations automatically; uncertain delivery requires user review. There is no persistent mobile outbox or background push. Streaming/reconnect snapshots run only while foregrounded.
- Remote Access Managed OAuth, registered public-client PKCE flow, verified HTTPS App Links and actual gateway bearer-to-assertion proof remain gated work. No remote native support is advertised.
- Native file writes/publication, branch integration, owner administration, attachment upload, production signing, Play distribution, verified transitive dependencies and Navigation3 back-stack migration are not implemented. The current native UI provides bounded tab navigation and Back handling.

The APK is a reviewable testing artifact with useful native code and bounded verification. It is not evidence that the full native product or connected acceptance is complete.

## Latest native0.2 checkpoint

See [Android0.2 milestone](android-0.2.md) for the current29-test/build/lint result, retained-signature APK, emulator upgrade/cold launch and exact checksum. This supersedes earlier attachment and in-memory-only draft limitations above; it does not close remote, notifications, installed authenticated connection or physical-device gates.
