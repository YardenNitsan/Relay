# Client testing and access boundaries

**13 October update:** the owner-authorized private LAN instance is now running and the scoped-CA native APK has authenticated in an emulator. See [current setup](lan-local-setup.md). Earlier launch/no-listener observations below describe the previous checkpoint. Existing production is still unchanged.

The Dispatch branch is not deployed over the existing installation. A successful branch build or push does not replace a running host. The latest local production-process inspection found only loopback listeners4317(owner browser),4318(protected gateway origin) and4315(model client API). No configured LAN listener was observed for that process. These observations do not prove a signed-in remote browser session.

An attempted separate PC preview background launch was rejected by automatic execution policy with `blocked by policy` and no more specific reason. That command did not create its script or launch a process. Do not advertise a new preview URL, retry through another launcher to bypass that restriction, expose the owner service to a phone or replace production. Continuing requires an approved execution path for a reviewed isolated preview. Existing deployment instructions remain in [setup](../setup.md), [LAN access](../lan-access.md) and [protected remote access](../remote-setup.md).

For the Android testing APK:

- An untrusted/mismatched certificate is a host trust-provisioning problem. Do not disable TLS checks or accept a browser warning as native trust. The app trusts Android's system anchors, not arbitrary user-installed certificates.
- Use a fresh five-minute invitation for an approved non-owner account. A code is single-use; revocation invalidates it. Request a new invitation after resolving account/session limits.
- A Cloudflare login page is not the native LAN API. Native remote Access OAuth is still incomplete; browser remote sign-in does not automatically authenticate the APK.
- After a lost send response, inspect history before explicitly permitting another send. After a lost upload response, inspect Projects before selecting that attachment again. The client does not silently repeat either mutation.
- Drafts with unsent text are encrypted and scoped to host/account/conversation. Sign-out/revocation removes them; empty-text selection preferences do not persist. Device key loss or clearing app storage makes retained ciphertext unavailable.
- Install code2 over code1 using the same recorded debug certificate. A signature mismatch is not fixed by renaming an APK. Uninstalling discards app state; preserve the stable signing identity for updates.
- System background notifications, biometric approvals and native remote sign-in are not delivered yet. Foreground task streaming is not background push.

See [actual APK and checksum](android-0.2.md). Physical Samsung installation, Android37 permission behavior and real installed-client host connectivity remain separate acceptance steps.
