# Studio visual and interaction review

## 0.1.3 Model Studio review

The inspector uses one reading column on phones and a persistent catalog on wide screens. Model identity, account availability, context, unknown weight/performance evidence and separate input/output costs remain readable without horizontal page scrolling. Inspected412px dark and1440px light captures are retained in evidence/models-after-*.png alongside the inherited before capture. Tested320–1920px and short landscape in both themes, including keyboard focus after resize, cached discovery failure, empty states and credential draft dismissal.

Exact provider/model IDs are now visible and searchable. Inspection does not load a model; consequential measurements have explicit controls. Recovery tests cover reopening an active evaluation, queued admission before reports exist, lost mutation responses and slow reconciliation. Physical Android keyboards, Samsung Internet, large text/display zoom and remote mobile-data flows remain unverified. This review accepts the bounded Model Studio increment, not the complete22-view redesign.

This is an evolving review record, not certification or completion of milestone B.

## Foundation reviewed

- Semantic light/dark tokens and adaptive navigation render at phone and desktop widths. The initial 28-case browser subset passed, including streaming, emergency stop, actual fixture approvals/diffs, keyboard navigation and automated accessibility checks.
- Captures were opened and inspected, including 390px light, 1440px dark, and the 701px split view. The new welcome has a smaller document heading and working draft starters. All old welcome rules were removed rather than kept as overriding layers.
- The mobile model trigger visibly lost its Auto label. A new geometry assertion reproduced the failure at 320px. Explicit grid placement and a 44px target fixed the six-width regression subset.
- Focused review identified welcome overflow inside a narrow split pane. Container queries fixed the measured overflow; actual browser inspection still showed the overall 701px split was too cramped. Workbench now uses one view below 1000px. Integrated browser checks verify draft preservation and focus transfer from the hidden composer, rail and expand control.
- Desktop account and secondary destinations are reachable from More & account. Existing owner gates, command palette, modal focus restoration and API behavior remain under regression testing.

## Workbench reviewed

Opened and inspected actual fixture captures at 390px in both themes, 1440px light, branching presentation at 1024px, and an 844x390 pending approval. Dependency levels preserve long model names, distinguish model output from independent checks, and do not imply actual parallel execution. Branching data is an explicit presentation fixture, not multi-agent outcome evidence. Captures are retained under `evidence/workbench-*.png`.

Review found that objective context outside the body could crowd approvals out of short screens, and resizing could strand keyboard focus on hidden controls. Objective context now scrolls inside the body, with bounded expanded prose. A remembered-focus hook transfers focus when CSS has already hidden the old active element. Actual browser regressions cover desktop-to-phone and short landscape; denial remains reachable and operates on a real fixture approval. At 390px height the remaining inspection viewport is small; a more focused approval surface remains B09 work, not a solved full-product usability claim.

The 52-case integrated run passed 51 cases. Its long-objective setup initially hit the real context-admission safeguard before approval; selecting an explicit 16,384-token budget made the intended approval scenario pass. No production budget or safeguard changed. A previous full foundation run passed 115/117: an obsolete exact palette expectation and Chrome `ERR_NO_BUFFER_SPACE` during chunk loading were recorded; both affected flows pass in the integrated subset. The subsequent frozen c861696 build passes the complete 125-case browser gate in 16.1 minutes.

## Per-surface gate

For each redesigned surface, retain realistic screenshots and verify:

- Light and dark; 320/360/390/768/1024/1440/1920/2560px and short landscape as applicable.
- Actual loading, error, empty, long-content and active states; no invented progress or service availability.
- No document overflow, clipped critical actions or uncontrolled layout changes.
- Text and control contrast, visible keyboard focus, semantic names and touch targets.
- Open/close/resize focus, keyboard interaction, draft retention and reachable approval controls.
- Streaming, long history, large diffs and dense graphs with bounded rendering.
- Existing authentication, grants, file actions and integrations remain reachable and functional.

