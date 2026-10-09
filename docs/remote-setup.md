# Share a Relay host through a stable, authenticated URL

**For a free address without buying a domain, start with [Cloudflare Workers + private Tunnel setup](cloudflare-free.md).** The guide below covers the alternative custom-domain deployment. Both preserve Relay's signed identity and account permissions. Workers VPC is currently free in beta; check current plan limits. Quick Tunnels are not the production fallback: their addresses change and they do not support Relay's SSE transport.

Relay remains usable locally without Cloudflare, Google, a tunnel, or a cloud AI account. Remote sharing is optional and disabled by default. This guide configures a persistent named tunnel to the separate remote gateway; it does not publish the owner service. No public deployment or live Google login has been performed as part of the automated tests.

```text
Browser → HTTPS → Cloudflare Access → named Tunnel → 127.0.0.1:4318
                                                       ↓
                                           signed identity validation
                                                       ↓
                                           Relay account + permissions

Local owner browser → 127.0.0.1:4317 continues independently
```

The public address identifies the host. It grants no model, file, terminal, or owner privileges by itself. Use a separate Google identity for each person; do not share the owner's local pairing code or browser session.

## What you need

You need control of a domain on Cloudflare, a Cloudflare account with Access configured, and the host's permission to run `cloudflared`. The host and connector must remain running for remote access. A named tunnel retains its configured hostname across connector restarts; it does not keep an offline computer available. Cloudflare currently recommends remotely managed tunnels for most deployments. Follow its maintained [tunnel setup](https://developers.cloudflare.com/tunnel/get-started/) and [management guidance](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/), checking account limits before inviting users.

Remote sharing is an explicit owner action. The installer does not open firewall ports, create a domain, install a privileged service, or submit account credentials automatically.

## 1. Configure Google login at the authentication boundary

Follow Cloudflare's [Google identity provider instructions](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/). Create an OAuth web application in your Google Cloud project and configure its consent/audience settings for the people you intend to invite. The JavaScript origin is your Access team origin, such as `https://your-team.cloudflareaccess.com`; the callback is that origin followed by `/cdn-cgi/access/callback`.

Enter the Google client ID and client secret in **Cloudflare's identity-provider settings**, then use its connection test. The client secret belongs there, not in Relay's repository, browser configuration, chat, or setup scripts. Select the configured Google identity provider for the Access application. This Google login identifies the visitor to Relay; it does not connect Gemini or purchase inference access.

## 2. Protect the hostname before connecting it

Create a self-hosted public Access application for the exact hostname, for example `relay.example.com`, including its API and static asset paths. Use an **Allow** policy with explicit permitted email addresses or a controlled organization. Configure Google as the permitted login method. Do not use Bypass or Service Auth for this browser application. Cloudflare's [policy documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/) explains how identity selectors and Allow/Block decisions interact.

For owner-approved signup, the Access policy may admit a broader, explicitly chosen group of authenticated Google users to the request screen. Relay still denies application access until approval. A Google-login-only group is substantially broader than a list of named friends; enable it deliberately and retain the host registration limits. No bypass rule is needed.

Record the Access team origin and the application's audience tag. The audience tag is not the Google client ID, and the issuer is not `accounts.google.com`.

## 3. Configure Relay's remote listener

The preferred path is the local owner's **Access** screen. Save the exact public HTTPS origin, Cloudflare Access team origin, application audience, and registration mode. Relay stores only those nonsecret identifiers in its local database. It does not collect the tunnel token or Google OAuth secret. The remote gateway uses port 4318.

Restart a launcher-managed host with `setup.cmd --stop` followed by `setup.cmd`, or `sh setup.sh --stop` followed by `sh setup.sh`. Then return to **Access** and explicitly enable remote access. Saving configuration applies on restart and records remote access as disabled for that next startup; it does not hot-replace a currently active gateway. Confirm the displayed hostname before enabling it.

