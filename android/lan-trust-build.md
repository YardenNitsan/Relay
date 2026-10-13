# Host-specific LAN build verification

13 October 2026. Authorized build profile for PC `10.100.102.30`; no Cloudflare, forwarding, runtime trust override or system-wide certificate-store modification. Owner-provided public CA input: `C:/Users/yarde/AppData/Local/RelayDispatchLan/tls/relay-lan-ca.pem`. Its private key remains outside the repository and is never a build input.

## Implementation boundary

- `build-tools/LanTrustConfig.java` runs only in the build JDK. It accepts one bounded public PEM/DER signing root, validates its dates/CA/key usage/self-signature, and emits DER plus fixed XML. Arbitrary host strings and XML injection are rejected by exact equality with `10.100.102.30`; no arbitrary host is interpolated into XML.
- `-PrelayLanCaFile=<path>` registers ignored generated resources in the **debug** source set only. The debug manifest selects `@xml/relay_lan_network_security_config`; base trust remains system-only and private CA trust is confined to the literal IP with `includeSubdomains="false"`. That IP uses only the supplied dedicated CA. Cleartext remains false everywhere.
- Omitting the property keeps the original system-only resource and excludes generated resources even when stale output remains on disk. Release never selects the generated profile. No `debug-overrides`, user CA store, hostname verifier, `RelayClient` trust hook, or new runtime permission logic was added.
- Version code 3, name `0.3-lan`. Existing local debug signing identity is retained; the build profile does not configure a key. No default host is prefilled.

## Observed checks

| Check | Result |
|---|---|
| Generator regression task | 22 passed: PEM/DER equivalence, empty/oversize/trailing/bundle/private-key rejection, leaf/expired/wrong-key-usage rejection, exact-host rejection cases, XML trust scope and generated output |
| First opt-in debug build/tests/lint | Passed; 28 JVM tests and one intentionally skipped integration test |
| Default debug immediately after opt-in, **without cleaning** | Build passed; `aapt2` resource table contained system `network_security_config` only, no `relay_lan` CA or XML; packaged manifest selected system resource |
| Final opt-in build with `RELAY_NATIVE_INTEGRATION=1` | Passed in 18s; all 29 JVM tests passed, including isolated real-host fixture; 22 generator checks passed |
| Final compiled resource inspection | `aapt2 dump xmltree` verified literal IP, `includeSubdomains=false`, base system trust, exact-domain raw CA and cleartext false |
| Release manifest processing while opt-in property supplied | Passed; merged release manifest remained `@xml/network_security_config` (not a full release APK/signing claim) |
| Lint | 0 errors, 10 warnings. One extra `UnusedResources` warning is the retained default system XML in the opt-in variant; the other 9 are existing findings |
| Independent source review | Accepted; installed Android trust behavior remains a separate acceptance gate |

The first attempted Gradle script compilation failed because Kotlin's `java` extension shadowed `java.io.File`; the corrected import and AGP resource-directory registration passed all builds above.

Final APK: `android/app/build/outputs/apk/debug/app-debug.apk`.

- APK SHA-256 after the logout fix below: `5e3d7c769ada6ed12f86d222315e83460fba6e982de44f904813805ce8eba64c`
- Signer SHA-256: `9b855084b949dd2048daa45d0d17a322210c7031d168b12d9d3cb52096cc9b8d`

The build tools and tests are not packaged runtime code. Generated resources/classes remain under ignored `app/build`; Kotlin's local `.kotlin` cache is now ignored too. No private key, certificate fixture or developer keystore was committed.

## Remaining device acceptance

The initial build checks above did not prove that an installed Android client applies this literal-IP network configuration. Parent later reported a successful emulator connection, described below. Rejection of an alternate address/untrusted certificate and physical-phone installation/connectivity remain separate acceptance checks. Parent owns those checks and the delivered artifact copy. Do not present this document as physical-device acceptance.

## Task outcome display follow-up

