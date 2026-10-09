# Architecture and decisions

## Private workspaces, model evidence and request protection

Managed workspaces now have an immutable nullable owner identity in both database and broker metadata. Personal ownership grants the account its own file-autonomy choice; shared workspace grants, unrestricted local-owner host files, provider use, tool networking and cloud egress remain independent. All manual edits use expected-content hashes and recovery checkpoints. Browser device folders remain on the client: Relay receives only an explicitly imported copy, and reviewed write-back is a separate browser-authorized operation.

Local discovery is shared across per-user provider gateways; opening Models forces installed-catalog refresh with in-flight coalescing. A task's specialist and disclosed keyword heuristic select a category; fixed optional owner probes attach only to matching local artifact/runtime identities. Eligibility and hardware admission run before ranking. Both ordinary and specialist inference acquire the same local lease as external clients, recheck memory after waiting, and monitor remaining host memory during generation. Unsafe or unavailable telemetry cancels the request and pauses rather than silently rerouting.

One output-budget policy feeds context fitting, provider limits and cost reservation. Efficient mode trims forbidden tool schemas without bypassing the broker or dropping verification evidence. Actual provider usage remains authoritative; bytes removed are not advertised as exact tokens saved.

Google OAuth is a shared host service with per-user credentials, session-bound PKCE, OIDC signature/nonce validation and an OS-keyring-only secret boundary. Callback query secrets are scrubbed before the browser app renders. A durable selected-credential marker prevents an old Gemini environment key silently reappearing after Google disconnect. OAuth Gemini uses GenerateContent; API-key Gemini retains its existing adapter. The owner's quota project and its billing implications are explicit.

Task notifications consume authenticated persisted events and tracked task identities. Historic completions and replay do not become fresh success notifications. System notifications require an explicit browser permission and use generic content. Closed-browser push and scheduled reminder delivery are separate, unimplemented services.

## 0.1.1 account and gateway extension

The host now separates four transport boundaries: owner loopback (4317), optional account-authenticated LAN HTTPS, signed browser Access gateway (4318), and inference-only local API (4315). An optional separate service-identity gateway (4320) handles external inference. The public browser deployment may use a stable `workers.dev` Worker with a fixed VPC Service through Cloudflare Tunnel; it binds only the browser gateway and forwards streaming responses without retaining content. There is no owner API or raw model-runtime exposure.

Provider credentials and cloud discovery/settings are scoped by immutable Relay user ID. Local model discovery is shared, and the engine resolves the account's provider gateway from the durable task owner. External clients authenticate through hash-only, expiring tokens, share the local inference lease and hardware admission, and persist only operational usage metadata. They do not enter the conversation/task/tool pipeline. Account and stop controls revoke both forms of execution.

The ten selectable assistant profiles are distinct from DAG roles and models. Trusted profile instructions are inserted into worker context, and their tool allowlists intersect existing task/account capabilities. The personal-task broker uses authenticated durable task identity, transactional stop/session checks and per-user PostgreSQL records. Gmail/Calendar, interactive browser and desktop integrations remain explicitly unconnected. See [extension plan](plan-network-agents.md), [external clients](external-clients.md), [LAN guarantees](lan-access.md) and [Google connector plan](google-agents.md).

Research date: 2026-10-04. Source details are in `research.md`; these decisions describe the implemented core. `validation.md` records unimplemented capabilities and unverified platform guarantees.

The 9 October provider extension adds Grok through xAI Responses and DeepSeek through its Chat Completions stream, alongside the existing providers. Native continuation remains provider-scoped and private. DeepSeek tool requests disable thinking when earlier assistant history lacks native reasoning, rather than fabricating reasoning or replaying redacted data. See [provider research](research-xai-deepseek.md). An authenticated Usage query aggregates account-owned database records and last-observed supported rate headers without introducing a billing proxy or extra generation calls; see [usage semantics](usage.md).

```mermaid
flowchart TD
  UI[Browser conversation and activity] --> API[Loopback HTTP API and replayable SSE]
  Remote[Optional remote browser] --> Edge[TLS tunnel and established identity]
  Edge --> Gateway[Separate signed-identity loopback gateway]
  Gateway --> Policy[Invited user grants and quotas]
  Policy --> Tasks
  API --> Tasks[Durable task controller]
  Tasks --> Supervisor[Bounded supervisor and DAG executor]
  Supervisor --> Router[Model registry and explainable router]
  Router --> Resources[Hardware admission and serialized local inference]
  Resources --> Providers[Local and cloud provider adapters]
  Supervisor --> Broker[Capability and approval broker]
  Broker --> Files[Managed workspace and artifact tools]
  Broker --> Container[Isolated container commands]
  Tasks --> DB[(PostgreSQL records and events)]
  Broker --> DB
  Supervisor --> Verify[Evidence verification]
```

