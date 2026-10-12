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

Only exact HTTPS origins are accepted. There is no HTTP fallback, custom CA bypass, Access service secret, browser-cookie scraping or owner API access. App sessions are protected with Android Keystore; activity screens are secure and ordinary screen capture is disabled. The app keeps drafts/transcripts in memory and does not provide background push or offline task submission.
