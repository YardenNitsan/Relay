# Provider model selection, reasoning and economical Auto

User addition, 10 October: connected providers must appear as identifiable groups, opening a side panel to choose an available model and its supported reasoning. Auto must consider authorized local and connected cloud models, choose reasoning appropriately, and avoid unnecessary token spending. This extends the original routing/UI directive; the reliability work remains in scope.

## Design and boundaries

- Preserve actual per-user discovery and existing credential storage. A configured key is not proof of every model's availability. Never populate selectable models from a public catalog alone.
- A compact composer trigger opens a native dialog styled as a right-side panel. Provider navigation, searchable models, then model-specific reasoning follow one path; narrow phones use the same controls in a single column. Reuse Relay's graphite/teal tokens, bundled Plex type and focus/reduced-motion behavior. Selection is editable configuration and never submits an objective.
- Keep provider connection management separate from task egress permission. Choosing a cloud model with local-only sharing must present an explicit sharing choice before applying; no invisible privacy downgrade. Auto keeps local-only behavior until cloud sharing is explicitly authorized.
- Add validated task reasoning preference and discovered/documented model-specific controls. Unknown support remains unknown. Explicit unsupported settings fail before inference; Auto chooses only supported settings. Preserve local thinking separation and private provider continuation.
- Keep output ceilings fixed unless the user changes them. Reasoning effort is not a hard spending cap. Reconcile provider-specific thought/output accounting and cost reservations, especially Gemini transports and Anthropic thinking budgets.
- Auto uses task demand, eligibility, known costs, measured evidence where compatible and conservative fallback. Never invent cross-model quality confidence or transfer benchmark scores. Explain selected model/effort and uncertainty. Expensive maximum effort is manual; simple prompts incur no classifier model call.
- Retain account/provider permissions, task financial/call/iteration limits, hardware admission, exact cloud approvals and external-client separation.

## Work and acceptance

1. Research exact current provider reasoning/discovery/output contracts and record official sources; evaluate maintained routing approaches without adding a service.
2. Add server-owned reasoning contracts, adapter serialization and usage-accounting tests. Validate provider-specific settings; no live paid calls required.
3. Extend deterministic routing with model-and-effort decisions and cost eligibility; test local-only, account isolation, unknown prices, required models, budget ceilings and simple/complex objectives.
4. Implement responsive provider/model/reasoning picker and connect management selection. Test connected/unavailable states, explicit sharing, persistence, keyboard focus/Escape, 320/390/tablet/desktop and no automatic task submission.
5. Run relevant provider/routing/security tests, full check, production build and browser acceptance; visually inspect. Update evolution ledger/report with limits and live-provider verification still required.

Research completed; contracts and limitations recorded in model-selection.md: OpenAI Responses reasoning (model-dependent levels, output ceiling includes reasoning); Anthropic model capability metadata/adaptive thinking; Gemini Interactions versus GenerateContent controls and thought usage; xAI Responses effort; DeepSeek metadata-defined effort. Implementation must follow the inspected sources, not assume identical fields across providers.

Implementation completed for items 1-4. Focused provider, router, pricing and Engine cases passed; seven initial browser cases passed. Final lazy-panel/dark-mode/combined validation follows in docs/validation.md. No live-provider or broad quality claim.

Item 5 completed for available deterministic/browser environments: 986 backend cases plus one platform skip, strict types/build, 82/83 full browser cases and 25/25 rerun after test-only pacing; stable captures reviewed. Details and limits in validation.md.
