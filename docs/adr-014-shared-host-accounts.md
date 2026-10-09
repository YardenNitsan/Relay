# ADR014: Shared host with isolated personal intelligence

Status: implemented for 0.1.1; live public deployment validation pending.

## Decision

Use an established Google authentication boundary through Cloudflare Access and a stable named tunnel. Keep the owner listener independent and loopback-only. Accept signed issuer/audience-bound application identities on the separate remote listener. Support invitation-only access or bounded owner-approved registration. A pending identity may fetch the inert browser shell but receives no application session, provider grant or tool capability.

Resolve provider gateways from authenticated identity and durable task ownership, never from a browser-supplied credential owner. Share only local discovery, measurements and inference. Each remote user has independent cloud credentials, health, catalogs, enabled settings and request cancellation. OS-backed vault namespaces use immutable account IDs; no plaintext database credential migration occurs. Existing global credentials and preferences continue to belong only to the owner.

Provider permissions, task egress policy and billing remain distinct. Unknown model prices prevent strict monetary limits from being proven. An explicit owner grant allows personal API use without a monetary cap when the user leaves the task cap unset; call/time/concurrency controls remain enforced and cost is unknown, not zero. No owner credential fallback is permitted.

## Alternatives

- Exposing the owner port or using URL possession as authorization would merge remote requests with computer administration and is rejected.
- A custom Google OAuth login implementation duplicates the existing Access identity boundary and adds another callback/token lifecycle. Use Access for Relay login at this stage.
- A private VPN works well for trusted devices but changes onboarding and requires a separate identity adapter; it is not represented as equivalent to this JWT gateway.
- Consumer ChatGPT/Claude/Google account cookies are not supported API credentials. No session scraping or subscription impersonation is implemented. Gemini Cloud OAuth is possible future work with explicit project/consent registration.
- Sharing global cloud API keys among users conflicts with the requested personal-account billing and confidentiality boundary.

## Consequences

The address remains stable when Relay changes, provided its owner retains the DNS/tunnel configuration. DNS, Cloudflare and Google provisioning require external accounts; setup UI saves validated public identifiers only. The machine must remain online for remote requests. Local functionality survives remote infrastructure failures.

The host administrator still has authority over the machine, database and OS credential store. User isolation protects against other application accounts, not against that administrator or a compromised host service. Native OS and live cloud/public acceptance remain separately documented release gates.

Research sources and setup: [0.1.1 plan](plan-0.1.1.md), [remote deployment](remote-setup.md).
