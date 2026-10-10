# Architecture decisions

## FE009 — Focused approval review preserves exact consent

An explicit review dialog supplements inline approval controls; it never opens automatically during streaming. Native modal focus/inertness is retained, with Workbench as the fallback when a resolved approval removes the invoking control. A separate decision footer keeps actions and rejected-consent errors reachable in short windows. Unknown consequences stay unclassified; proposed contents and arguments are bounded untrusted text, with complete downloads and explicit truncation notices.

Cloud egress offers one-request consent only. The current backend asks for each exact context and does not retain task-wide cloud consent, so the UI must not suggest otherwise. File/tool task grants remain exact-action/argument grants within existing policy. Model attribution uses the latest recorded identity before the specific proposal, including permitted fallback; a later reroute cannot rewrite an earlier decision's provenance.

## FE-009: Durable overall deadline and bounded reconciliation

Accepted. New tasks default to 86,400 elapsed seconds, bounded to 30–604,800 seconds at every admission path. Derive the absolute deadline from durable creation time and options; do not renew on resume or retrofit historical tasks. Use host time consistently at admission, dispatch, transaction finalization and reconciliation. Poll at one second in batches of 128, using migration 10's partial index to exclude terminal history. Cleanup promises are owned separately so a slow provider cannot block expiry of unrelated work. Shutdown joins scheduler reads and cleanup before storage closes. Durable authorization enforces expiry even before a reconciliation sweep. OS clock correction remains an operational limitation of wall-clock deadlines; active execution budgets remain separate.

## FE-007: New presentation direction

Select Relay Studio after the research and ten-criterion comparison in `design-system.md`. Retain React/TypeScript/Vite and server contracts. Recompose the interface around a task document, explicit navigation and contextual evidence panes; compact windows select one view. Keep authority/device identity and approvals visible. Initial tokens are candidates pending rendered contrast and visual checks. No new component library is installed merely to establish a visual identity.

## FE-008: Portable fixture ownership without a production bypass

Normalize only test-process temporary environment variables to their native real path before fixtures/children start. On Windows CI set the test process token's default object owner to its own account SID, restoring it on exit. Do not take ownership of existing files, relax private storage checks, change machine policy or expose a product test bypass. Separate browser and host jobs retain three-OS coverage and independent deadlines. Local review/tests support the approach; hosted acceptance remains required.

## FE-001: Preserve execution authority while replacing presentation

Accepted 2026-10-10. Keep React/TypeScript/Vite and backend contracts; replace presentation in feature modules. Framework replacement would add migration risk without an observed deficiency. New navigation must not duplicate authentication or infer permissions from visible controls.

## FE-002: Evidence before completion

Accepted. Component existence, fixtures, synthetic benchmark scores, compilation and package creation have different meanings. Record each separately. No unknown price/quality/latency is a zero. A failed candidate optimization can satisfy its experiment only if the better implementation is retained and the result recorded.

## FE-003: Portable tests must honor production boundaries

Accepted. CI temp paths can include Windows short names and macOS aliases; canonicalize the test environment before creating fixture roots. Do not relax `inspectPath`, backup directory refusal or host path policy to accommodate test convenience. Windows administrator-default ownership requires explicit investigation/provisioning; no implicit takeover of existing private data.

## FE-004: Independent development checkout

Accepted. Dedicated `modernization/final-evolution` branch, no changes to unrelated repositories or running production data. Initial hidden worktree exposed a fixture assumption: direct-host tests under `.worktrees` are intentionally denied by host policy. Move the development checkout to a normal sibling directory after the baseline completes; record this as a harness-path failure, not a product regression.

## FE-005: Authority on each device

Proposed for E. Companion must validate local grants and sensitive approvals independently. Host graph plans contain tasks and capability requests, not permission grants. Transport delivery and tool-effect receipts have separate identities; timeout never establishes failure or authorizes replay.

## FE-006: Inline execution and bounded review

Accepted. Use one implementation stream while tracing shared boundaries. Specialist responsibilities are review lenses, not a reason to spawn duplicate workers. A fresh review may be delegated under the applicable execution/review skill after a concrete coherent change exists.

## FE-007: Dependency presentation does not assert execution or verification

Accepted for the Workbench. Group actual recorded steps by dependency level, with explicit names for preceding steps. A level describes dependencies, not concurrent execution. Keep missing, cyclic and duplicate identities visible as unresolved instead of inventing an order. Agent outputs remain labeled model responses; verification comes from the separate recorded checks. The current handoff event contains preparation metadata, not the full handoff: the UI labels it accordingly. No presentation component creates permissions or changes graph execution.

## FE-008: Storage retention must include broker recovery references

Audit finding for A08, implementation still open. Database `artifacts` and `checkpoints` rows are not the entire reference graph: `ToolStore` keeps prepared/committed/reverted checkpoint JSON, publication journals retain recovery state, sandbox markers identify interrupted containers, and host checkpoints live separately. Existing SQL retention deliberately preserves workspace/host tasks and never cleans filesystem artifacts. A future collector must coordinate with the broker mutation boundary, preserve all durable and uncertain-effect references, revalidate after preview, and refuse unsafe filesystem objects. Treating an absent SQL row or an old timestamp as permission to delete a directory would be incorrect. Current behavior preserves these files; it does not satisfy reference-aware garbage collection.
