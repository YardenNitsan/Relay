# Private LAN setup — 13 October 2026

The owner explicitly requested access on the PC's current LAN, without port forwarding or Cloudflare changes. Ethernet is on a Windows Private network at `10.100.102.30/24`. This setup targets a separate Dispatch instance; production stays on its existing ports and data.

Running listeners are owner-only `http://127.0.0.1:4327` and authenticated LAN `https://10.100.102.30:4443`. The reviewed launcher started successfully as a tracked foreground process, PID34620, tool session53431. No physical router, Cloudflare, public endpoint or system trust store was changed. This is an isolated preview with new data; the existing installation and conversations remain untouched.

## Dedicated certificate

Public certificate: ignored delivery file `release/android/relay-lan-ca.crt`.

SHA-256 fingerprint:

```text
13:80:DF:80:57:2A:90:03:71:3B:9A:98:A3:59:CD:BF:35:AA:D9:C6:50:3A:16:E0:CE:D7:1C:45:BE:27:18:6F
```

OpenSSL 3.5.4 supplied with the installed Git generated a dedicated RSA3072 CA and separate RSA3072 leaf. CA: critical CA/pathlen0 and keyCertSign/cRLSign; critical name constraints restrict IP certificates to `10.100.102.30/32` and DNS names to the reserved `relay-lan.invalid` domain. Leaf: CA false, serverAuth, IP SAN `10.100.102.30`, SHA256 signature, expires **11 January 2027 03:49:26 UTC**. The CA expires 13 October 2027. Renew the leaf before expiry; retain this CA identity for installed clients. An IP change requires deliberate new certificate and Android configuration/build, not disabled hostname checks.

Server files are in the current user's `%LOCALAPPDATA%/RelayDispatchLan/tls`, with owner-only Windows ACLs. The CA signing key is separately stored in `%LOCALAPPDATA%/RelayDispatchLanIssuer`; it is not supplied to the server or APK. Neither key belongs in Git, a shared folder, logs or phone storage. Do not regenerate either identity automatically on restart.

Verified preparation: OpenSSL chain/server-purpose/exact-IP validation passed; Relay's existing `loadLanTls` passed certificate, SAN, matching key, validity and private-file/directory ACL checks. No browser/device trust is inferred from these checks.

## Phone trust and sign-in

The optional host-specific Android build includes only the public CA, scoped to this exact IP through Android Network Security Configuration. It must retain certificate-chain and hostname verification. Other addresses retain system trust. This follows [Android's documented custom trust-anchor mechanism](https://developer.android.com/privacy-and-security/security-config).

Phone-browser use requires the owner to install the public CA deliberately. Transfer only `relay-lan-ca.crt`, verify its fingerprint, and use Android Settings to find **Install a certificate / CA certificate**. Settings wording varies by Android/One UI version. A user CA is a device trust change affecting compatible browsers/apps; it is not merely a Relay preference. Do not accept a browser certificate warning instead. Remove the named **Relay Dispatch LAN 10.100.102.30** certificate from user trusted credentials when retiring this setup. No physical Samsung trust installation has been performed by this agent.

Connect on the same LAN, with client isolation disabled only if already allowed by the owner's network policy. The loopback owner interface creates a least-privilege LAN account and a five-minute invitation. The phone redeems its own invitation; owner pairing never grants a phone owner rights. Use a fresh invitation per browser/app session. Do not publish invitation codes or place them in URLs.

## Running and pairing

The launcher fixes the approved private IP, HTTPS4443 and owner4327. It verifies the interface, TLS files and dedicated storage before starting. It never inherits production environment/keyring credentials. Provider keys are session-only; persistent Google OAuth, the schedule runner and external inference listener are intentionally unavailable in this isolated preview. Existing local model services remain subject to ordinary admission and memory protection. Never rebuild `dist` while this instance serves it.

After stopping this preview cleanly with Ctrl+C, its restart command from the repository root is:

```powershell
node --import tsx scripts/lan-preview.ts --data-dir=C:/Users/yarde/AppData/Local/RelayDispatchLan/relay-lan-preview --listen=10.100.102.30 --cert=C:/Users/yarde/AppData/Local/RelayDispatchLan/tls/server.pem --key=C:/Users/yarde/AppData/Local/RelayDispatchLan/tls/server.key
```

It is a running development process, not an installed auto-start service. Do not start a second copy or replace the production process.

For a fresh PC owner pairing code, use the existing local pairing command:

```powershell
node dist-server/pair.js --data-dir C:/Users/yarde/AppData/Local/RelayDispatchLan/relay-lan-preview
```

Read the token from the private `auth/owner-pairing.json` file in that data directory and paste it into the PC owner page. Codes expire after five minutes. In Access, the existing **LAN phone** account is a non-owner chat account; issue a fresh invitation for each native/browser sign-in. Native host address is `https://10.100.102.30:4443`. No owner credentials are embedded in the APK.

## Acceptance state

- Existing `loadLanTls` ACL/SAN/key checks pass. Launcher/LAN configuration tests:40passed/1skipped. Independent source/security review found no blocker in the private-preview scope.
- A TLS-verified request to the actual LAN address returns HTTP200 for the web document and HTTP401 for unauthenticated session/admin APIs. The authenticated Chrome owner browser renders Dispatch at1440x960 without document overflow; actual screenshot inspected. Production remains on its original PID20332/ports4317/4318.
- The installed0.3 scoped-CA APK authenticated from an API36.1 emulator to this LAN listener. UIAutomator showed the actual account and `yarden-pc · Live`. It submitted a real task, displayed real backend activity, restored its session after an APK upgrade/cold launch, reopened history and cancelled the task. The9B model paused when available RAM fell below the existing reserve; no generated answer is claimed and no policy was weakened. The native view now displays that recorded reason.
- Final sign-out testing reproduced `NetworkOnMainThreadException` in TLS pool eviction. Immediate credential invalidation plus off-main socket cleanup fixes it. The final installed APK returns to native sign-in and clears private account UI with no AndroidRuntime fatal exception. See [native evidence](../../android/lan-trust-build.md).
- Adding a narrower Windows firewall rule failed with OS error5 (administrator rights unavailable). Read-only inspection found an existing enabled Node.js TCP Allow rule on the Private profile with Any local/remote ports and addresses. It was not changed. The emulator reached the actual LAN listener; a separate physical phone/network path remains to be tested by the owner.
- No physical Samsung installation, phone-browser CA installation, remote-native login or full native feature completion is claimed. Background notifications/biometric approvals and other phase gates remain open.

## Delivered native artifact

`release/android/relay-0.3-lan-debug.apk`,12,943,914bytes, version0.3-lan/code3, Android8/API26minimum. SHA256: `5e3d7c769ada6ed12f86d222315e83460fba6e982de44f904813805ce8eba64c`. Stable existing debug signer retained and verified; install over the previous same-signer preview. This build already includes the exact-host public CA, so the native app does not require installing a system/user CA. Browser access still needs the manual trust step described above.30JVM tests and22build-generator checks pass; lint0errors10warnings.

The PC browser was opened and authenticated in a separate private profile at `%LOCALAPPDATA%/RelayDispatchLan/browser` (tracked tool session57905). Its session is for the local owner only. The emulator test session was signed out and the emulator stopped. Keep this browser available to issue a fresh LAN invitation through Access.
