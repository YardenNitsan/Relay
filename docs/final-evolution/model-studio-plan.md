# B07 Model Studio implementation plan

Status: source audit and design decision; implementation is next. Existing model management is functional but remains a long mixed list of model facts, evaluations and provider forms. This plan does not mark B07 complete.

## Product decision

Use the selected Relay Studio language: a searchable model catalog beside one focused inspector, with Connections as a separate destination inside the same dialog. On compact windows, catalog and inspector replace each other; an explicit return control restores focus to the inspected model. The defining relationship is model identity → advertised/estimated facts → measured evidence → deliberate action. Avoid decorative scores, loading merely on selection, or a grid of identical cards.

Keep React, TanStack Query, semantic HTML, existing self-hosted typography and semantic tokens. No new dependencies are justified. Reuse the existing modal focus/draft guard and model picker. Maintain the current `Models` export and `ModelList` type so callers and server contracts remain unchanged.

Alternatives considered: a sortable table is efficient on wide screens but hides the explanatory evidence needed here; retaining a vertical card list preserves state easily but scales poorly and mixes administration with selection. Catalog/inspector wins on progressive disclosure, provided evaluation state and credential drafts survive navigation correctly.

## Implementation order

1. Add browser regressions for returning to an active capability/coding evaluation after closing model management. Existing `ModelEvaluation` and `CodeEvaluation` keep the started task ID only in component state; reopening can lose the stop control even though durable history records `taskId`. Recover the current run from authenticated history and its actual task status. Calibration already derives its run from history. Do not infer completion or permit duplicate starts while history/status is unresolved. Verify failure, cancellation and missing provenance.
2. Extract provider connection presentation to `web/features/models/ProviderConnection.tsx`, preserving enabled/check/key-save/key-remove/Google consent behavior. Add the existing modal guard for unsaved in-memory credential input and pending mutations. Never retain credentials in browser storage. Forced account/session teardown must still clear the view.
3. Create `ModelStudio`, `ModelCatalog`, `ModelInspector` and feature-owned CSS. Keep `web/components/Models.tsx` as the compatibility entry. Catalog search/location filters and refresh remain; opening and deliberate refresh use `/models?refreshLocal=1`. Navigation and inspection must never call load/evaluate endpoints. Cached models remain inspectable during a refetch error.
4. Inspector shows identity, runtime/quantization, provider availability, advertised capabilities, context/weight estimates, measured speed or unknown, and separate input/output cloud prices. Hardware assessment remains an explicit operation with its actual confidence/reasons. Use model opens the existing picker so reasoning and cloud-sharing policy remain intact.
5. Preserve all four local measurement actions: performance calibration, task-fit probes, capability evaluation and executable coding evaluation. Keep consent, limits, sandbox refusal, cancellation, configuration provenance and ranking limitations. A new visual layout must not detach an active run from its stop action.
6. Connections clearly distinguishes per-account cloud credentials from owner-only host runtimes. Preserve Google app setup/consent/disconnect and all current provider actions. Provider presence is not connection success or task-sharing authority.

## Verification

Start with failing browser tests for active-run recovery and new catalog/inspector navigation, then implement. Preserve existing models-discovery, model-picker, calibration, model-evaluation, shared-host and google-signin assertions; adapt navigation only when the product interaction genuinely changes. Add credential discard/busy guards, refresh failure with cached data, long names/unknown prices and compact focus/resize checks.

Run strict types/full relevant tests and production build before one browser fixture. Inspect actual desktop/mobile light/dark captures with representative local/cloud/offline models; include loading/error/empty and active evaluation. Check no page overflow, readable facts, reachable actions, keyboard focus, axe and short landscape. A mocked browser evaluation proves presentation only; retain separate actual-model evidence and do not reinterpret it as provider acceptance.

Update README/user guide, design review, acceptance results, requirements matrix, progress.json and continuation after the verified increment. Keep routing-quality, full performance and broader platform gates open. Never rebuild dist while a browser fixture serves it.
