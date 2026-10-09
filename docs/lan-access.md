# Authenticated access on a local network

LAN access lets an approved account use Relay from another device on the host's private network. It uses a separate HTTPS listener and a short-lived invitation issued by the local owner. It does not expose the owner pairing endpoint or turn a nearby device into an owner.

```text
Local owner → loopback owner service → issue invitation for one approved account
                                                ↓
LAN browser → trusted HTTPS host address → redeem invitation once
                                                ↓
                               account session + existing user permissions
```

The network address is not a credential. A LAN device can reach the sign-in screen but cannot access conversations, models or tools until authenticated. All subsequent operations retain backend account, workspace, model, cloud-budget and computer-access checks. Local-network access is a separate deployment from [Cloudflare public access](remote-setup.md); local use does not require Google or a Cloudflare connection.

## Establish HTTPS trust first

Use an exact hostname or private IP that the connecting devices can resolve and reach. Its certificate must contain the corresponding DNS name or IP subject alternative name, remain within its validity period, and match the host's private key. A certificate for `localhost` does not authenticate a different computer's private-network IP. Node exposes certificate hostname/IP and key-match checks through its [X509Certificate API](https://nodejs.org/api/crypto.html#class-x509certificate).

Prefer an existing organization/private-CA certificate where client trust is already managed. A certificate for a domain you control is another option: ACME DNS validation can prove domain ownership without exposing the web service to the Internet, while local DNS directs clients to the private host. Certificate issuance and renewal still need their configured infrastructure. See the certificate authority's [DNS challenge documentation](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge).

The TLS private key belongs in storage restricted to the host service's OS account. Keep it out of source control, model context, logs and shared documents. Share only public certificates when provisioning client trust. The issuer's root private key must never be copied to client devices. A self-signed leaf alone does not establish trust; do not use HTTP or bypass browser certificate warnings to send invitations.

| Certificate approach | Appropriate use |
| --- | --- |
| Organization or managed private CA | Controlled deployments with trusted client devices and maintained certificate renewal. |
| Public CA for an owned hostname | Devices with standard browser trust; use local DNS and a challenge method appropriate for a private host. |
| mkcert | Explicit developer testing only; it is not Relay's production trust-provisioning mechanism. |
| Ad-hoc self-signed leaf with warning bypass | Unsupported way to send credentials. Establish authenticated trust first. |

The [mkcert maintainers](https://github.com/FiloSottile/mkcert#installing-the-ca-on-other-systems) expressly describe development use rather than production distribution to end users. It can help test a controlled machine, but installing a root certificate changes that device's trust. Relay does not install a CA, modify a system trust store, disable certificate checks, or change the firewall automatically.

Trust provisioning differs by OS and browser. Windows provides per-user and machine certificate stores; choose the intended scope through an administrator-approved process. [Microsoft's certificate-store documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/trusted-root-certification-authorities-certificate-store) describes their management. On iOS/iPadOS, manually installing a certificate profile does not automatically enable TLS trust; Apple documents the required [certificate trust settings](https://support.apple.com/en-us/102390). macOS, Linux and Android clients need their own managed trust configuration and browser validation. A successful desktop connection does not verify every phone's trust store.

## Configure the listener deliberately

The owner supplies these environment variables to the host process before starting it:

| Variable | Meaning |
| --- | --- |
| `RELAY_LAN_ENABLED=1` | Explicitly enable the separate listener. Omitted or `0` leaves it disabled. |
| `RELAY_LAN_HOST` | One actual private interface IP: RFC1918 IPv4, such as `192.168.1.40`, or IPv6 ULA, such as `fd12::40`. |
| `RELAY_LAN_ORIGIN` | The exact HTTPS origin clients use, such as `https://relay.example.com:4319` or `https://192.168.1.40:4319`. |
| `RELAY_LAN_CERT_FILE` | Absolute local path to the PEM leaf certificate followed by intermediate certificates when needed. |
| `RELAY_LAN_KEY_FILE` | Absolute local path to the matching unencrypted PEM private key in an owner-private directory. |

These values contain paths and deployment settings, not inline key material. Supply them through the service environment, not a committed secrets file. The port comes from the origin; omitting it means HTTPS port 443, which may require OS configuration. Port 4319 is the usual separate-listener example. Owner port 4317 and public gateway port 4318 are reserved. A DNS origin needs client DNS resolution to the configured private interface; Relay does not create that record. An IP origin must match the bind address. Wildcard bind addresses, loopback, public IPs, IPv4-mapped IPv6 and link-local interfaces are rejected.

Startup checks the certificate's DNS/IP subject alternative name rather than falling back to a common name, certificate-chain validity dates, leaf status, server-authentication usage where present, and the private-key match. Node's TLS implementation also checks that the material can create a TLS context with TLS 1.2 or newer. Files must be bounded regular files without links, hard links, filesystem aliases or path traversal. Certificate chains are capped at 128 KiB/eight certificates and keys at 64 KiB. These checks do not certify issuer trust, revocation status, full chain delivery or trust on another device. Certificate rotation requires a controlled service restart; no automatic certificate issuer or renewal agent is installed.

The private key **and its containing directory** must belong to the host service's OS account. Linux/macOS require no group/other permission bits; macOS additionally refuses extended ACL entries. Windows performs read-only ACL inspection and refuses allow entries for other ordinary accounts; the owner account, SYSTEM and local Administrators are permitted. Relay never rewrites a selected file's permissions to make it pass. Preparing that private directory and deploying its key are owner/operator actions. The checks are not a sandbox against a hostile process already running as that same OS account.

Restrict any necessary firewall rule to the selected private network and listener; do not publish the local owner service, model runtimes, database, Docker or internal tool endpoints. Do not port-forward the LAN listener to the Internet; use the separate public gateway architecture instead.

Configuration, DNS resolution, certificate validity, client trust and actual network reachability are separate checks. The listener's availability does not prove that another device can connect. Changing a Wi-Fi network, DHCP address, hostname or certificate can require updated configuration and client verification. Relay's owner interface remains on loopback independently of LAN availability.

## Invite a specific account

The local owner first creates or approves a non-owner account and grants only its intended providers, workspaces, tools and budgets. A pending or disabled account cannot receive a usable invitation. The owner then requests a LAN invitation for that account and delivers it to the intended person over a trusted channel.

The invitation contains a random 256-bit code and expires five minutes after issuance. Paste the code into the LAN sign-in screen over the trusted HTTPS connection. Do not append it to the URL, put it into a chat prompt, or store it in a script. The visitor does not choose a user ID: the server binds the code to its account and account-session version before issuance.

Relay stores only a SHA-256 digest of the code and records issuance/redemption events without the code or its digest. Exactly one concurrent redemption may succeed. The code remains consumed if subsequent session creation fails, including reaching the session limit; resolve that issue and ask for a new invitation.

There can be at most eight unexpired invitations for one account and 1,000 across the host. Expired and invalidated invitations are cleaned during issuance. An account revocation invalidates outstanding codes through the recorded session version. Disabling an account prevents redemption, and a rejected consumed code cannot become valid again when that account is later enabled.

## Sessions, revocation and verification

Successful redemption creates a Secure, HttpOnly, SameSite browser session. CSRF, exact Host/Origin validation and rate limits still apply. The [browser cookie requirements](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies) are why plain private-IP HTTP is not an acceptable substitute for HTTPS.

The existing 20-active-session limit applies to the account. Valid browser cookies can be reused by new tabs. Signing out removes the current browser session; owner revocation and disablement retain their separate account-wide meanings. A LAN sign-out must remain local to the LAN account session and must not navigate to Cloudflare logout.

Before inviting other people, test an actual second device: certificate trust, sign-in, replay rejection, streaming, task cancellation, account revocation, private-conversation isolation and denied owner operations. Recheck on a phone and after restarting the host. Invitation tests use the actual database and cover concurrent redemption, expiration, revocation and quotas; they do not certify a deployed TLS chain, firewall rule, Wi-Fi network, phone browser or native installer. No public endpoint or firewall rule is created by this document.
