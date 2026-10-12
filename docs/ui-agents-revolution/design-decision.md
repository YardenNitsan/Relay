# Dispatch: selected visual architecture

Selected after rendering all three working offline prototypes at1440×960 and390×844 in both themes on12October2026. Root inspected the actual desktop light and phone dark captures. Prototypes are [available locally](prototypes/index.html); all sample agents, work and decisions are explicitly simulated. No product implementation is claimed by this choice.

| Criterion | Dispatch | Ensemble | Deliveries |
|---|---|---|---|
| Main object / navigation | Decision/task inbox, horizontal app navigation | Selected agent and delegation stage | Result document and review itinerary |
| Hierarchy / everyday clarity | Objective, status and next human action are immediately readable | Relationships dominate; task requires scrolling on a phone | Artifact dominates; incomplete work is secondary |
| Agent collaboration | Ownership and stages fit a focused task inspector | Strongest relationship explanation; risks implying concurrency | Responsibility is attached to results |
| Long conversations / coding | Conversation has its own stable reading surface; evidence opens beside it | Chat competes with large graph | Strongest diff review; chat becomes marginalia |
| Mobile | Explicit inbox/detail progression; smallest navigation burden | Graph occupies the initial phone viewport | Long artifact pushes the decision below the fold |
| Distinctiveness | Task-led workspace replaces Studio's permanent rail and chat landing | Most visually theatrical | Editorial outcome review, visually distinct |
| Accessibility / performance | Semantic list/detail, bounded pages, native navigation | Needs a second linear interpretation and careful focus | Straight reading order but nested diff scrolling needs care |
| Maintainability / scale | Composable work feed, task focus and existing domain modules | More relationship presentation state | Good for final outputs; needs another surface for active work |

**Choose Dispatch.** Relay must make running, blocked, failed and finished work understandable before asking users to navigate a chat transcript. The list/detail pattern works equally for an owner monitoring several tasks and a phone user answering a pending decision. Keep Ensemble's explicit ownership/handoff information inside actual task details. Use Deliveries' readable diffs in project/result review without inheriting its whole navigation system. These are qualitative design judgments, not invented usability scores.

## Product composition

- Horizontal desktop navigation: Work, Conversation, Agents, Projects, Models; command search, appearance and account/host actions remain reachable. No persistent Studio rail.
- Phone bottom navigation: Work, Chat, Agents, Projects, More. A compact header retains host identity, history, new conversation and emergency stop according to authority. No desktop rail squeezed onto a phone.
- Work is the default entry without a conversation URL. A paginated account-scoped task ledger supports local search/filtering, real statuses and selected-task evidence. Page counts describe loaded work only, never global totals or fabricated progress.
- Conversation remains mounted through Work navigation, preserving drafts and `.conversation-scroll`. Open execution transfers to the selected task's conversation and existing verified tool/approval/diff controls. Subsequent surface work will replace those presentations consistently; retaining their behavior is not a claim of complete redesign.
- Native Android uses the same task-first vocabulary and plum/neutral identity, with platform navigation and lifecycle behavior.

## Design tokens

Light: canvas `#f5f3f7`, surface `#ffffff`, ink `#292335`, secondary `#645b70`, divider `#d6cfdd`, action `#693a80`, action wash `#eee4f4`. Dark: canvas `#17141c`, surface `#211c28`, ink `#f4eff8`, secondary `#bdb1c9`, divider `#504559`, action `#d7acec`, action wash `#382842`. Keep success/warning/danger independent of branding and verify rendered contrast.

Use self-hosted IBM Plex Sans for clear engineering prose and UI, IBM Plex Mono for actual code/paths. New hierarchy uses a restrained40px desktop work heading,24px phone heading,18px task titles,14px controls and12px supporting facts. Keep readable line lengths; do not use oversized marketing headers or all-caps metadata. Local licensed fonts avoid a new network dependency.

Targets:48px primary/touch controls, visible2px focus, explicit labels and status text. Motion answers user actions and respects reduced motion; no simulated thinking/progress. Dark/light text and backgrounds switch together. Main task pane scrolls; critical navigation remains reachable at short heights.320px and200%text are acceptance cases, not optional polish.

## First core implementation plan

Files: replace `web/layout/StudioFrame.tsx` and `studio-frame.css` with `RelayFrame.tsx` and `relay-frame.css`; create `web/features/work/DispatchBoard.tsx (including TaskFocus)` and `dispatch.css`; integrate `web/App.tsx`, `web/useRealtime.ts`, tokens, and focused browser tests. Existing routing modules remain untouched.

1. Write browser regressions against old UI for Work navigation, draft-safe view changes, real task feed/detail, current agent/stage/check evidence, loading/error/retry, light/dark/phone/wide geometry and keyboard focus. Observe missing Work navigation failure.
2. Implement a bounded task feed against `TaskFeedPage`v1 and explicit selected task query. Never fan out over every task. Preserve cached feed on refresh errors and label page-local search/filter scope.
3. Implement top/bottom navigation with visible equivalent focus transfer on breakpoints, scoped host/account actions, and a stable hidden conversation container. Retain command/history, theme, emergency stop and all destination callbacks.
4. Integrate the app view into existing URL back navigation; late task openings must not override newer navigation. Refresh feed after acknowledged admission and authenticated non-text events/reconnect.
5. Build, run focused browser and existing navigation/composer/approval/project tests, inspect actual captures and correct regressions. Full UI completion remains open for all remaining screens and states.

Prototype review initially found inappropriate html ARIA and keyboard access to an overflowing diff, plus pale dark-theme surfaces in nonselected concepts. All were corrected; the final twelve-screenshot rerun had no tagged axe violations or document overflow, and the corrected dark views were visually inspected.
