# Connection delivery checkpoint — 13 October 2026

Status: **INCOMPLETE — CONTINUATION REQUIRED**.

The existing PC host answered HTTP 200 at `http://127.0.0.1:4317/` during this checkpoint. This is the preserved production installation, not the Dispatch branch. The address works only on the host PC. A TLS-verified request to the existing `https://relay-host.yarden-relay.workers.dev/` returned HTTP 302 to its Cloudflare Access login; redirects were not followed and no credentials were supplied. This verifies gateway reachability, not authenticated remote or phone workflows.

The actual native testing artifact is `release/android/relay-0.2.0-lan-preview-debug.apk` (12,645,234 bytes). Its SHA-256 was freshly checked:

```text
4d34e0df0c18bd96d3167c3a72d9a473ed22308a0161d31585facf937a1a649a
```

It installs independently of host setup, but sign-in requires an authorized HTTPS LAN listener. No such listener was observed on the existing production process. The APK does not yet implement native Cloudflare Access sign-in. Installing it alone does not satisfy connected-app acceptance.

## Proposed connection setup, not applied

1. Prefer an existing, phone-trusted HTTPS certificate and exact LAN hostname. Otherwise obtain a certificate for an owner-controlled hostname through DNS validation. This requires ownership and DNS authorization; no domain or credentials are assumed. DNS validation can issue certificates without exposing the web server publicly ([official Let's Encrypt guidance](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge)).
2. Configure that hostname to resolve to the approved private host address on the phone and PC. Prepare the exact certificate/key paths, owner-private storage, private bind address and port before any host changes. Do not modify the physical router, its DNS settings or forwarding.
3. Use a separately reviewed instance and data directory for Dispatch; preserve production. The previous isolated launch was denied by automatic execution policy without a specific reason. Do not retry through another launcher or describe a proposed address as running.
4. Enable only the existing authenticated LAN listener with the settings documented in [LAN access](../lan-access.md). No new authentication scheme or certificate-validation bypass is needed. Android currently uses system trust; app-specific trust configuration is possible in Android but is not enabled by this APK ([official Android guidance](https://developer.android.com/privacy-and-security/security-config)).
5. Create an authorized non-owner account through the owner interface and issue a short-lived invitation. Redeem it on the installed app, verify chat/task/files/approval isolation, disconnect/reconnect and revoke its session. Verify both mobile web and native TLS without warnings or exceptions.

Missing external inputs: an approved hostname/certificate and private address, or owner-controlled DNS configuration for certificate issuance; an allowed isolated launch path; physical phone access for device acceptance. Native remote authentication, notifications and the other open product gates remain implementation work, independent of these inputs.

No certificates, trust roots, DNS entries, firewall rules, public endpoints or production settings were changed by this checkpoint.
