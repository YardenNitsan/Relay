# Research for a different Relay

Inspected 12 October 2026 at `fda18f490d30befc66be88f25bad4e5f44c49b5d`. This is design research and a prototype brief, not implementation acceptance. No dependencies or remote skills were installed. Model-routing research is outside this work.

## Starting evidence

Read `AGENTS.md`, the previous `final-evolution/design-research.md`, `design-system.md`, and `design-review.md`; inspected `web/App.tsx`, `web/layout/StudioFrame.tsx`, `studio-frame.css`, `web/design/tokens.css`, `web/features/agents/AgentStudio.tsx`, and `package.json`.

The old selection of Studio was a written comparison, followed by a rail/conversation/inspector implementation. The current shell has a 176px rail, 72px intermediate rail, phone menu, conversation-first content, and modal destinations. The agent surface is a specialist catalog with inspection and explicit selection. Its controls correctly separate selecting a role from granting authority, but agents are not the primary organizing unit of daily work. Existing semantic tokens, local IBM Plex fonts, draft preservation, focus restoration, viewport handling and durable approvals are useful engineering assets. Their current composition is not an accepted design constraint.

The user rejected another reskin. Consequently, the three alternatives below change the primary object, navigation, task/chat relationship and mobile workflow. None is preselected by this research. Actual comparable prototypes must precede the choice.

## Research to decisions

The source column distinguishes normative requirements, vendor guidance, source inspection and product experience. Relay implications are design judgments, not claims that a cited source endorses Relay.