An explicit `RELAY_REMOTE_ENABLED` environment setting, including `0`, overrides saved UI configuration. The Access screen reports this override. Remove the override from the host's startup environment if you want saved UI settings to control configuration.

For service managers and advanced deployments, the environment alternative follows. These settings are public routing/validation configuration, not secrets. Replace the examples with your exact configuration. Keep the local owner listener at port 4317 and the remote listener at 4318.

Windows PowerShell:

```powershell
$env:RELAY_REMOTE_ENABLED = '1'
$env:RELAY_REMOTE_ORIGIN = 'https://relay.example.com'
$env:RELAY_ACCESS_ISSUER = 'https://your-team.cloudflareaccess.com'
$env:RELAY_ACCESS_AUDIENCE = 'your-access-application-audience'
$env:RELAY_REMOTE_PORT = '4318'
$env:RELAY_REMOTE_REGISTRATION = 'invited'
.\setup.cmd
```

Linux/macOS shell:

```sh
export RELAY_REMOTE_ENABLED=1
export RELAY_REMOTE_ORIGIN=https://relay.example.com
export RELAY_ACCESS_ISSUER=https://your-team.cloudflareaccess.com
export RELAY_ACCESS_AUDIENCE=your-access-application-audience
export RELAY_REMOTE_PORT=4318
export RELAY_REMOTE_REGISTRATION=invited
sh setup.sh
```

An already-running host retains its startup environment. If it was started through the launcher, stop it with `setup.cmd --stop` or `sh setup.sh --stop` before starting it with changed settings. These commands only stop a launcher-managed host. Keep the existing data directory to preserve accounts and conversations. For other service managers, change that service's nonsecret environment configuration and restart the service through its normal controls.

`RELAY_REMOTE_REGISTRATION` accepts two values:

| Value | New authenticated identity |
| --- | --- |
| `invited` (default) | Must already have an enabled account invited by the local owner. |
| `approval` | Creates one disabled access-request record and waits for owner approval. |

An access request has no provider, workspace, network, MCP or cloud-spending grant. No Relay session is issued and no task starts. Repeated sign-ins reuse the same request. Registration stops accepting new requests at 100 pending accounts or 1,000 total non-owner accounts. Disabled or denied accounts stay disabled; returning to the URL never approves them.

Relay binds each account to the verified issuer and subject. A later identity with the same email but a different subject is rejected for owner review. Owner identities cannot become remote owners.

## 4. Create the persistent tunnel route

Create a named, remotely managed Cloudflare Tunnel and install the official connector for the host OS and architecture. Add exactly this published application route:

| Setting | Value |
| --- | --- |
| Public hostname | Your exact `RELAY_REMOTE_ORIGIN` hostname |
| Local service | `http://127.0.0.1:4318` |
| HTTP Host header | Preserve the public hostname, or explicitly set it to that hostname |
| Unmatched routes | Deny / HTTP 404 |

