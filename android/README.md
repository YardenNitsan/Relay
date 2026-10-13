# Relay for Android ? LAN testing build

Native Kotlin/Jetpack Compose client for the authenticated Relay host. Minimum Android8/API26; current version0.4-lan/code4. The host performs inference and enforces permissions. The APK contains no account credentials or private signing/TLS keys.

## Install and connect

1. Transfer `release/android/relay-0.4-lan-debug.apk` to your phone, open it in Files and temporarily permit installation from that file app if requested. Disable that installation permission afterward.
2. Use the same LAN as the PC and enter **`https://10.100.102.13:4443`** in Relay. This optional host-specific APK embeds the dedicated public CA for this exact IP; the native app needs no device-wide CA installation.
3. On the PC open **`http://127.0.0.1:4327`**. In **More ? Access & remote connections**, create a fresh invitation for **LAN phone** and enter it in the app. Invitations are one-use/five-minute. Never transfer owner pairing credentials to a phone.
4. Choose the existing9B model for the manually verified local chat path. Hardware admission remains enforced. Enable optional private task notifications from Account; Android permission is required.

Actual APK SHA256: `78d847910396eeeff4fa7355b86c44ca6123d724c1cbbd1e69816e348d4ad60e`,13,085,533bytes. Bundle: `release/android/relay-0.4-lan-install.zip`, including APK/checksum/public browser CA/installation instructions. These are existing ignored local artifacts, not files provided by cloning the repository. [Build and installed evidence](../docs/ui-agents-revolution/android-0.4.md).

The retained debug signer is `9b855084b949dd2048daa45d0d17a322210c7031d168b12d9d3cb52096cc9b8d`. Install updates over the existing app to preserve storage. Do not uninstall to work around an unexpected signature mismatch. Keep the original user's `.android/debug.keystore` private and securely backed up; other developers/CI have different debug keys. Production release signing is not configured. Version0.3 targeted the previousIP30; Forget its saved connection and enroll with a new invitation forIP13.

Optional USB install: `adb install -r release/android/relay-0.4-lan-debug.apk`. Physical Samsung installation is not yet verified; installed emulator launch, actual LAN sign-in/AI response, private notification/cold tap and offline draft-preserving recovery are verified.

## Reproduce the build

Use the pinned Gradle wrapper with Android SDK37/build-tools36.0.0 and a supported JDK (this host uses Android Studio's JBR):

```powershell
$env:JAVA_HOME='C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME="$env:LOCALAPPDATA/Android/Sdk"
$env:RELAY_NATIVE_INTEGRATION='1'
./android/gradlew.bat -p android '-PrelayLanCaFile=C:/Users/yarde/AppData/Local/RelayDispatchLan/tls-10-100-102-13/relay-lan-ca.pem' '-PrelayLanHost=10.100.102.13' :app:checkLanTrustConfig :app:testDebugUnitTest :app:assembleDebug :app:lintDebug --console=plain
```

Both optional properties must be supplied together; quote them in PowerShell. Relative certificate paths resolve from `android/`. The generator accepts one bounded valid public signing root and canonical private IPv4, rejecting bundles, private-key PEM, malformed/injected/public addresses and expired certificates. Android validates the actual server's chain/expiry/exact SAN normally. Generated public resources are debug-only and ignored; release and builds with neither property retain system-only trust. Do not disable certificate or hostname validation. [Trust design/history](lan-trust-build.md).

Output: `android/app/build/outputs/apk/debug/app-debug.apk`. The opted-in real-backend JVM test also needs locked npm dependencies and Node24+. It creates an isolated disposable HTTPS fixture; it never configures production. Latest coordinated run:46JVM tests/0failures/errors/skips,51generator checks, build/lint passed (0errors/10warnings). [Android CI](../.github/workflows/android.yml) builds/tests on Ubuntu and publishes verification reports; its ephemeral signing identity is not an upgrade artifact.

## Privacy and behavior

Only exact HTTPS origins and authenticated LAN sessions are accepted. No redirects, cleartext fallback, Access service secret or browser-cookie scraping. Keystore protects sessions and per-origin/account drafts; backups and ordinary screen capture are disabled. Logout/revocation clears private state. Offline startup hides private UI and offers Retry using the protected saved session or Forget; Retry revalidates with the host before showing work. Failed unconfirmed uploads/sends remain explicit uncertain outcomes.

Chat/history, model/profile choice, task initiation/status/cancellation, approvals and permitted workspace/file browsing use the existing host APIs. New tasks remain local-only/read-only with zero cloud spending. Attachments use Android's file picker and a reviewed text/PDF/DOCX copy flow. [Attachment/draft design](../docs/ui-agents-revolution/android-0.2.md).

[Private task notifications](notifications.md) watch up to20 submitted/opened tasks for seven days. Generic completion/failure/approval alerts hide task text and use secret lock-screen visibility. Tap reauthenticates before opening the task. Background polling is15minutes or later under Android battery/network policy, not instant push; no mandatory messaging service. Foreground events update immediately.

Native Cloudflare Access authentication, biometric step-up, richer project/diff workflows and full premium-client acceptance remain incomplete. System light/dark themes are supported. Android17/API37 also requests local-network permission. For phone-browser CA trust, see [LAN setup](../docs/ui-agents-revolution/lan-local-setup.md); this is a deliberate device trust change, not a certificate-warning bypass.

Troubleshooting: [client guide](../docs/ui-agents-revolution/client-troubleshooting.md). Architecture/security: [native architecture](../docs/ui-agents-revolution/android-architecture.md), [threat model](../docs/ui-agents-revolution/threat-model.md). **INCOMPLETE ? CONTINUATION REQUIRED** for the full product phase.
