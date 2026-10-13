# Dispatch web and Android0.2 testing milestone

## Current0.4 checkpoint ?13 October2026

Current Native0.4 andIP13 LAN delivery supersede prior running-state/artifact claims below. Real installed chat now generates a response; opt-in private task alerts, authenticated cold notification taps and offline session/draft recovery are verified.46JVM/51generator checks, build/lint pass. [APK/checksum/limits](android-0.4.md), [LAN setup](lan-local-setup.md). Full product remains incomplete.

## 13 October: Native0.3 and running Dispatch LAN preview

The owner-authorized private preview is running at https://10.100.102.30:4443 with owner http://127.0.0.1:4327. Installed native0.3 verifies scoped-CA sign-in, genuine task events, history, restoration, cancel and corrected logout.30JVM tests and40launcher/TLS tests pass (one platform skip); full phase remains incomplete. See [exact artifact/checksum, running state and limitations](lan-local-setup.md) and [native build/crash regression evidence](../../android/lan-trust-build.md). Earlier0.2/no-listener statements below are historical.

**INCOMPLETE - CONTINUATION REQUIRED.** This branch is not a production deployment or completion of the owner directive.

Dispatch now provides a new task-led entry point and navigation, document-style conversations and writing-first composer, redesigned Projects and Models, Agent Studio, grouped More navigation and preference-document Settings. History, Memory, Schedules, Access, external clients, Google Workspace, MCP, host diagnostics, usage and signed-out entry have matching readable lists/documents and compact layouts. Existing actions, scoped API calls, guarded drafts, source bytes, consent and authorization remain intact. No new frontend dependency or routing change was introduced.

Core/supporting rendered checks, reproduced defects and exact corrected reruns are recorded in [testing](testing.md) and [design review](design-review.md). The initial94-case run exposed tablet composer sizing and a stale-build Settings sizing assertion; the fresh111-case supporting run passes both. A stricter landscape History search exposed clipped result text; its bounded scroll correction has a dedicated regression. Full latest-head CI and physical browser/device acceptance remain separate gates.

Relay for Android0.2 is a native Kotlin/Compose **LAN debug preview**, Android8/API26 minimum, versionCode2. It retains secure HTTPS account enrollment, chat/history/foreground stream reconciliation, task inspection and cancellation, exact approval review, specialist/model selection and permitted file reads. It adds native file picking with bounded text/PDF/DOCX review/upload and Keystore-encrypted unsent drafts. Unconfirmed uploads cannot silently retry; session changes clear private state. Empty-text context selections remain session-only.

The actual APK was built, signature-verified, installed over code1 and cold-launched in an API36.1 emulator.29JVM tests pass, including a real isolated Relay HTTPS backend lifecycle. Lint has0errors9warnings. This is not authenticated installed-app or physical Samsung acceptance. Native remote Access, notifications, biometric reauthentication and further connected/lifecycle/UI acceptance remain incomplete.

Actual artifact: `release/android/relay-0.2.0-lan-preview-debug.apk`,12645234bytes. SHA256: `4d34e0df0c18bd96d3167c3a72d9a473ed22308a0161d31585facf937a1a649a`. Existing debug signing identity retained; no keys committed. [Build/install/upgrade](../../android/README.md), [artifact evidence](android-0.2.md), [troubleshooting and access blockers](client-troubleshooting.md).

No new web URL is delivered: automatic execution policy rejected the isolated PC preview background launch, and a trusted separate LAN endpoint remains unconfigured/unverified. Existing production, main, Cloudflare infrastructure and physical router were preserved. No public endpoint, firewall rule, trust-store change or port forwarding was created. Branch pushes do not deploy the new UI.

Earlier phase agent admission/handoff changes and two previously started coding-trial results remain historical evidence. Further agent improvements, benchmarks, AI routing and unrelated backend work are explicitly out of scope. The remaining mission is secure completion and delivery of these two clients, then STOP.