| Surface | Current review status |
| --- | --- |
| Shell and welcome | Visual review and full 125-case Studio browser gate pass at c861696; future increments verified separately |
| Conversation/composer | Welcome and model-trigger changes reviewed; full composer/message redesign remains open |
| Workbench | Dependency layout, output/log/check separation, focus and short-screen controls reviewed; handoff/artifact depth and full-state coverage remain open |
| Projects | New index/inspector and persistent file actions inspected in light/dark on phone/desktop/short landscape; loading/error/empty inspected. All18responsive cases pass; final8affected cases pass. Hosted full gate pending; richer Git/test/memory workflows remain open. |
| Model Studio | Existing view retained; redesign open |
| Devices/connections | Existing view retained; Companion implementation and redesign open |
| Approvals | Focused consequence-first review inspected at 320/1440px in both themes and 844x390 rejection; five focused and 41 affected browser checks pass. Other sensitive-operation states remain open |
| Settings/onboarding | Existing flows retained; redesign open |

Automated axe results supplement screenshot and keyboard review. They do not establish complete WCAG 2.2 AA conformance.

## Focused approvals and draft preservation

The focused review resolves the earlier short-screen inspection problem: its independently scrolling body and fixed decision/error footer retain at least 140px of body at 844x390 and reachable 44px decision targets. Actual fixture screenshots were opened in light/dark at 320 and 1440px, plus the short-landscape rejected decision. Escape restores the review trigger; a resolved approval moves focus to the visible Workbench. The injected rejection tests UI feedback only, not account-revocation acceptance. Actual denial and approved managed writes pass. Proposed source and exact arguments remain untrusted text with bounded previews and full downloads. Cloud egress has one-request consent only. No accessibility certification is claimed.

A real delayed-message request reproduced loss of newer composer text after a successful send. Clearing only the submitted draft fixes this; the browser checks preservation after completion and reload in a saved conversation. Full conversation/composer redesign remains open.

## Publication presence review

Inspected actual 320px light and1440px dark captures after five real publication browser cases passed. The selector and consequence text distinguish additions/deletions/modifications; exact views distinguish an absent file from a zero-byte file. Diff/contents scroll within the existing Workspaces dialog, consent remains reachable and disabled until checked, and axe/overflow checks pass. The current dialog still requires scrolling between a long diff and consent; the dedicated Project Workspace redesign is B06 work, not completed by this integration.
## Actual inference observation, 10 October

The source-scale coding driver was observed through the real authenticated private API host while local inference and tool calls were active. Chrome captures at [1440px/light](evidence/coding-live-1440-light.png) and [390px/dark](evidence/coding-live-390-dark.png) were opened and inspected. Long objective/model identity remain readable, Workbench becomes a focused phone surface, no horizontal overflow was measured, and the WCAG-tagged axe scan found no violations in these two states. The model subsequently paused with a failed repair/output limit; these screenshots are active-execution evidence, not successful task or full accessibility acceptance. The first capture attempt used an unavailable Playwright bundled browser; the rerun used the installed Chrome channel, matching local E2E configuration.

## Project Workspace review

Replaced the old combined workspace form/list with separate project inspection, conversation selection, file editing, source review and browser-folder views. Actual17-file long-path fixtures cover every requested width in both themes plus short landscape. Before/after captures are linked in acceptance-results.md. The final review removed unused editor space, kept save/download/delete/close visible, shortened the landscape header while retaining a44px close target, and added an explicit first-workspace action on phones. Red/green browser evidence covers lost drafts, background refresh, shortcut replacement, view/resize focus, busy operations and same-file re-click. Exact source APIs and permissions remain unchanged.

No unexpected horizontal overflow or axe violations were found in these tested states. Short landscape still uses a scrolling content body; large real diffs, text scaling, physical mobile keyboards and deeper project history remain open acceptance. The screenshots do not imply Git worktrees or project memory exists.

## B04 conversation review, 11 October

Inspected actual [390px light composer](evidence/conversation-studio-390-light.png), [populated390px dark conversation](evidence/conversation-studio-390-dark.png), [1440px desktop](evidence/conversation-studio-1440-light.png) and [320px dark host recovery](evidence/gateway-offline-320-dark.png). The composer uses one context row, editor and action row; execution controls live in a scrollable dialog. The phone four-line draft occupies about220px rather than the previously observed345px control stack. Human and Relay output have separate author regions; Hebrew prose flows RTL while code remains LTR and keyboard-scrollable.

