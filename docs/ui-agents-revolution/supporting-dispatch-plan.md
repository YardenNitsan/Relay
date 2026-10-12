# Dispatch accounts and connections

Frontend-only continuation, 12 October 2026. Align Access, external Clients, Google Workspace and MCP with the selected [Dispatch design](design-decision.md), [navigation/preferences document](navigation-settings-plan.md), and existing [MCP behavior plan](../final-evolution/mcp-studio-plan.md).

Access is a permission document: a compact people index leads to one account's policy, while gateway, session and active-work sections retain their existing navigation. Clients is a grant ledger with a separate connection-reference margin. Google Workspace is a read-only search/list/reader with a clear account connection boundary. MCP is a saved-server index and endpoint/contract document. Use the existing semantic plum/neutral colors, IBM Plex typography, plain headings, dividers and selected-row treatment. Avoid new status claims, simulated metrics, decorative card grids or new APIs.

Own only the four feature directories and their scoped styles. Add presentation wrappers/headings and improve hierarchy/spacing. Retain every hook, query key, handler, mutation acknowledgement, operation lock, secret reveal rule, consent text, owner gate, draft guard, focus ref, responsive breakpoint and scroll owner. Keep exact accessible action names and existing test selectors. Do not change shared Modal, App, global tokens or backend code.

Preserve 44px controls and the existing short-height adaptations: Access frees its header, MCP scrolls its whole index, Clients scrolls its document and Google Workspace scrolls its whole content at short heights. Syntax/type checks are allowed; root owns builds, browser fixtures and actual capture inspection. Existing access-studio/access, clients-studio/clients, google-workspace-studio/google-workspace, mcp-studio/mcp and dialog-viewport tests are the intended regression coverage. Presentation changes alone do not require redundant tests.

## Implemented checkpoint

Updated nine scoped files: the four primary feature TSX files, their four stylesheets, and MCP `ServerInspector.tsx`. Identity headers now match Dispatch's restrained document treatment. Access has a compact account index and divided policy sections; client grants use a ledger with a quieter endpoint-reference margin; Workspace distinguishes the search index from a readable message document; MCP distinguishes server selection, endpoint identity and actual pinned contracts. Existing return paths, focus refs, button names, consent/boundary copy and all data/action logic are retained.

`npm.cmd run typecheck` passed (exit 0). Installed esbuild parsed the five changed TSX files and PostCSS parsed all four scoped stylesheets; `git diff --check` passed with only existing working-copy line-ending notices. No browser fixture, build, model workload or dependency installation was run. Rendered layout/accessibility and behavioral regression acceptance remain root-owned and pending; this checkpoint does not claim visual acceptance.

## Integrated checkpoint

Root strict production build and rendered acceptance are recorded in [testing](testing.md): initial core92/94, corrected/supporting111/111, scheduling/initial landscape24/24, and final strict landscape/History/viewport14/14. Actual screenshot review is in [design review](design-review.md). Earlier source-only statements above describe the development checkpoint, not the latest acceptance. Physical-device, deployment and final-head CI remain separate.