Parent subsequently reported a real installed-emulator connection to the LAN host with this scoped CA and actual native task submission. The model paused; the native screen exposed status and event types but omitted its recorded reason. `MainActivity.TaskPanel` now shows nonempty `task.error` and `task.result` using the existing JSON label semantics. Both are selectable plain text, capped at 8,000 and 16,000 characters respectively with an explicit full-web-record note if truncated. It renders no raw event payloads and changes no task/backend/model behavior. The Account version label now matches `0.3-lan`.

Same-profile rebuild passed in 39s with all 29 opted-in JVM tests, lint 0 errors/10 warnings and unchanged signer/version code. The prior trust-profile APK hash `439cda84110e8695a8ae75b42adcfdd720fd649a2ee706f5d7212904674d4ba6` is superseded by the hash above. This small presentation change adds no redundant implementation-mirroring test; parent owns installed-emulator inspection of the recorded task error/result. Physical-phone acceptance and negative device TLS cases remain separate from the reported successful emulator connection.

## Reproduced logout crash and transport fix

Parent reproduced an installed-emulator fatal `NetworkOnMainThreadException`: Conscrypt TLS socket close → OkHttp pool eviction → `RelayClient.close()` → the logout coroutine's `finally`. No speculative cleanup changes were made before receiving this stack. TaskPanel rendering was unrelated.

`RelayClient.close()` now immediately and idempotently marks the client closed and clears cookie/CSRF, then submits cancellation and pool disposal to that client's existing OkHttp worker executor. Cleanup is independent of ViewModel cancellation, including `onCleared`. Coroutine and SSE cancellation hooks likewise schedule socket cancellation on that executor. A synchronized enqueue admission check rejects requests whose headers were constructed before close, and JSON completion rechecks closed state. StrictMode, platform trust, hostname verification and exception policy were not relaxed. No runtime TLS injection hook was added.

A new actual-HTTPS regression established a pooled idle TLS socket and gated executor dispatch. It failed on old code (expected one queued cleanup, observed zero), then passed with immediate credential/request rejection, idempotence, an open socket before release, and actual socket closure on a different thread afterward. The existing in-flight close test's header-only latch could race response parsing; its fixture now delivers one byte then throttles, and waits for body-read start before closing. Its cancellation and late-cookie assertions remain intact. All 10 focused transport cases passed.

Final same-profile build passed in 26s: **30/30** JVM tests including the isolated real-host integration, lint **0 errors/10 warnings**, same version code and signer, and scoped diff check. The intermediate outcome-display APK `47326f77a909237240b8506b8479c15df56a62ba604d3963bdab62378d0e56fd` is superseded. Independent review found no blocking source issue. Parent owns the installed Android logout/logcat recheck; JVM results alone do not prove Conscrypt main-thread acceptance.

Supporting references: [OkHttp cancellation and socket closure](https://github.com/square/okhttp/blob/master/okhttp/src/commonJvmAndroid/kotlin/okhttp3/internal/connection/RealCall.kt) and [Android NetworkOnMainThreadException](https://developer.android.com/reference/android/os/NetworkOnMainThreadException).

References inspected: [Android Network Security Configuration](https://developer.android.com/privacy-and-security/security-config) (per-domain CA, PEM/DER, no CT for custom anchors) and [Gradle task declarations](https://docs.gradle.org/current/userguide/implementing_custom_tasks.html). The app retains normal platform chain, expiry and IP SAN checks.

## Final installed logout acceptance

Root installed the final APK (SHA2565e3d7c769ada6ed12f86d222315e83460fba6e982de44f904813805ce8eba64c) over the earlier build and cold launch succeeded1048ms. A fresh invitation authenticated against the running10.100.102.30:4443 host. After Account sign-out confirmation, UIAutomator verified Connect securely returned and the private account label was absent; filtered AndroidRuntime log had no fatal exception. The actual prior NetworkOnMainThreadException was reproduced and preserved before the fix. Logs/XML are ignored output/ui-agents-revolution/lan-logout-crash.log, lan-logout-green.log and lan-logout-green.xml. Emulator stopped; PC web/server remain running. Root independently verified the APK signer and30JUnit XML tests,0failures/errors/skips. Physical Samsung validation remains pending.