| Inspected source | Observed guidance or behavior | Concrete prototype decision and limit |
| --- | --- | --- |
| [Apple HIG layout, official structured content](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json) | Hierarchy, alignment, progressive disclosure, text-size adaptation and available horizontal/vertical space organize content. | Put the pending human decision or selected agent's objective first. Recompose at short heights and preserve logical reading order for Hebrew. Do not copy platform glass effects or equate native points with CSS pixels. |
| [Material 3 layout](https://m3.material.io/foundations/layout/layout-overview/overview); [Android canonical adaptive layouts](https://developer.android.com/develop/ui/compose/layouts/adaptive/canonical-layouts) | Material page exposed only a shell. Official Android guidance describes distinct list/detail, supporting-pane and feed relationships; selection survives window changes. | Dispatch uses list/detail; Ensemble uses a delegation workspace; Deliveries uses outcome documents. Phones get a deliberate single-view sequence. This application to web is an inference; Compose code is not adopted. |
| [Fluent 2 layout](https://fluent2.microsoft.design/layout) | Proximity and consistent spacing communicate groups without outlining everything. | Group agent, objective and current action by spacing. Reserve separate surfaces for separate objects; do not turn every metric into a card. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Reflow, keyboard use, visible/unobscured focus, non-color status and target-size requirements are testable. | Test 320 CSS px, increased text, long labels, both themes and keyboard operation. Aim for 44px touch controls; 44px is a product target, not the universal AA minimum. No automatic audit alone proves conformance. |
| [WAI APG tree](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/), [modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | A tree has an explicit keyboard model; dialogs require suitable focus containment/return. Focus and selection are different states. | Start with semantic lists and explicit disclosure controls for a small agent hierarchy. Use tree semantics only when implementing the whole pattern. Full-screen mobile inspection need not become a modal. |
| [React state identity](https://react.dev/learn/preserving-and-resetting-state) | Position/type/key determine state preservation; hidden and removed components differ. | Moving between agent work and conversation must preserve drafts intentionally. Do not key the entire composer by whichever panel is selected. |
| [React Aria Tree](https://react-aria.adobe.com/Tree), [FocusScope source](https://raw.githubusercontent.com/adobe/react-spectrum/main/packages/react-aria/src/focus/FocusScope.tsx) | Tree supports expansion, selection and keyboard navigation. FocusScope restoration considers surviving ancestor scopes and virtualized DOM reuse. | React Aria is the strongest candidate if a genuinely complex keyboard agent tree emerges. Preserve a stable task identity when restoring focus. The small prototypes do not require a collection library. |
| [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [Dialog source](https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/dialog/src/dialog.tsx) | Dialog source separates modal/nonmodal behavior, handles nested portalled branches and restores trigger focus; Safari pointer/focus sequencing matters. | Keep the tested native modal boundary unless a concrete gap emerges. Avoid mixing multiple overlay systems. Attractive custom styling does not replace correct focus behavior. |
| [Linear redesign account](https://linear.app/now/how-we-redesigned-the-linear-ui), [March 2026 refresh](https://linear.app/changelog/2026-03-12-ui-refresh) | The 2024 process compared full linked workflows and stressed environment, appearance and hierarchy. The 2026 refresh describes consistent headers and quieter navigation. | Compare the same task across all three prototypes, with task switching and decision outcomes. Borrow consistent interaction language, not Linear's sidebar silhouette. Its historical choice to avoid changing navigation does not override this user's request. |
| [Figma UI3 exploration](https://www.figma.com/blog/behind-our-redesign-ui3/), [post-beta follow-up](https://www.figma.com/blog/our-approach-to-designing-ui3/) | Initial radical hover-only proposals were unstable. Subsequent feedback found floating panels cramped smaller screens and distracted frequent users. | Explore boldly, then verify usable content space and stable action placement. Ensemble must not require a floating canvas or drag gestures; mobile is a readable delegation sequence. |
| [Raycast extension guidance](https://developers.raycast.com/basics/prepare-an-extension-for-store) | Predictable navigation stacks, consistent action labels and context-specific action panels matter. | Every prototype has visible navigation and a clear return path. A future command palette accelerates those paths rather than replacing them. Raycast's Title Case convention is not adopted; Relay retains sentence case. |
| [Cursor reviewing/testing](https://cursor.com/learn/reviewing-testing) | Live diffs permit early intervention; small coherent changes are easier to review; plausible code still needs verification. | Conversation is adjacent to a concrete task or artifact, with a reachable stop/decision surface and inspectable checks. An agent message does not certify a result. |
| [VS Code UX overview](https://code.visualstudio.com/api/ux-guidelines/overview), [Views source](https://raw.githubusercontent.com/microsoft/vscode-docs/main/api/ux-guidelines/views.md) | Views should use familiar names and appropriately placed actions; extension interfaces should fit the work rather than introduce unnecessary custom chrome. | Name destinations around work: Decisions, Agents, Results. Keep task actions local. Do not copy the entire IDE or crowd phones with permanent tool rails. |
| [GitHub agent surfaces](https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-on-github) | Agent session logs expose work/tools; shared sessions and PRs enable review; logs do not replace testing and review. | Every outcome links back to responsible agent, task and evidence. Display observed checks separately from agent claims and permission decisions. GitHub cloud agent capabilities are not Relay capabilities. |

## Practical criticism, not proof

| Inspected discussion | Useful test hypothesis | Evidence boundary |
| --- | --- | --- |
| [Figma UI3 auto-scroll report](https://www.reddit.com/r/FigmaDesign/comments/1e7i319/ui3_autoscroll_issue/) | Panel gaps can alter pointer travel and drag-edge behavior. Test real control reach and scroll boundaries, not screenshots alone. | A firsthand historical complaint; not a representative usability study or a claim about current Figma. |
| [HN discussion of Linear responsiveness](https://news.ycombinator.com/item?id=48437609) | Fast presentation and predictable keyboard navigation are different quality dimensions; a commenter describes inconsistent preferred key bindings. | Opinion generates checks; it does not establish a measured Relay or Linear performance result. Technical performance decisions rely on documentation and local measurements. |
| [Radix nested popover/dialog issue #3423](https://github.com/radix-ui/primitives/issues/3423) | Exercise typing, wheel scrolling, pointer actions and focus in nested overlays. | Historical closed issue, not a claim that the latest package still has that defect. Current inspected Dialog source explicitly accounts for nested branches. |

## Candidate tools and dependency decisions

Installed versions below come from Relay's manifest, not claims about upstream latest versions. A new library requires peer compatibility, license and bundle review at the point of adoption.

| Candidate and inspected documentation | Decision for this phase | Reason / condition for reconsidering |
| --- | --- | --- |
| React 19.3.0 + TypeScript + Vite | Retain for product; offline prototypes use plain HTML/CSS/JS | A different information architecture does not require a framework rewrite. |
| [Tailwind theme variables](https://tailwindcss.com/docs/theme) | Defer | Existing semantic CSS variables can express all three directions. Adding utility generation is a team-maintenance choice, not a prerequisite for distinct design. |
| [shadcn introduction](https://ui.shadcn.com/docs) | Defer bulk adoption | Component source ownership is useful, but copied source remains our maintenance obligation. Default dashboard layouts would bias the comparison toward the rejected shell. |
| React Aria | Conditional candidate for complex agent/tree collections | Strong keyboard/internationalization model. Trial one collection first; do not add alongside another library for the same interaction. |
| Radix | Conditional individual primitive only | Overlay complexity may justify it; current tested native dialogs already cover much of the need. |
| [Motion accessibility](https://motion.dev/docs/react-accessibility) | Defer | CSS feedback is sufficient for these prototypes. Adopt only if interruption-safe spatial transitions improve comprehension; honor reduced motion. |
| [TanStack Query defaults source](https://raw.githubusercontent.com/TanStack/query/main/docs/framework/react/guides/important-defaults.md), installed 5.104.1 | Retain | Background refetch defaults need intentional stale times and scope. Successful mutation receipts must apply before refresh; cached refresh failure must preserve dirty views. |
| [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction) | Defer pending measurement | Useful for very large collections; variable streaming height and recycled focus make premature virtualization risky. Preserve `.conversation-scroll` if product conversation is reused. |
| [Playwright accessibility guidance source](https://raw.githubusercontent.com/microsoft/playwright/main/docs/src/accessibility-testing-js.md), installed 1.63.0 + axe | Retain | Exercise real selection, keyboard focus, mobile geometry, decisions and screenshots. Automated accessibility checks need manual review. |
| [Storybook accessibility](https://storybook.js.org/docs/writing-tests/accessibility-testing) | Defer initial installation | Worth considering for a stable catalog of multi-state agent components after selection. Current browser fixtures can compare full workflows immediately. |
| Figma | Optional design communication, no installation | Useful for collaborative exploration, but actual offline browser prototypes give direct responsive/keyboard evidence now. No Figma account or connector was used. |
| [Lucide React](https://lucide.dev/guide/react), installed 1.51.0 | Retain for product | Named imports keep icons coherent. Icons supplement labels; capability/status must not rely on pictograms alone. Prototypes use local SVG/typography and no CDN. |

## Skills and provenance

Read installed `frontend-design`, `vercel-react-best-practices`, and `web-design-guidelines`, plus relevant sections of `accessibility`, `responsive-web-design`, `vercel-composition-patterns`, `interaction-design`, `brainstorming` and `verification-before-completion`. Use intentional subject-specific composition, semantic controls, state preservation, explicit variants and measured verification. Generic breakpoint examples and template aesthetics are suggestions, not product requirements. Accessibility guidance does not confer certification. React/Next-specific recommendations must be filtered for this client-rendered Vite product.

Inspected the [vercel-labs/agent-skills repository](https://github.com/vercel-labs/agent-skills), upstream [React skill](https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/react-best-practices/SKILL.md), [composition skill](https://raw.githubusercontent.com/vercel-labs/agent-skills/main/skills/composition-patterns/SKILL.md), and linked [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). GitHub API inspection observed repository `vercel-labs/agent-skills`, `archived: false`, default branch `main`, head `063bee94c3f4df8453406c830b0a7df0f2860278`. This identifies the inspected upstream, not a guarantee about every installed local file. The README declares MIT and local Vercel skill frontmatter declares MIT; the API license field was null and a root raw LICENSE fetch failed, so do not claim independently verified root license text. No installer, remote script or skill permission change was executed. Installed performance/composition skills already overlap the useful upstream advice; no duplicate install is warranted.

## Three prototypes to compare

All use the same clearly synthetic release task, agent names, pending file decision and sample receipts. The task/chat/evidence relationship must work, not just appear in a screenshot. Prototype approval updates local simulation state only. No actual host, model, file, grant or network mutation occurs.

### A. Dispatch — work starts with the decision

**Primary object:** a task needing attention. A broad horizontal header and compact status filters precede a ranked task ledger; opening a task reveals the objective, responsible agent, pending decision, recent exchange and receipts. The signature is large readable task rows with a narrow state rail, not repeated metric cards. Neutral paper/ink with a deep plum action accent and system sans typography. Mobile becomes an inbox/detail sequence with a clear back control and bottom decision actions.

**Distinct value:** find what needs a human now, resolve it, return to the queue. **Risk:** agents become secondary metadata; correct this with visible task ownership and a direct team filter, not another permanent sidebar.

### B. Ensemble — work starts with the team

**Primary object:** an agent and its delegated assignment. A central team stage organizes lead, researcher, builder and reviewer into connected responsibility areas. Selecting an agent replaces the assignment/exchange view; a handoff explains what was given to whom and which evidence returned. Deep aubergine stage, pale surfaces and lilac selection; larger agent names and spacious relation lines are the visual signature. The graph is an enhancement over a semantic ordered list, never a drag-only control.

Mobile uses agent buttons followed by one assignment, conversation and evidence sequence. **Distinct value:** understand who is doing what and intervene in a specific handoff. **Risk:** a theatrical graph may imply autonomy or parallelism the backend does not support; use explicit sample labels and later only real persisted relationships.

### C. Deliveries — work starts with the result

**Primary object:** an outcome awaiting review. A project shelf opens a large artifact/diff document; a compact review itinerary links brief, changes, checks and decision. The agent's conversation is an annotated discussion attached to the selected result. Strong typographic hierarchy, quiet blue-white surfaces and a teal action accent distinguish it from both the inbox and team stage. Mobile shows the result first, with anchored review sections and a compact discussion disclosure.

**Distinct value:** judge what changed and whether the evidence supports acceptance. **Risk:** ongoing work becomes hard to discover; include active/pending deliveries and a clear link to responsible agents. Prototype approval is an example decision, not automatic publication or a permission grant.

## Selection contract

Build and inspect all three before selecting. Compare the same actions: find the blocked task, identify agent and scope, inspect the relevant exchange, open evidence, simulate approve/deny, switch tasks and return without losing context. Check desktop and phone, light/dark, keyboard, long names and short height. Reject any concept that hides the decision behind chat, makes authority ambiguous, relies on a canvas on phones, or reproduces Studio with different paint. Do not manufacture numeric usability scores. Record the chosen direction's concrete advantages and remaining risks after browser review.

## Access ledger

- Apple HIG HTML yielded a JavaScript-only shell; official documentation JSON supplied actual guidance.
- Material window-size-class URL returned an internal fetch error; layout overview returned a one-line shell. The official Android adaptive page was retrieved. No claim of newly inspecting rendered Material guidance is made.
- TanStack Query and Playwright documentation page opens returned internal errors; their official GitHub documentation sources were retrieved successfully.
- Old React Aria `packages/@react-aria/focus/src/FocusScope.tsx` returned 404. Current `packages/react-aria/src/focus/FocusScope.tsx` was retrieved and focus restoration inspected.
- VS Code Views page returned an internal error; the official `microsoft/vscode-docs` source succeeded. UX overview succeeded.
- GitHub coding-agent URL redirected to its current Copilot-on-GitHub page; conclusions use the destination content.
- Root upstream agent-skills LICENSE raw fetch returned an internal error; README license statement and null API field are reported separately above.
- Other linked sources were opened successfully. Community observations are explicitly labeled; none establishes a Relay benchmark or a current upstream defect.
