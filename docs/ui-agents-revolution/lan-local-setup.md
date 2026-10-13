# Private LAN setup — 13 October 2026

The owner explicitly requested access on the PC's current LAN, without port forwarding or Cloudflare changes. Ethernet is on a Windows Private network at `10.100.102.13/24`. This setup targets a separate Dispatch instance; production stays on its existing ports and data.

Running listeners are owner-only `http://127.0.0.1:4327` and authenticated LAN `https://10.100.102.13:4443`. The reviewed launcher started successfully as a tracked foreground process, PID13284, tool session2542. No physical router, Cloudflare, public endpoint or system trust store was changed. This is an isolated preview with new data; the existing installation and conversations remain untouched.

## Dedicated certificate

Public certificate: ignored delivery file `release/android/relay-lan-10-100-102-13-ca.crt`.

SHA-256 fingerprint:

```text
1E:A4:8B:D0:EF:27:CE:F8:52:69:D8:5E:63:E8:C6:61:E3:81:67:8C:D8:3D:87:21:8B:42:47:46:9E:33:ED:4E
```

OpenSSL 3.5.4 supplied with the installed Git generated a dedicated RSA3072 CA and separate RSA3072 leaf. CA: critical CA/pathlen0 and keyCertSign/cRLSign; critical name constraints restrict IP certificates to `10.100.102.13/32` and DNS names to the reserved `relay-lan.invalid` domain. Leaf: CA false, serverAuth, IP SAN `10.100.102.13`, SHA256 signature, expires **11 January 2027 18:11:32 UTC**. The CA expires 13 October 2027. Renew the leaf before expiry; retain this CA identity for installed clients. An IP change requires deliberate new certificate and Android configuration/build, not disabled hostname checks.

Server files are in the current user's `%LOCALAPPDATA%/RelayDispatchLan/tls-10-100-102-13`, with owner-only Windows ACLs. The CA signing key is separately stored in `%LOCALAPPDATA%/RelayDispatchLanIssuer/ip-10-100-102-13`; it is not supplied to the server or APK. Neither key belongs in Git, a shared folder, logs or phone storage. Do not regenerate either identity automatically on restart.

Verified preparation: OpenSSL chain/server-purpose/exact-IP validation passed; Relay's existing `loadLanTls` passed certificate, SAN, matching key, validity and private-file/directory ACL checks. No browser/device trust is inferred from these checks.

## Phone trust and sign-in

The optional host-specific Android build includes only the public CA, scoped to this exact IP through Android Network Security Configuration. It must retain certificate-chain and hostname verification. Other addresses retain system trust. This follows [Android's documented custom trust-anchor mechanism](https://developer.android.com/privacy-and-security/security-config).

Phone-browser use requires the owner to install the public CA deliberately. Transfer only `relay-lan-10-100-102-13-ca.crt`, verify its fingerprint, and use Android Settings to find **Install a certificate / CA certificate**. Settings wording varies by Android/One UI version. A user CA is a device trust change affecting compatible browsers/apps; it is not merely a Relay preference. Do not accept a browser certificate warning instead. Remove the named **Relay LAN 10.100.102.13 Testing CA** certificate from user trusted credentials when retiring this setup. No physical Samsung trust installation has been performed by this agent.

Connect on the same LAN, with client isolation disabled only if already allowed by the owner's network policy. The loopback owner interface creates a least-privilege LAN account and a five-minute invitation. The phone redeems its own invitation; owner pairing never grants a phone owner rights. Use a fresh invitation per browser/app session. Do not publish invitation codes or place them in URLs.

## Running and pairing

The launcher requires an explicit private IPv4 address and fixes HTTPS4443 and owner4327. It verifies the interface, TLS files and dedicated storage before starting. It never inherits production environment/keyring credentials. Provider keys are session-only; persistent Google OAuth, the schedule runner and external inference listener are intentionally unavailable in this isolated preview. Existing local model services remain subject to ordinary admission and memory protection. Never rebuild `dist` while this instance serves it.

After stopping this preview cleanly with Ctrl+C, its restart command from the repository root is:

```powershell
node --import tsx scripts/lan-preview.ts --data-dir=C:/Users/yarde/AppData/Local/RelayDispatchLan/relay-lan-preview --listen=10.100.102.13 --cert=C:/Users/yarde/AppData/Local/RelayDispatchLan/tls-10-100-102-13/server.pem --key=C:/Users/yarde/AppData/Local/RelayDispatchLan/tls-10-100-102-13/server.key
```

It is a running development process, not an installed auto-start service. Do not start a second copy or replace the production process.

For a fresh PC owner pairing code, use the existing local pairing command:

```powershell
node dist-server/pair.js --data-dir C:/Users/yarde/AppData/Local/RelayDispatchLan/relay-lan-preview
```

Read the token from the private `auth/owner-pairing.json` file in that data directory and paste it into the PC owner page. Codes expire after five minutes. In Access, the existing **LAN phone** account is a non-owner chat account; issue a fresh invitation for each native/browser sign-in. Native host address is `https://10.100.102.13:4443`. No owner credentials are embedded in the APK.

## Acceptance state

Current launch and certificate evidence: [address renewal](lan-address-renewal.md). Launcher/TLS64passed/1skipped, generator51checks, independent source review accepted. Actual HTTPS web200/protectedAPI401; actual authenticated Chrome Work/Agents/Projects navigation checked at320,390,768,1440,2560px in both themes without document overflow. Representative screenshots inspected.

Real authenticated LAN API chat completed with `Relay LAN connected.` using the existing local9B model and unchanged resource safeguards. This supersedes the earlier RAM-paused simple-generation observation, not the physical-device gate.

The PC owner browser is open in a separate private profile `%LOCALAPPDATA%/RelayDispatchLan/browser-current13` (session45274). Production listeners were already stopped at this session's inspection and were not started or replaced. Preview uses its previous isolated data. The existing safe LM Studio helper started only the model runtime on localhost1234.

The oldIP30 CA/keys and0.3 APK remain preserved; that APK is not configured for currentIP13. The actual current0.4 APK, checksum, installed real chat/notification/recovery checks and limitations are in [native delivery](android-0.4.md). Physical Samsung and phone-browser certificate installation have not been performed. No remote URL is claimed.
