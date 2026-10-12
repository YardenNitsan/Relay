# Relay native LAN preview

Real Kotlin/Compose Android client for the existing Relay LAN HTTPS listener. Requires Android8/API26 or later, a system-trusted host certificate, an approved Relay account and a five-minute one-use invitation issued by the host owner. Android17/API37 additionally requests local-network permission before connecting. Cloudflare remote native sign-in is not implemented.

See [validation, artifact and limitations](../docs/ui-agents-revolution/android-validation.md), [architecture](../docs/ui-agents-revolution/android-architecture.md) and [threat model](../docs/ui-agents-revolution/threat-model.md). No host configuration or API changes are part of this app.

Build from repository root with JDK17+ and Android SDK37/build tools36.0.0:

```powershell
$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA/Android/Sdk"
./android/gradlew.bat -p android :app:testDebugUnitTest :app:lintDebug :app:assembleDebug --console=plain
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. The locally delivered testing APK and checksum are in ignored `release/android/`; its signature is recorded in the validation report. Keep the existing user's `.android/debug.keystore` outside the repository for consistent local testing updates. This is not production release signing.

The separate [Android CI workflow](../.github/workflows/android.yml) builds and checks this module on Ubuntu, verifies the wrapper and publishes verification reports. Its ephemeral runner debug key is not the delivered update identity; CI does not distribute its APK as an upgrade. A configured workflow is not a claim that a hosted run has passed.

For the opt-in real Relay backend test, install repository npm dependencies with the lockfile, make Node24+ available, set `RELAY_NATIVE_INTEGRATION=1`, then run `./android/gradlew.bat -p android :app:testDebugUnitTest --console=plain`. The latest opted-in run passes29 tests including a real isolated HTTPS LAN API lifecycle. The test creates only a loopback fixture and deletes its temporary workspace; it does not connect the installed APK or configure your host. See [integration boundaries and evidence](../docs/ui-agents-revolution/android-integration.md).

Only exact HTTPS origins are accepted. There is no HTTP fallback, custom CA bypass, Access service secret, browser-cookie scraping or owner API access. App sessions are protected with Android Keystore; activity screens are secure and ordinary screen capture is disabled. Unsent drafts and their context are encrypted with a separate Keystore key and removed on sign-out/revocation; empty-text selection context remains session-only. Transcripts remain in memory. Native file picking supports reviewed text/PDF/DOCX copies. Background push and offline task submission are not available. See [0.2 verification and actual checksum](../docs/ui-agents-revolution/android-0.2.md).

## Install this testing APK

1. Transfer `release/android/relay-0.2.0-lan-preview-debug.apk` to the phone using USB or your usual private file transfer.
2. Open it in the phone's Files application. If Android requests permission, allow installation from that file application, install Relay, then turn that installation permission off again.
3. Open Relay on the same approved network as the configured host. Enter its exact HTTPS LAN origin and a fresh one-use account invitation from the host owner. The certificate must already be trusted by Android; this app cannot connect to an untrusted self-signed certificate. Android 17 also requires the local-network permission.
4. Keep the existing web client available: this preview does not support native remote Access login or background notifications.

For an existing preview installation signed with the recorded certificate, install the next APK over it to preserve app storage. A different signing identity cannot update this installation. Do not uninstall to resolve a signature mismatch unless you intend to discard its stored session and local state. Future builds must increase `versionCode` and retain the established testing key or explicitly migrate to a production signing process.

Optional USB developer installation: `adb install -r release/android/relay-0.2.0-lan-preview-debug.apk`. Actual Samsung Galaxy S26 Ultra installation and host connectivity still require physical-device acceptance.

Troubleshooting invitation expiry, certificate trust, uncertain delivery and signature mismatches: [client testing guide](../docs/ui-agents-revolution/client-troubleshooting.md).
