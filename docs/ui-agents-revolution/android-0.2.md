# Android 0.2 testing milestone

**INCOMPLETE — CONTINUATION REQUIRED.** Native remote Access, background notifications, biometric approval step-up and installed-client authenticated acceptance remain open. This is a LAN testing APK, not completion of the Android directive.

Implemented native document picking, bounded UTF-8/PDF/DOCX preparation and explicit review of the destination host and workspace before upload through existing authorized APIs. Only an acknowledged relative attachment path enters the draft. An unconfirmed write clears the retryable upload and asks the user to inspect Projects before selecting the file again. Picking survives Activity recreation through a ViewModel target and rejects stale session/conversation results; process death requires selecting the file again.

Unsent text, its selected model/profile/workspace and uncertain-send state now persist as AES-GCM ciphertext using a separate Android Keystore key. Records are partitioned by exact origin, authenticated account and conversation. Revision tombstones reject delayed writes; logout/revocation deletes records and destroys the key. Successful initial sends save the destination draft before removing the new-conversation draft. Empty confirmed/cleared drafts release storage; **selection context without unsent text is session-only**. The bounded vault retains at most100 actual drafts. Android backup/transfer excludes this storage. Transcripts and uploads are not cached offline.

Independent review found and corrected an unreachable attachment action, picker recreation loss, insufficient destination detail, unconfirmed-upload retry, incomplete private-state clearing on failed session restoration and empty-record quota accumulation. See [review](independent-review.md). No backend authorization, transport trust or routing changes.

## Actual verification

- `RELAY_NATIVE_INTEGRATION=1` with Gradle `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug`: exit0,26s; **29 tests across8 classes,0 failures/errors/skips**. Includes the actual isolated HTTPS Relay API lifecycle plus transport/security and encrypted-draft/attachment tests.
- Lint:0 errors/9 warnings. Warnings concern synchronous preference durability/style, an empty superclass call and a redundant resource qualifier. Synchronous commits are intentional to confirm persistence before a send; draft writes use the IO dispatcher. Device-level lifecycle tests remain pending.
- Installed over the previous preview on the existing API36.1 emulator with `adb install -r`: Success. Cold launch: `Status: ok`,1797ms; UIAutomator confirmed native HTTPS-address, invitation and connection controls. This does **not** establish authenticated installed-app or physical Samsung connectivity.
- `apksigner verify --print-certs` passed; same retained debug certificate SHA256 `9b855084b949dd2048daa45d0d17a322210c7031d168b12d9d3cb52096cc9b8d`. No key was copied or committed.
- Raw local evidence: `output/ui-agents-revolution/native-0.2-final.log`, `native-0.2-ui.xml`, Gradle XML/lint reports. Prior red tests were written before the helper implementation; later review regressions were added during integration. No independent device test is claimed.

## Actual artifact

`release/android/relay-0.2.0-lan-preview-debug.apk` — **12,645,234 bytes**; version0.2.0-lan-preview/code2; minimum Android8/API26; target37.

SHA256: `4d34e0df0c18bd96d3167c3a72d9a473ed22308a0161d31585facf937a1a649a`.

The file and adjacent checksum exist locally and are deliberately Git-ignored. Transfer privately to the phone, open it in Files and permit installation from that application only as needed. Install over code1 with the same signing certificate; do not uninstall for a signature mismatch. Connect only to an already configured, Android-system-trusted HTTPS LAN endpoint using a fresh owner-issued account invitation. No public download release or production signing identity was created.
