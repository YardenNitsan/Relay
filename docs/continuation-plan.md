# Continuation: owner access, adaptive execution, and interface refinement

The owner requested completion of remaining work and specifically asked for frontend research from Apple, Meta and other established organizations. Continue implementation without routine design approval gates; retain the prior working flows and truthful release limits.

## Decisions before implementation

- Replace unauthenticated loopback owner bootstrap with an expiring, single-use owner pairing capability delivered through an account-protected host channel. Remote authentication remains independent. Migrate pre-pairing sessions out of trust.
- Keep the small durable orchestration core. For deep/maximum tasks, validate a planner's optional specialist selection and acceptance criteria against a closed schema. Application code constructs dependencies, restricts role counts and preserves worker/reviewer stages. Invalid plans retain the safe default graph; they cannot introduce tools, grants, arbitrary dependencies or budget changes.
- Add a bounded evaluator/repair loop for balanced and deeper tasks. Preserve successful tool receipts, feed actual verification and review gaps back to the worker, require review again and retain all evidence. Persist repair counts. Denials, uncertain side effects, stop and exhausted budgets do not trigger automatic replay. Fast mode remains a single worker.
- Resource presets are owner-controlled host policy, not a remote user's ability to weaken resource admission. All profiles retain hard minimum reserves and fresh resource checks.
- Frontend refinement uses Apple's hierarchy/adaptivity and accessibility guidance, Meta's React state/rendering guidance, Fluent spacing, Material adaptive patterns and W3C keyboard/dialog patterns. Record concrete source-to-design decisions in `frontend-research.md`; preserve Relay's own typography and visual identity.

The orchestration choices follow the separation between workflows, dynamic orchestrator/worker planning and evaluator/optimizer loops described in [LangGraph's workflow guidance](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents). This is an implementation in Relay's existing durable records, not adoption of a second orchestration state store.

## Implementation and evidence

- [x] Local pairing backend, protected delivery, migration and adversarial tests. Exclusive redemption claims pass concurrent requests; previously unpaired sessions lose authority.
- [x] Pairing browser flow and authenticated operating scripts. Session revocation clears private browser state and stops background requests until reauthentication.
- [x] Validated adaptive specialist plans and bounded durable repair tests. Required reviewer context, tool receipts and uncertain-side-effect protections survive continuation.
- [x] Owner resource profiles and scenario tests. Runtime residency is reported independently from estimates; all presets retain hard reserves.
- [x] Research-backed frontend changes; real browser, accessibility and responsive validation. See [frontend evidence](frontend-research.md).
- [x] Integrated tests, production build/restart and actual available runtime checks: Windows/Linux each 249 deterministic tests, 24 Chrome scenarios, actual Ollama supervised write/read with explicit evidence contract, restart persistence and actual SSE heartbeat. Packaging evidence and remaining release gates are tracked in [validation](validation.md).

Independent owners: security worker handles auth/host/API; inference worker handles hardware/provider policy; frontend worker handles browser and browser tests; root handles orchestration/database and final integration. Shared-file edits are coordinated.