## ADR001: TypeScript modular monolith

Node 24, Fastify and strict TypeScript provide cancellable streaming IO, subprocess supervision, runtime schemas and a shared browser contract. Python/FastAPI is strong for in-process ML; Relay delegates inference to existing runtimes, so a second language and environment do not currently justify their operational cost. Modules remain separate: persistence, events, orchestration, providers, resources, tools and API.

## ADR002: PostgreSQL with an embedded local option

Native PostgreSQL is supported through `DATABASE_URL`. A local single-service install defaults to ElectricSQL PGlite: the actual PostgreSQL engine persisted on the backend filesystem, not browser storage. It avoids requiring an unavailable Docker daemon or machine-wide database service. PGlite is single-connection: serialize transactions and use one service process; do not claim multi-process queue semantics. Parameterized SQL and migrations are compatible with native PostgreSQL. Native deployments use a dedicated database role. SQLite was simpler operationally but would diverge from the requested PostgreSQL/pgvector path. Current context uses bounded recent messages, task findings and saved step context; semantic retrieval and history summarization remain unimplemented.

## ADR003: Small custom execution core

LangGraph provides persistence/checkpoint and interrupt primitives; PydanticAI and Microsoft Agent Framework offer agent workflows; CrewAI Flows support event-driven state. They do not replace OS policy, resource admission or a product-specific durable tool ledger. The initial bounded DAG and role loops are small enough to own, avoiding framework state parallel to application records. Explicit states, persisted graph steps and bounded retry rules are prerequisites. No claim of exactly-once external effects: uncertain interrupted operations pause for inspection.

## ADR004: Same-origin HTTP and SSE

Commands use validated HTTP mutations. Ordered persisted events stream over SSE with event IDs, heartbeat, reconnect/replay and bounded batches. Browser websocket bidirectionality is unnecessary. Host/origin checks, strict HttpOnly session cookies and a per-session mutation CSRF token protect the local service against hostile browser origins. Local owner sessions require a five-minute single-use pairing code delivered through OS-account-protected storage; unpaired native loopback requests cannot bootstrap owner authority. The remote gateway has a separate signed-identity boundary. See [pairing security and native platform limits](security-model.md).

## ADR005: Tools cannot borrow host authority

Files operate in service-managed workspace snapshots. Source imports exclude secrets, links, Git internals and large/generated trees. Mutations create content checkpoints and reviewable diffs. Source repositories are not automatically modified. Terminal uses a fixed trusted Node 24 supervisor in a Linux container, with a read-only helper mount and bounded stdin snapshot input. Agent writes occur only in size/inode-limited tmpfs; there is no writable host workspace mount. The supervisor drops worker UID/GID and capabilities, verifies seccomp/no-new-privileges, terminates remaining workers and exports a bounded snapshot for host validation and checkpointing. Network, root-filesystem writes, persistent container logs and provider environments are disabled. Aggregate host storage admission is separate from kernel container limits. Real Docker enforcement remains unverified; unavailable daemon/image/preflight means no host fallback. See [implemented command security and validation limits](research-security.md). Windows AppContainer/Job Objects and Linux bubblewrap/cgroups remain potential native brokers. The local-owner host-file broker separately permits confirmed direct native file operations through deterministic path policy; see [scope and limits](host-access.md). Arbitrary native commands remain unavailable.

Structured `http_get` has separate public-origin authorization and DNS/TLS pinning. `git_status` and `git_diff` use installed Git against managed Relay baselines without source repository configuration. Controlled `mcp_call` uses the official SDK with owner-pinned tool catalogs, scoped server/network grants and exact-operation approval. Descriptions and remote results remain untrusted context. See [research/Git](research-and-git-tools.md) and [MCP boundaries](controlled-mcp.md).

## ADR006: Provider and resource boundaries

Ollama native discovery/metadata/streaming is the first real local path. Model metadata includes provenance, unknown values and measured usage. Conservative admission includes model weights, architecture-derived KV cache where available, runtime buffers, requested context, host pressure and safety reserves. Serialize local generations initially. Do not unload models not owned by Relay. Cloud adapters use fixed official endpoints and server-side OS keyring/environment credentials. No silent cloud fallback or credential logging.

## LM Studio runtime boundary (10 October 2026)

The native LM Studio catalog omits the GGUF attention geometry used by Ollama admission. The maintained MIT `@lmstudio/sdk` is therefore used for local-only resource estimates and cancellable explicit loading; the existing OpenAI-compatible streaming adapter remains. Estimation and execution share context, offload, batch and concurrency settings. The host rechecks physical memory and owner policy immediately before loading, validates the resulting configuration, and releases only its unique instance before freeing the shared local lease. Experimental/invalid estimates fail closed. This avoids writing a GGUF parser or treating model weight size as total memory. See [exact accounting and limits](local-inference.md).

