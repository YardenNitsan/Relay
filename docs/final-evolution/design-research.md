# Design research

Inspected 2026-10-10. This records design decisions, not completed UI acceptance. Sources were retrieved through web browsing, official structured documentation, or Chromium. Product essays describe their authors' decisions; community discussions supply hypotheses, not general proof. No third-party scripts or downloaded skills were executed.

## Primary guidance and implementation references

| Reference | Inspected lesson | Relay implication and tradeoff; what not to copy |
| --- | --- | --- |
| [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) and [official layout content](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/layout.json) | The landing page returned a JavaScript shell; official structured content was accessible. Relative importance, alignment, proximity, adaptable windows and reading direction organize content. | Objective, current state and next action lead the reading order. Group before adding borders; accommodate Hebrew. Do not imitate macOS chrome or adopt Liquid Glass translucency for execution evidence. |
| [Apple typography](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json) | Legibility depends on hierarchy, weight, limited families and adaptation. | Keep locally bundled type, readable body sizes and restrained labels; test scaling and Hebrew fallback. Platform point sizes and system fonts are not a portable CSS specification. |
| [Apple motion](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/motion.json) | Motion communicates feedback and should be brief rather than gratuitously repeated. | Animate panel/state transitions; reduced motion removes travel. Do not animate every streamed paragraph or delay permission controls. |
| [Apple menus](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/menus.json) | Contextual commands reduce permanent control density when grouping is predictable. | Infrequent task configuration belongs behind named controls; cancellation and approvals remain visible. A context menu must not be the only access path. |
| [Material layout overview](https://m3.material.io/foundations/layout/layout-overview/overview) | Text browsing returned a shell. Chromium navigation from Foundations to Layout exposed May 2026 guidance on scaffolds, panes, rails, safe regions, breakpoints and bidirectional layout. | Compose adaptable regions and a focused mobile surface. Do not inherit Material shapes/palette. Local inspected snapshot: `.playwright-cli/page-2026-10-10T14-20-34-847Z.yml` (ignored). |
| [Android adaptive layouts](https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout) | Width and height constrain panes/navigation; resizing and multitasking matter beyond device type. | Evidence becomes a selected view in compact windows and a neighboring pane when space permits. Constrain reading width on large monitors. Android classes inform the method, not web device detection. |
| [Fluent layout](https://fluent2.microsoft.design/layout) | Alignment, proximity and consistent spacing establish relationships. | Use aligned lists and a continuous work surface instead of unrelated cards. Fluent's exact spacing and branding are not requirements. |
| [Fluent motion](https://fluent2.microsoft.design/motion) | Functional transitions explain changing relationships. | Open selected receipts in context. Loading feedback must not imply an invented completion percentage. Avoid constant event animations. |
| [Windows design guidelines](https://learn.microsoft.com/en-us/windows/apps/design/guidelines-overview) | Navigation, commands, typography and elevation work together for productive use. | Separate navigation, commands and contextual inspection; expose shortcuts. Do not reproduce WinUI title bars or Windows-only interactions. |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | Normative requirements cover contrast, reflow, visible/unobscured focus, keyboard access, target size and authentication. | Target AA; test 320 CSS pixels, 200% text and keyboard dialogs. Prefer 44px touch targets where practical, beyond the 24px AA minimum. Automated checks do not establish certification. |
| [WAI APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Modal behavior includes containment, initial/return focus, Escape and an inert background; long content needs sensible initial focus. | Approval consequence text precedes action; preserve focus and semantic structure. Do not mark a nonmodal inspection pane as modal or combine a whole document into one accessible description. |
| [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility) | Primitives handle many keyboard, role and focus details; application context still matters. | Adopt a small primitive for demonstrated interaction complexity. Product labels, contrast and end-to-end behavior remain Relay's responsibility. |
| [Radix dialog source](https://raw.githubusercontent.com/radix-ui/primitives/main/packages/react/dialog/src/dialog.tsx) | Inspected modal/nonmodal paths: trap state follows open state, return focus targets the trigger, dismissal handles right clicks and Safari focus/pointer sequencing. | Preserve these subtleties when replacing dialogs. Do not casually rebuild focus traps. Tested native dialogs can remain underneath new presentation. |
| [React Aria quality](https://react-aria.adobe.com/quality) | Accessibility, internationalization and interaction consistency are connected. | Candidate for complex keyboard collections, with API/size costs. Avoid overlapping primitive libraries. FocusScope source retrieval failed, so no source-inspection claim is made. |
| [shadcn introduction](https://ui.shadcn.com/docs) | Distributed component source offers composition and ownership. | Borrow composition principles, not default dashboard aesthetics. Copying creates maintenance obligations; no bulk card-library initialization is justified. |
| [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction) | Headless virtualization separates windowing from layout. | Add only after large-history/diff measurement. Dynamic streaming height and focus complicate it; preserve `.conversation-scroll` as scroll owner. |
| [Vercel Geist](https://vercel.com/geist/introduction) | A developer design system connects typography, color and component behavior. | Specify reusable semantic decisions before feature CSS. Do not copy monochrome branding or turn every fact into a badge. |

## Professional product decisions

| Reference | Lesson | Application and limit |
| --- | --- | --- |
| [Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui) | Evaluate hierarchy in complete workflows and realistic environments. | Prototype conversation through approval and evidence with dense content. Do not copy Linear's navigation silhouette or assume minimal chrome establishes trust. |
| [Raycast look and feel](https://www.raycast.com/blog/a-fresh-look-and-feel) | Its historical redesign emphasizes a primary search surface and contextual shortcuts/actions. | A command palette accelerates visible alternatives; the composer has one clear primary action. This historical essay is not a current-product verification. |
| [Figma UI3](https://www.figma.com/blog/behind-our-redesign-ui3/) | Context, optional labels and collapsible panels balance approachability and expert control. | Make task content central and evidence optional. Keep labels for permissions/devices. Do not replicate floating canvas tools on a phone. |
| [Notion search](https://www.notion.com/help/search) | Recent items, explicit scope, filters and keyboard entry points coexist; search surfaces have different coverage. | Distinguish conversation, file and navigation search. Explain scope/empty results. Do not promise semantic retrieval before it exists. |
| [Cursor review and testing](https://cursor.com/learn/reviewing-testing) | Reviewable changes and real tests matter; passing tests can still check the wrong behavior. | Connect files, commands, exit status and artifacts. Approval and verification remain separate. Agent self-report is not proof of Relay capability. |
| [GitHub Desktop repository import](https://docs.github.com/en/desktop/adding-and-cloning-repositories/adding-a-repository-from-your-local-computer-to-github-desktop) | Repository selection explicitly identifies a local target. | Show repository, branch and device. Browser handles, host workspaces and Companion grants confer different authority. Do not imply browser access equals native desktop access. |

## Firsthand discussion and conflicting preferences

These observations are not standards, benchmarks or representative surveys. Technical choices above rely on official guidance/source.

| Inspected discussion | Question raised | Decision to test |
| --- | --- | --- |
| [r/frontend: good frontend with AI](https://www.reddit.com/r/Frontend/comments/1vemazu/tips_on_how_to_build_good_frontend_with_ai_and/) | Specific design constraints and iteration matter more than a broad request for polish. | Establish screen purpose and adverse content before judging captures; popularity is not task success. |
| [r/UXDesign: UI and AI](https://www.reddit.com/r/UXDesign/comments/1rqsovy/what_am_i_missing_about_ui_ai/) | Surface generation and product reasoning differ; opinions conflict about replacement of professional workflows. | Evaluate completion, navigation and recovery alongside appearance. Do not generalize individual opinions to all tools/designers. |
| [r/webdev: UI libraries](https://www.reddit.com/r/webdev/comments/1kyccp4/what_ui_libraries_are_you_using/) | Convenience, control and dependency ownership have different value to different teams. | Choose a small coherent primitive strategy for actual needs, not every advocated library. |
| [Hacker News UX discussion](https://news.ycombinator.com/item?id=44833834) | Praise for fast local software coexists with concerns about preloading and resource consumption. | Measure navigation and memory together; preloading every panel is not automatically an improvement. |
| [Radix accessibility audit issue](https://github.com/radix-ui/primitives/issues/2317) | Mature primitives still need contextual keyboard/assistive-technology review. | Retain application regressions and manual checks. A historical issue is not proof of a defect in every current release. |

The shadcn GitHub Discussions index was inspected for leads; no unreviewed individual thread is used as evidence.

## Maintenance, licensing and adoption

Public GitHub metadata queried on 2026-10-10. Dated activity is not a maintenance guarantee. No new dependency was installed.

| Repository | Observed metadata | Decision |
| --- | --- | --- |
| [shadcn-ui/ui](https://github.com/shadcn-ui/ui) | Not archived; pushed 2026-10-10; MIT | Relay has no shadcn setup. Do not add an entire styling convention for basic controls. |
| [radix-ui/primitives](https://github.com/radix-ui/primitives) | Not archived; pushed 2026-10-09; MIT | Dialog source inspected. Evaluate individual packages if native controls lack required behavior; verify selected package peers before installation. |
| [adobe/react-spectrum](https://github.com/adobe/react-spectrum) | Not archived; pushed 2026-10-09; Apache-2.0 | Strong internationalized model; avoid overlapping Radix for the same control. Detailed source review remains open. |
| [TanStack/virtual](https://github.com/TanStack/virtual) | Not archived; pushed 2026-10-09; MIT | Fits headless React composition; defer until measured need. Existing TanStack Query remains. |

These are dependency license observations. Relay's own license still requires its owner's decision. No third-party brand assets were adopted.

## Frontend skills inspected

Read installed `frontend-design`, `accessibility`, `responsive-web-design` and `vercel-composition-patterns` instructions from the local catalog. Useful guidance: intentional hierarchy, semantic controls, adaptive composition, measurable accessibility and small composable components. Guidance is not evidence of product success. No remote skills were installed or granted permissions.

## Relay-specific synthesis

1. **Task document first.** Objective and result are central. Execution is a connected evidence view with real statuses, never fabricated percentages.
2. **Visible authority.** Consequential actions identify device, scope, target and effect. Approval has a reachable dedicated surface and unchanged server enforcement.
3. **One primary action per context.** Progressive disclosure keeps the composer calm; cancellation and pending decisions remain visible.
4. **Adaptive composition.** Wide windows can show navigation, document and inspection. Compact windows choose one content view. Height also constrains layout.
5. **Restrained visual instrument.** Typography, alignment, separators and purposeful accent establish identity. Avoid card grids, gratuitous gradients and translucent evidence.
6. **Measure difficult states.** Network failure, long names, mixed direction, extensive diffs and streaming are acceptance fixtures. Screenshots alone cannot prove accessibility.
7. **Coherent stack.** Retain React/TypeScript/Vite, data contracts and local fonts. Split presentation responsibilities before adding libraries.

Concept selection is in `design-system.md`; implementation and visual acceptance remain open.

## 11 October implementation research refresh

The owner reconfirmed a complete original redesign across all views, including dedicated phone workflows. Existing Studio screens are intermediate implementations, not final product acceptance. Research informs concrete behavior; it does not substitute for rendered inspection or real-device use.

- [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout), also inspected through its official documentation JSON: adapt to available width and height, preserve hierarchy and reading order, and allow content to grow with text settings. Relay uses focused compact panes and readable content rather than shrinking desktop controls. No Apple visual branding is copied.
- [Fluent layout](https://fluent2.microsoft.design/layout): alignment and proximity communicate relationships. Relay's specialist, memory and schedule indexes use continuous lists with consistent spacing; separate actions and evidence receive intentional emphasis. Touch targets remain comfortable.
- [Android adaptive layouts](https://developer.android.com/design/ui/mobile/guides/layout-and-content/adapt-layout): change composition with available space. List/detail views become separate destinations on narrow windows; search, selection and focus survive the transition.
- [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [React Aria Modal](https://react-aria.adobe.com/Modal): preserve readable flow, reachable controls, contained focus and meaningful focus restoration. Native dialog remains the tested primitive; dirty drafts and active mutations guard deliberate dismissal.
- [Linear's redesign account](https://linear.app/now/how-we-redesigned-the-linear-ui) and [Figma UI3](https://www.figma.com/blog/behind-our-redesign-ui3/): judge hierarchy and control visibility in working contexts. Relay retains exact permissions, source evidence and errors while simplifying navigation. Neither product's appearance is a template for Relay.

Applied review cases include 320px, short landscape, both themes, filtered-out selections during breakpoint changes, delayed operations and late response text reflow. Physical Android keyboard and remote modernization acceptance remain outstanding.

## Connection and recovery implementation review, 11 October

Revisited [Google's sign-in form guidance](https://web.dev/articles/sign-in-form-best-practices), [WAI-ARIA modal behavior](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [Fluent layout](https://fluent2.microsoft.design/layout). Applied the relevant behavior to Relay's existing one-use pairing exchange: stable labeled form controls, explicit code visibility, 48px actions, a naturally scrolling compact page and separate account/host explanations. Pairing secrets remain transient, are cleared before exchange and are never added to URLs or browser storage. Do not imply that a displayed hostname certifies transport security. Existing remote pending/denied states keep their own recovery instructions and cannot fall back to owner pairing.

For phone recovery, [visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event) and [online events](https://developer.mozilla.org/en-US/docs/Web/API/Window/online_event) are hints to renew the authenticated [EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource), not proof of host availability. Only its actual open event reports a live stream. Retain the last applied event cursor in memory when browser storage is denied; never advance it for a discarded batch. Browser simulations of these events do not establish physical Android lifecycle behavior.

## Visible viewport and native dialogs, 12 October

Revisited MDN's [VisualViewport reference](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) and [native dialog behavior](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog). A keyboard can reduce the visible area without changing the layout viewport; sizing a dialog with100dvh alone therefore does not establish reachable controls. Use the existing viewport observer to share actual visible height/offset, retain native modal focus/inertness, and avoid shrinking controls under pinch zoom. New geometry/draft tests will distinguish this simulated behavior from physical Android acceptance.
