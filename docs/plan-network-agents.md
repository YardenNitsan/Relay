# LAN, Cloudflare and specialist agents — 0.1.1 extension

The existing local browser and owner service remain independent of Internet infrastructure. User approval, object ownership, provider credentials and host capabilities remain server enforced.

## Decisions

1. Keep owner HTTP on loopback only. Add an optional separate LAN HTTPS listener bound to one explicitly configured private interface. Accept a trusted certificate; do not install a root CA or open firewall rules silently. LAN membership is reachability, not computer authority. Owner-issued, account-bound, five-minute invitations establish secure sessions.
2. Use an outbound Cloudflare Tunnel with Cloudflare Access for remote browsers. A protected Workers hostname and fixed VPC Service binding avoid buying a domain; Workers VPC is currently free in beta. A named public-hostname tunnel remains an alternative for owners with a domain. Access email PINs or configured Google login identify the user; Relay owner approval and per-user grants authorize use. No router forwarding or model/database port publication is needed. Account configuration and live deployment are separate acceptance gates.
3. Separate external inference from the conversation controller. Revocable, expiring per-user tokens authorize only local model inference. Tool calls are proposals returned to the client's agent; Relay never executes them. Persist usage metadata, never external prompts, responses or tool payloads. Runtime/client logging policies remain separate.
4. Share one host inference lease and hardware admission between chat and external clients. Bound request size, context, generation time, per-user request rate/concurrency and daily calls. Stop and user revocation cancel inference outside model control.
5. Support strict text/function subsets of Responses, Chat Completions and Anthropic Messages. Reject unsupported features explicitly. Protocol support does not certify arbitrary Claude Code/Codex configurations; live client validation is a separate release gate.
6. Ten specialist profiles share the orchestrator and deterministic tool broker. Their instructions do not grant capabilities. Clearly distinguish available local tools from email/calendar/browser/desktop integrations. Personal tasks receive actual per-user persistence; external integrations require supported credentials and narrowly scoped consent.

## Implementation and verification

- Add invitation, token, metadata and personal-task tables; adversarial ownership/revocation tests.
- Implement LAN certificate/config validation, authenticated sessions and owner invitation controls.
- Add external inference authentication, shared scheduling, cancellation, protocol adapters and metadata-only tests.
- Wire specialist selection, trusted profile instructions, tool allowlists and personal task receipts.
- Validate responsive UI in a real browser, rebuild/restart the local host, and document tested versus unconfigured capabilities.
- Configure the actual public hostname/tunnel after the owner authorizes Cloudflare setup in their own browser. No password sharing or domain purchase is required for the current Workers option. Never publish the owner listener or claim an unconfigured public URL is live.
