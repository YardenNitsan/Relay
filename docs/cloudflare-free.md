# A stable public address without buying a domain

Research and implementation date: 9 October 2026. The browser gateway adapter is implemented in `deploy/cloudflare/worker.ts`. Its configuration template is `deploy/cloudflare/wrangler.jsonc.example`. The development deployment is now published: encrypted Wrangler authorization, matching Access issuer/audience, named tunnel and fixed loopback VPC Service are configured. Cloudflare reports the connector healthy; the owner successfully signed in and Relay recorded a remote session. Anonymous requests redirect to Access, missing/forged host JWTs return 401, and the independent owner service remains reachable. Full remote task/streaming acceptance is distinct from successful sign-in and remains to be recorded.

The connector currently runs as a hidden background process on the development Windows host, not an installed Windows service. After reboot it must be started again. The following command from the project directory uses the already encrypted Wrangler login; it does not require pasting a tunnel token:

```powershell
npx.cmd wrangler tunnel run relay-host --log-level warn
```

On Linux/macOS use `npx` instead of `npx.cmd`. Start Relay with the normal setup command as well. OS service installation and automatic connector restart remain deployment work; the stable hostname is preserved while the host is offline.

## What is currently free

Cloudflare provides a `workers.dev` hostname based on a Worker name and the account's chosen subdomain, for example `https://relay-host.your-account.workers.dev`. Keeping those names and the deployment preserves the address across host/tunnel restarts; it is not a rotating Quick Tunnel URL. No purchased domain is needed. This is a stable service address, not a guarantee that a third party will offer it unchanged forever. [Workers hostnames](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