Never target port 4317, PostgreSQL, a model runtime, Docker, or a privileged host API. Do not add wildcard or unprotected alternate routes. Relay checks the public Host and Origin and validates Access JWT signature, issuer, audience, expiry, token type and account grants itself. Cloudflare documents [origin JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

The tunnel token is a credential: anyone possessing it can start a connector. Keep it out of Git, logs, shell history and command arguments. Cloudflared supports receiving it through `TUNNEL_TOKEN`; the following foreground examples read it interactively without writing it to a file. The environment remains visible to sufficiently privileged software on the same host. See the official [run parameters](https://developers.cloudflare.com/tunnel/reference/run-parameters/) and [token lifecycle](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).

PowerShell, in a separate terminal:

```powershell
$tunnelSecret = Read-Host 'Cloudflare tunnel token' -AsSecureString
try {
  $env:TUNNEL_TOKEN = [System.Net.NetworkCredential]::new('', $tunnelSecret).Password
  cloudflared.exe tunnel run
} finally {
  Remove-Item Env:TUNNEL_TOKEN -ErrorAction SilentlyContinue
  $tunnelSecret.Dispose()
}
```

Bash on Linux/macOS, in a separate terminal:

```bash
trap 'unset TUNNEL_TOKEN' EXIT
read -r -s -p 'Cloudflare tunnel token: ' TUNNEL_TOKEN
printf '\n'
export TUNNEL_TOKEN
cloudflared tunnel run
unset TUNNEL_TOKEN
```

These examples keep the connector in the foreground. Automatic startup is a separate OS service deployment: use the official platform instructions and a restricted service credential mechanism. Do not paste the token into a committed service file. Relay currently does not provision, sign, or supervise a native Cloudflare service. Rotate the token in Cloudflare if it is exposed.

## 5. Approve people and grant only their intended access

Open Relay locally and inspect **Access**. For invitation-only mode, invite the exact Google email. For approval mode, inspect the pending identity and choose its permitted providers, budgets, workspaces, and computer-access ceiling before enabling it. Cloud-provider permission and data-egress permission are distinct; allowing a provider does not override a task's local-only setting.

Use a separate test account before sharing broadly. Verify that it cannot inspect the owner's conversations, manage the owner's credentials or local runtimes, reach host-file tools, or select ungranted workspaces. Users may manage their own permitted cloud connections. Check that disabling the account blocks subsequent requests and cancels its work. Test Stop, streaming reconnect, mobile approval controls, and a tunnel outage. Local operation must remain available throughout. Automated signed-JWT tests cover identity validation, approval state, quotas and concurrency; they do not validate your DNS, Google project, Cloudflare policy, TLS path or Internet deployment.

## Browser sessions and signing out

An account may have at most 20 active Relay browser sessions across its listeners. New tabs reuse a valid cookie and do not consume another slot. At the limit, a new browser receives `SESSION_LIMIT` (HTTP 429); Relay does not evict or clear another browser. Sign out an existing browser, wait for expiration, or have the owner revoke an unused session in **Access**. Expired and account-version-revoked sessions do not count toward admission.

Sign out first sends a CSRF-protected request that deletes the current Relay session and clears its cookie. It does not disable the account, cancel its tasks, or revoke the person's other Relay browsers. Use the task Stop and owner account controls for those actions. A remote browser then navigates to the fixed same-origin `/cdn-cgi/access/logout` path, which is handled by Cloudflare; a local browser returns to pairing.

Cloudflare documents that [Access logout](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/#log-out-as-a-user) clears the selected domain's authorization cookie and revokes the user's Access session across applications, with issued tokens ceasing acceptance after a short propagation interval. It does not provide per-application Access logout. Relay's deletion of its current session takes effect independently. This is different from signing out of the underlying Google account.

## AI-provider authentication is a separate connection

Relay's provider adapters use supported API credentials on the server. Connecting a provider does not authenticate a remote person to Relay, and Google sign-in does not authorize cloud spending.

- **OpenAI:** the [API reference](https://developers.openai.com/api/reference/overview) specifies API keys or short-lived workload-federation access tokens. Relay currently integrates the API-key path. Its Google/Access login is not a ChatGPT subscription login flow.
- **Gemini:** Google documents an [OAuth API flow](https://ai.google.dev/gemini-api/docs/oauth) requiring a Cloud project, consent setup and token lifecycle. Relay currently uses Gemini API keys; its Access login does not implement Gemini OAuth or grant a Gemini subscription's benefits.
- **Anthropic:** current [authentication guidance](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use) directs third-party applications to API keys or supported inference providers and prohibits collecting or routing Claude.ai session credentials. Hosting the unmodified Claude Code application is a separately documented integration with its own conditions; Relay's generic Anthropic adapter does not implement it.

Remote failures, pending registrations, provider failures and local-only operation are separate states. Diagnose the corresponding boundary rather than weakening another one. The public endpoint remains unconfigured until the owner supplies a real domain/account and completes the live checks above.