An OS integration module starts an installed service through fixed CLI arguments at host startup, on loopback only. It does not expose subprocess control to agents, download weights, evict unrelated allocations, or require Internet access. Unknown occupied listeners and custom endpoints are left alone. Fully GUI-less operation requires the vendor's llmster installation; native Linux/macOS and Apple/AMD inference acceptance remain separate validation work.

## ADR007: Browser stack and design

React + TypeScript + Vite; server state is distinct from transient view state. The browser is a client app with no SSR need. Semantic HTML/native controls and accessible dialog primitives keep the dependency set focused. Markdown disables raw HTML. Large work logs are bounded/paginated; diffs load when opened. Custom tokens and purposeful typography avoid a stock dashboard. No hosted Sites runtime can replace the privileged local service.

## ADR008: Shared host with explicit OS integrations

The core targets Node.js 24 on all three operating systems. WindowsHost, LinuxHost and MacOSHost provide native data conventions and credential backends. Hardware collection uses cross-platform systeminformation, with unified memory as a distinct budget architecture. Structured file operations are portable. Commands require a verified Linux-container boundary; no platform is silently granted host-shell execution. Separate portable packages include appropriate per-user startup templates. Native installer signing and OS-specific sandbox implementations are release work, not equivalent guarantees inferred from portable code.

## ADR009: Optional authenticated remote listener

The initial supported public architecture is Cloudflare Tunnel + Access, with signed JWT verification repeated by the host. A separate loopback listener receives only gateway requests and cannot bootstrap a local owner. Local port 4317 remains independent. Tailscale is a useful private-network alternative, but its identity headers require a different verified adapter; arbitrary forwarded headers are not trusted. Users, sessions, conversations and tasks have explicit ownership. Remote grants independently restrict providers, workspaces, access and budgets. The local owner alone manages secrets, users and global stop. Separate OS process identities would strengthen isolation in a future distribution.

## ADR010: Fail closed on unknown evidence and cost

A model's confidence is never a passing test. Actual tool checks have stable identities and an ordered ledger; successful repair supersedes an earlier failure without deleting history. A response without external verification is labelled generation-only. Interrupted side effects require inspection. Cloud costs are reserved atomically before requests; unknown usage retains its reservation. A strict budget rejects unknown model prices. This sacrifices availability where metadata is missing in exchange for honoring the owner's boundaries.

## ADR011: Constrained adaptive planning and durable repair

Deep and maximum execution can adapt the specialist graph after planning. The planner proposes only a list of permitted specialist roles, acceptance criteria and a short justification. A strict schema rejects extra fields, privileged/duplicate roles and roles outside the selected depth. The core constructs all dependencies and retains the worker and final reviewer. Invalid proposals keep the original bounded graph. The proposal decision and resulting graph are committed together and are not regenerated on resume.

Ordinary Balanced conversation uses a single worker when no specialist, workspace, host-file capability, network/MCP tools or required verification is selected. The graph choice follows explicit task capabilities, not a keyword guess about the objective. Tool-enabled and specialist Balanced work retains its reviewer; Deep and Maximum retain their planning/review graphs. The stored analysis event identifies the chosen strategy while preserving the user's selected depth.

Balanced and deep tasks permit at most two automatic repair rounds; maximum permits three and fast permits none. Repairs preserve worker tool receipts and append review/check feedback, reset the reviewer, and consume the same task call/time/cost budgets. The round count persists across restarts. Denied capabilities and ambiguous interrupted effects do not become retry invitations. A review must end with an explicit passing verdict, which remains a model assessment; unresolved actual checks prevent completion independently. Failure of a parallel branch cancels and joins siblings before releasing the task slot.

This follows the useful orchestrator/worker and evaluator/optimizer patterns in [LangGraph's workflow documentation](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents), while retaining Relay's normalized evidence, policy and execution authority. It is bounded adaptive planning, not arbitrary model-authored executable DAGs or unrestricted debate.

## ADR013: Explicit required evidence

Authenticated callers may add bounded `verification.requiredReads` predicates to task options. Each binds a permitted relative path to an expected whole-file SHA-256. Actual successful broker read receipts after the latest workspace change satisfy the contract; model prose cannot. A missing predicate causes bounded factual continuation and prevents the final assistant message. Database completion independently checks these predicates. See [ADR013](adr-013-required-verification-contracts.md) for failure behavior, shared-workspace invalidation and the API-only scope of initial contract declaration.
