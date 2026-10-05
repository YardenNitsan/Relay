# Research index and decisions

Research date: 2026-10-04. Research preceded implementation and continued when actual runtime behavior contradicted assumptions. This index links primary sources; focused documents contain protocol details, alternatives, threat models and implementation limits.

## Execution frameworks

- [LangGraph durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution) and [interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts): persistence and resumable control are valuable; replayed side effects require explicit durable boundaries.
- [PydanticAI durable execution](https://ai.pydantic.dev/durable_execution/): typed agent IO does not itself supply task durability or OS policy.
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/): workflow and agent abstractions are useful references for separating a role from its model and backend.
- [CrewAI flows](https://docs.crewai.com/en/concepts/flows): flow state and events support structured collaboration, but do not replace resource/capability enforcement.
- [Anthropic building effective agents](https://www.anthropic.com/engineering/building-effective-agents): bounded, composable workflows before open-ended autonomy.
- [MCP architecture](https://modelcontextprotocol.io/specification/2025-11-25/architecture) and [security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices): tool-server content is untrusted; protocol connectivity is not permission.

Decision: a small custom durable DAG/controller with normalized records. No framework's implicit state or model handoff is a security decision. Independent specialists run where dependencies allow; local calls still acquire one host resource lease. Model-generated arbitrary graphs, general MCP execution and full debate orchestration remain future work. Current deeper modes provide planning, independent architecture/security analysis, synthesis by a worker and critique by a reviewer.

## Persistence and browser transport

[PGlite](https://pglite.dev/docs/) provides embedded PostgreSQL in the backend for zero-admin local installation. [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html) informs atomic budget/user reservations and data ownership. Native PostgreSQL is optional. No Redis/Kafka/vector service is needed for a single machine. [pgvector](https://github.com/pgvector/pgvector) is a future retrieval option; there is no benefit in embedding every transient event.

[Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), explicit Zod schemas and parameterized queries bound inputs. HTTP mutations plus [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) fit one-way execution activity without a second bidirectional protocol. Events are persisted, cursor-addressed and ownership-filtered.

## Inference, hardware and credentials

See [providers and resource admission](research-providers.md) for current Ollama, llama.cpp, LM Studio, vLLM, OpenAI, Anthropic, Gemini, Metal/NVIDIA and native vault references. A real Qwen thinking-parser failure changed the implementation; the document preserves the experiment and its consequence. A cloud account is optional; unknown prices, missing memory telemetry and unconnected providers cannot be treated as available free capacity.

## Security and remote operation

See [security research](research-security.md) for OS-specific isolation, path/link attacks, secret boundaries, container limits, deterministic stop, ledger recovery and tests. See [remote access](remote-access.md) for the Tunnel/Access versus private-network decision, signed identity validation, sessions, revocation and host grants. The initial gateway is a distinct loopback listener within the monolith; separate process identities would be a stronger future boundary.

## Design and development tools

[UI research](research-ux.md) and [design tokens](design-system.md) explain the conversation-first layout, progressive activity surfaces, typography, responsive navigation, dialogs and status semantics. React/Vite provides a static local client; TanStack Query manages server state. Native HTML dialogs and controls keep keyboard behavior inspectable. Raw HTML is disabled in Markdown and remote images do not load.

Playwright runs actual Chrome and records screenshots at eight viewport sizes. Axe checks selected rendered states; it is not a WCAG certification. Vitest supplies isolated deterministic providers for protocol, orchestration and security tests. The normal host never selects a fixture provider. Runtime acceptance separately exercises installed Ollama through the protected API. Dependency auditing and lockfiles accompany the build. No external plugin was installed merely to decorate the development process.

The [Playwright CI guide](https://playwright.dev/docs/ci-intro) informed the Windows/Linux/macOS verification workflow. GitHub Actions are pinned to commits verified from the official `actions/checkout`, `actions/setup-node` and `actions/upload-artifact` repositories on 2026-10-05. The workflow runs deterministic tests and Chromium with read-only repository permissions, no provider credentials and no deployment step. A configured matrix is not evidence that remote runners have passed; this repository has not been published or pushed.
