# Android0.4 LAN delivery and acceptance

Testing release,13 October2026. Full product phase remains **INCOMPLETE — CONTINUATION REQUIRED**.

- APK: `release/android/relay-0.4-lan-debug.apk`,13,085,533bytes, version0.4-lan/code4, minAndroid8/API26.
- SHA256: `78d847910396eeeff4fa7355b86c44ca6123d724c1cbbd1e69816e348d4ad60e`.
- Verified unchanged debug signer SHA256: `9b855084b949dd2048daa45d0d17a322210c7031d168b12d9d3cb52096cc9b8d`.
- Current host: `https://10.100.102.13:4443`; PC owner: `http://127.0.0.1:4327`. Exact-IP public CA is embedded only in the optional debug profile. See [address/certificate evidence](lan-address-renewal.md).

## Changes

Private task notifications are opt-in, require Android permission and contain no objective, transcript or code. An encrypted ledger binds up to20 watches for seven days to the exact origin/account/session. Foreground changes and bounded15-minute WorkManager polling share authenticated reads; Android may delay background work. Notification taps contain only random lookup tokens and reauthenticate before retrieving the task. Logout/revocation clears watches and alerts. No third-party push or server changes. [Notification design and limits](../../android/notifications.md).

Independent review caught overlapping-read notification regression; serialized network reads/publication and sticky terminal outcomes fixed the observed failing regression. After tasks settle, background checks still authenticate to detect later revocation. Notification lifetime does not extend the original watch expiry.

Offline cold start previously deleted a valid saved session. Failed restoration now retains confirmed same-origin encrypted credentials while clearing private UI. Retry uses ordinary TLS/session validation; Forget and401 revoke local credentials/drafts/notifications. This also covers successful invitation redemption followed by a failed list request. Five meaningful encrypted-session recovery tests cover the boundary. Native navigation now uses original outline icons with existing accessible labels.

## Verified

- Coordinated Gradle generator/tests/debug APK/lint build succeeded in44seconds.46JVM tests,0failures/errors/skips, including the opted-in real isolated Relay HTTPS backend.51generator checks. Lint0errors/10warnings.
- Independent source/security reviews accepted explicit LAN host, notifications and offline recovery; no remaining blocking finding in this increment.
- APK signature verified; installed as an update in API36.1 emulator. Cold launch2512ms. Real enrollment against the currentIP13 host used normal platform TLS and displayed `yarden-pc · Live`.
- Android notification permission was denied, then requested and granted through the actual UI.
- Installed app submitted `Reply with exactly: Relay Android connected.` with the explicitly selected existing9B model. Task `12d01e75-d037-4f71-b839-7253c784f436` completed in64.8seconds with exactly `Relay Android connected.`; real response appeared in native chat. No routing/resource-policy changes or cloud usage.
- OS delivered a generic `Task completed` notification, `VISIBILITY_SECRET`, with no objective in its content. After the app process was killed (oldPID8256 absent), tapping the actual OS notification startedPID9074, restored the secure session and opened the correct conversation/task/result.
- With emulator Wi-Fi and mobile data disabled, forced cold launch showed only the fixed host/retry/forget recovery UI. Restoring networking and pressing Retry reauthenticated without another invitation and recovered the exact unsent draft `Keep this offline draft.`.

Evidence: ignored `output/ui-agents-revolution/android-0.4-build.log`, `native-0.4-generation-evidence.json`, `native-0.4-notifications.txt`, `native-0.4-completed.xml`, `native-0.4-cold-notification-tap.xml`, `native-0.4-offline.xml`, `native-0.4-reconnected-draft.xml`. UIAutomator startup briefly returned no root; the helper now rejects stale XML and the subsequent fresh dump verified navigation. No screenshots are claimed for secure native screens.

## Remaining boundaries

Physical Samsung installation, phone-browser CA trust, natural background scheduling latency, secure lock-screen appearance, full approval/project/device workflows and comprehensive accessibility/performance acceptance remain separate gates. This is not production release signing. Native Cloudflare Access authentication, biometric step-up, richer project/diff workflows and the complete premium native product remain incomplete. New native tasks retain the existing local-only/read-only scope. Do not claim full completion from this functional testing APK.
