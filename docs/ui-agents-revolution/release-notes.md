# Dispatch and Android LAN preview

**INCOMPLETE — CONTINUATION REQUIRED.** This is an implementation milestone on `modernization/ui-agents-revolution`, not completion of the owner's full product phase or a production deployment.

The web application now opens into Dispatch: a new task inbox, evidence inspector, horizontal desktop navigation and compact phone navigation. Conversation state stays mounted during task switching. Agent Studio now separates specialist inspection from recent account work and opens actual task execution. Existing projects, models, connections and administrative functions remain accessible; their full visual rebuild and the conversation redesign are still outstanding.

Agent admission now rejects verification contracts that the selected specialist cannot fulfill before model spending. Reviewer handoffs carry persisted acceptance suggestions as untrusted evidence. A versioned, account-scoped task feed supports the shared clients. These changes preserve model routing, privacy and tool authorization; repeated live coding and advanced parallel cooperation are not yet accepted.

Relay for Android is a native Kotlin/Compose LAN testing preview. Version `0.1.0-lan-preview` (code1) requires Android8/API26 or later. Its source implements HTTPS LAN enrollment, chat/history/foreground streaming, task inspection, scoped decisions, cancellation, agent selection and permitted text-file browsing. The actual APK builds, installs and launches in an emulator. Authenticated host connection and physical Samsung compatibility are **not yet verified**. Remote Access authentication, notifications, attachments and biometric reauthentication are incomplete.

Artifact: `release/android/relay-0.1.0-lan-preview-debug.apk`,16713796bytes. SHA256: `9c253dc1e642d4b41ad4def9d4cf9a8f2ca42362c34172bf8452881b69733a8f`. It uses the existing local debug signing identity; no private key is committed. See [build, installation and upgrades](../../android/README.md) and [validation limitations](android-validation.md). Transfer only this verified local artifact; hosted ephemeral debug builds are not its upgrade identity.

Local strict types and1451host tests passed (one platform skip). Native12JVM tests and lint completed with zero errors and six warnings. Browser regressions, observed failures, corrective reruns and laboratory performance measurements are in [testing](testing.md); exact published-head CI is recorded in [continuation](continuation.md).

Production, main, existing Cloudflare infrastructure and the physical router were not changed. Independent review corrected the findings listed in [review](independent-review.md); connected security, device and release gates remain open.