Workers VPC is currently available to all Workers plans without a separate charge during its open beta. Its APIs and future pricing can change. [VPC limits and availability](https://developers.cloudflare.com/workers-vpc/platform/limits/), [VPC beta pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/)

The current Workers Free allocation is 100,000 requests per day and 10 milliseconds of CPU per invocation. Network waiting is distinct from CPU execution, but JWT validation and request processing still consume the invocation budget. Static assets, polling and SSE reconnects also create requests. This adapter adds no paid storage, AI, database or network bindings. Remain on the Free plan, monitor usage, and do not assume an existing paid account has the same billing behavior. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Cloudflare's Zero Trust Free plan is intended for teams below its 50-user threshold. Verify the current account's seat allocation before adding people; the free limit is not unlimited public signup. [Zero Trust plans](https://www.cloudflare.com/plans/zero-trust-services/)

Initial browser authentication can use Access email one-time PINs with explicitly allowed email addresses. It does not need a Google OAuth project. Google login can be added later as an identity-provider choice; neither choice connects Gmail, Calendar or paid AI APIs. [Access email PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)

## Connection boundary

```text
Phone / browser
  HTTPS: relay-host.<account>.workers.dev
  Cloudflare Access human login
          |
  Worker verifies signed app JWT, issuer, audience and expiry
          |
  RELAY_HOST: one fixed HTTP VPC Service binding
          |
  Outbound Cloudflare Tunnel on the Relay host
          |
  127.0.0.1:4318: Relay's remote browser gateway
  Reverify original JWT -> Relay account -> session -> capabilities
          |
  Models / controlled tools
```

The VPC Service must contain exactly the host's loopback address `127.0.0.1` and HTTP port `4318`. The binding's service configuration fixes the physical destination. Its fetch URL's hostname supplies HTTP Host rather than changing that destination, so the Worker uses `http://<configured-workers.dev-host>/...` to preserve Relay's strict Host check. Traffic stays encrypted through the tunnel; HTTP is confined to the final same-host loopback connection. Do not place cloudflared on another machine and reinterpret loopback as the Relay host. [VPC Service routing semantics](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)

Never bind this Worker to local owner port 4317, model runtime ports, PostgreSQL, LAN interfaces or a VPC Network binding. There is no public-fetch fallback, destination query parameter, arbitrary port selection or proxy endpoint. The Worker is browser-only: native `/v1/*` inference and service JWTs are rejected. Public external-agent inference needs a separate service-authenticated Worker/application and binding to its dedicated listener; that adapter is not included here.

A leaked URL reaches authentication only. Even a valid Access identity still needs an approved Relay account. Remote identities receive their own model permissions and workspace grants; the local owner remains the policy authority. Remote failure leaves the loopback application available.

## Adapter behavior

The adapter accepts one exact HTTPS `workers.dev` origin and one exact Cloudflare team issuer/audience. It verifies RS256 browser application tokens with nonempty subject, email, issued time and expiry. It forwards the original signed assertion unchanged, so the host independently checks it. It does not trust a plain email header or depend on `ctx.access` being available.

Only the entry document, built production assets and bounded `/api/...` routes are passed. Local-owner administration, owner pairing, emergency-control endpoints and native inference routes are blocked at the Worker as well as by host policy. Cross-origin actions, unexpected Host values, ambiguous paths, unsupported methods and WebSocket upgrades are rejected. Relay uses SSE here. Cloudflare handles `/cdn-cgi/access/logout` at its edge; if such a request reaches the Worker, it is not sent to Relay.

All forwarded requests require a verified identity. Mutations also need the exact public Origin; the host still checks its own session and CSRF token. JSON bodies are limited to 1 MiB and a ten-second read window. Their actual bytes are checked before forwarding, including requests without a trustworthy length header; fragmentation is bounded separately. Upstream responses are returned directly without buffering: SSE, backpressure, cancellation, CSP and Set-Cookie headers are preserved. Redirects are manual and never followed by the Worker. Errors do not include internal addresses, JWTs or upstream exception text.

The Worker has no content persistence, response cache, payload logs or tracing configuration. Cloudflare nevertheless terminates public TLS and carries the traffic; remote access is not a promise that data never leaves the host. Cloudflare's own access/security metadata has its own retention settings. Do not enable additional body logging or permissive cache rules.

## Deployment procedure for the owner

These commands are a reviewable setup procedure, not evidence that deployment happened. The repository currently pins Wrangler 4.149.0. Use that installed CLI rather than an unpinned download. Account login, tunnel creation and publishing are owner actions; no account password or tunnel token belongs in chat, Git or a screenshot.

1. **Choose names and confirm the Free plans.** In Cloudflare, enable Workers and Zero Trust, choose the account's Workers subdomain and Zero Trust team name. Keep the Worker name `relay-host` or choose another stable name before setup. Confirm the account has permission to manage Access and Workers. VPC creation needs Connectivity Directory Admin; binding an existing service needs Connectivity Directory Bind.

2. **Create a remotely managed VPC tunnel.** Use Workers VPC > Tunnels > Create. Select the actual host OS and use Cloudflare's generated cloudflared installation/service instructions privately on that host. Do not create a public hostname ingress to any Relay port. Workers VPC needs cloudflared 2025.7.0 or newer and QUIC (`auto` or `quic`); outbound UDP 7844 must work. No inbound router forwarding is needed. An HTTP/2-only tunnel is not a substitute for this VPC path. [Tunnel requirements](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/)

3. **Create only the fixed VPC Service.** Authenticate Wrangler interactively if required, then create the service. Run these from the Relay repository root, substituting the tunnel ID:

```powershell
node node_modules/wrangler/bin/wrangler.js login --use-keyring --scopes account:read user:read workers:write workers_scripts:write connectivity:admin
node node_modules/wrangler/bin/wrangler.js vpc service create relay-host --type http --tunnel-id YOUR-TUNNEL-UUID --ipv4 127.0.0.1 --http-port 4318
```

The login opens Cloudflare's own consent page. Approve it in your browser; do not paste credentials into chat. Wrangler's OS-keyring mode requires its supported global `@napi-rs/keyring` helper; if the CLI reports it missing, follow its installation instructions rather than falling back to plaintext credentials. The CLI adds its refresh-token scope automatically. Access policies and tunnel setup can be completed in the dashboard without granting this login broader account permissions.

Record the returned Service ID. Inspect the service in the dashboard: target `127.0.0.1`, HTTP `4318`, the intended tunnel, and no broader network binding. Set only the HTTP service port; do not add an unrelated HTTPS destination. These are the current documented CLI flags. [Wrangler VPC commands](https://developers.cloudflare.com/workers/wrangler/commands/vpc/)

4. **Protect the exact public hostname.** Create a self-hosted Access application for `relay-host.<account>.workers.dev`, covering all paths. Configure email PIN login and an Allow policy listing only intended users' exact emails. Do not create an Everyone/BYPASS policy. Record its application audience (AUD) and team issuer `https://<team>.cloudflareaccess.com`. Access supports specific `workers.dev` hostnames; Worker-wide protection is also available, but do not mix overlapping applications with different audiences unintentionally. [Workers with Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)

5. **Prepare matching local configuration.** Copy the template to a private local `deploy/cloudflare/wrangler.jsonc`. Fill the three Worker variables and VPC Service ID. Keep `workers_dev:true`, previews disabled, no custom routes and observability disabled. The template's placeholders intentionally cannot authenticate traffic. Configure Relay's owner-only Remote Access setup with the same public origin, issuer and audience, and gateway port 4318. Invite/approve the intended non-owner accounts with explicit grants. The host rechecks every signed identity and does not accept the URL as authorization.

For environment-based host configuration, the corresponding values are:

```dotenv
RELAY_REMOTE_ENABLED=1
RELAY_REMOTE_ORIGIN=https://relay-host.YOUR-SUBDOMAIN.workers.dev
RELAY_ACCESS_ISSUER=https://YOUR-TEAM.cloudflareaccess.com
RELAY_ACCESS_AUDIENCE=YOUR-BROWSER-APPLICATION-AUDIENCE
RELAY_REMOTE_PORT=4318
RELAY_REMOTE_REGISTRATION=invited
```

These deployment identifiers are not API keys. Keep the cloudflared service credential, Wrangler login credentials and any later provider tokens in their protected stores. Cloudflare account control can change the binding, so protect that account as part of host security.

6. **Check the candidate before publishing.** With the completed local configuration, run:

```powershell
npm.cmd run typecheck
npm.cmd test -- tests/cloudflare-worker.test.ts
node node_modules/wrangler/bin/wrangler.js deploy --dry-run --config deploy/cloudflare/wrangler.jsonc --outdir output/cloudflare-worker
```

Review the dry-run's bindings and bundle. It must contain only `RELAY_HOST` and the three deployment identifiers. Do not enable a paid plan to resolve a setup error silently. After owner authorization to publish this exact candidate:

```powershell
node node_modules/wrangler/bin/wrangler.js deploy --config deploy/cloudflare/wrangler.jsonc
```

The Worker rejects unauthenticated traffic even if the Access application was configured incorrectly, but a working login still requires the correct Access policy and audience. The original JWT header, Host behavior, and VPC service connectivity must be proven on the actual deployment before declaring the address ready.

## Acceptance and recovery

The deterministic suite uses actual signed JWTs and Web Streams with a fake fixed VPC fetch boundary. It tests forgery, wrong issuer/audience, service-token rejection, wrong origins, route exclusions, size/fragmentation bounds, interrupted uploads, cookie/CSP preservation and incremental SSE cancellation. It does not emulate Cloudflare's edge, tunnel or billing system.

For live acceptance, verify an anonymous phone sees Access login, an uninvited identity gets no account capability, an approved identity sees only its own conversations, and a low-privilege user cannot use owner routes or another workspace. Confirm first login, reload, CSRF rejection, task submission, real incremental events, logout, immediate host-side revocation and host/tunnel restart. Test from outside the host network as well as locally. Inspect free-plan CPU/request metrics without enabling payload logs.

Stop the tunnel or disable host remote access to withdraw access. Keep the local service running for recovery. Retain the Worker name/account subdomain to preserve the address if re-enabling later. If beta availability, quotas or pricing stop meeting the free-only requirement, disable this optional path and keep local/LAN operation; do not silently upgrade or expose another host port.