Review found and corrected lost numeric validation and hidden unconfirmed host-access state after project navigation. Red/green regressions cover those and pending workspace preparation. The tablet extension found an invalid aria-label on the host container; its group role now passes final browser/axe verification. Inspected [768px touch layout](evidence/conversation-studio-768.png) and [320px Economy selection](evidence/model-policy-economy-320.png); the latter retains a reachable fixed footer and separate sharing controls. These captures and simulated viewport checks do not establish physical Android keyboard, Samsung Internet, mobile-network interruption or complete WCAG compliance. The owner has explicitly rejected deployed0.1.2 as a final design; no final-design approval is inferred.

## Agent Studio, 11 October

Inspected actual320px light/dark index and Browser inspector,1440px light index and844px dark short landscape. Continuous role rows, a readable selected-role document and a separate action footer replace the former card stack. Names, tool access and unsupported live actions remain explicit. Search and list position survive phone detail navigation; focus returns to the row or the retained search field if that row was filtered out. New browser checks cover320/360/390/412/844/1440px in both themes, no unintended horizontal overflow and no violations in the scoped WCAG-tagged axe scans. Pending preparation blocks duplicate selection and deliberate dismissal; failed preparation keeps the inspected role and allows retry.

Before capture: `output/final-evolution/agent-studio-before-320.png`; after captures: `output/playwright/agent-studio-*.png`. These are implementation review artifacts. Actual agent task outcomes, real mobile keyboards, physical-phone validation and the full-platform design remain open. Removed only the30 obsolete old-agent CSS lines after checking live callers and retaining shared client/composer rules.
## Supporting Studio review, 11 October

Inspected actual Memory390dark/1440light and Scheduling390dark/1440light captures. Memory uses a readable note alongside a searchable index on desktop and a focused document on phones. Scheduling uses a continuous agenda and dedicated creation/review view with reachable scrolling form controls. Host Overview/Model safety/Recovery has passed eleven focused browser checks, including eight size/theme states. These captures do not establish physical keyboard or final product acceptance.

The first coordinated68-case browser run passed64. Four History cases exposed the same initial-focus ordering defect: React autofocus preceded native showModal. The existing Modal initialFocus prop now selects the History search input after opening; fresh-build acceptance is still required. No assertion was weakened. Scheduling review corrections retain successful enable/archive acknowledgements through delayed failing reads, reset discarded authorization and block navigation during task lookup.

Access, External Clients, Google Workspace, Usage/Diagnostics and Connection have complete source implementations awaiting coordinated fresh-build browser acceptance. Eight old-build negative cases demonstrate the missing credential/draft/operation guards and delayed acknowledgement behavior; before captures390/1440 are retained in output/final-evolution. Independent review corrected focus after token/session removal and added an explicit token reveal control for manual copy when clipboard access fails. The route/configuration/account boundaries remain unchanged.

Caller-based CSS cleanup removed57 obsolete Connection/History/Usage rules and11 client-only rules. Mixed LAN rules and the one-time LAN invitation styles remain live and were preserved. The unreferenced36-line old Google Workspace stylesheet was removed after the feature switched to its scoped replacement. Native modal, resource-policy, file/publication and account-security behavior remains in scope for regressions.

12 October visual inspection: [History at390px](evidence/history-studio-390-dark.png) preserves a readable English/Hebrew timeline and reachable search/page controls. [Google Workspace at320px](evidence/google-workspace-studio-320-light.png) gives the selected message a focused document; untrusted markup renders as literal text. [Connection on desktop](evidence/connection-studio-1440-dark.png) separates pairing from a factual execution/access boundary. [External Clients at320px](evidence/clients-studio-320-light.png) keeps grant identity, expiry and revocation readable without horizontal overflow. These are rendered Chromium captures, not final owner approval or physical-device acceptance.
