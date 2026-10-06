# Relay design system

Relay is a conversation-first instrument for delegated work. Its central visual element is a connected execution record: an objective, factual activity, resulting changes, and verification remain associated. The default surface is a readable conversation; history and operational detail open when requested.

## Review against the brief

The first direction was checked against generic chat and dashboard patterns. A permanent sidebar, repeated status cards, decorative gradients and colored chat bubbles were removed. The distinctive treatment is a compact vertical execution thread attached to the work it describes. Models and machine resources use dense, legible lists instead of a dashboard grid. Labels describe actual state, not implementation internals or simulated capability.

## Tokens

| Role | Light | Dark |
|---|---|---|
| Canvas | #F5F7FA | #15212F |
| Surface | #FFFFFF | #1C2B3C |
| Text | #182B3D | #E7EDF4 |
| Secondary text | #526477 | #A8B8CA |
| Action/focus | #2B5F96 | #91B8E8 |
| Divider | #D9E1EA | #35485E |

Body/canvas contrast is 13.48:1 light and 13.81:1 dark. Secondary/canvas contrast is 5.67:1 and 8.04:1. Status has a text label and icon as well as color.

IBM Plex Sans carries interface and prose; IBM Plex Mono is reserved for commands, paths and code. Both are bundled locally. Sizes: 13px metadata, 14px controls, 16px conversation, 22px headings, 30px initial prompt. Spacing follows 4/8/12/16/24/32/48px. Radius: 5px controls, 9px composer, 12px dialogs. Elevation belongs to overlays, not ordinary content. Prose stays near 72 characters wide.

## Interaction

- The composer exposes model, compute depth and computer access. An options surface contains budgets and context. Permission scope is always visible.
- Activity uses persisted facts. Planned steps are explicitly pending; no decorative agents or simulated hardware metrics exist.
- Native modal dialogs provide focus containment, Escape dismissal and focus restoration. All actions retain text labels or accessible names.
- A command palette supplements visible navigation. It does not replace discoverable buttons.
- Scrolling upward stops automatic following. A jump control returns to the latest content.
- The activity inspector becomes a sheet on narrow screens. A keyboard-operable width toggle complements desktop resizing.
- Stop all is an immediate backend operation. Resuming the global service is explicit and does not silently resume stopped tasks.
- Unknown hardware and price data is shown as unavailable/unknown. Disconnection is a state with a recovery action.
- Markdown cannot execute HTML, load remote images or become application authority. Terminal and event output is bounded text.

## Validation

Use actual backend flows for production-path inspection; explicit test fixtures belong only in tests. Inspect both themes, 390px and desktop widths, keyboard dialogs/palette, overflow, long messages, stream reconnect, approval, failure, cancellation and missing providers. Automated accessibility checks supplement keyboard and visual inspection; they do not prove complete conformance.

### Verified 2026-10-05

- Production browser inspection at `127.0.0.1:4317` showed the real local-model acceptance conversation, its recorded three calls, supervised file-write approval, file-read verification, and persisted answer. Screenshots: `output/playwright/relay-live-local-conversation.png` and `relay-live-local-activity.png`.
- Dark desktop, light desktop, 390px phone and owner Access modal were opened and visually inspected. Phone controls preserve the conversation and convert the inspector to a full-width work surface.
- All 16 browser tests passed. Coverage includes conversation reload, supervised writes and actual diffs, emergency-stop latch, focus restoration, eight viewport sizes from 320px to 1920px, owner user-policy persistence, revocation actions, and phone approvals at 320/390px with targets at least 44px tall.
- Automated axe scans passed for the main screen, expanded Access dialog and both phone approval surfaces. These checks do not establish full WCAG conformance or replace assistive-technology user testing.
- Browser tests use the real API/database/tools with an explicitly isolated deterministic provider fixture. The production screenshots use the installed local runtime; these evidence types are distinct.
- Remote owner controls are hidden for invited users, task budgets start within account grants, and account-specific drafts stay separated. A signed public gateway login was not exercised in browser E2E; external account/domain setup remains required.
- Long-open browser inspection found a permanently closed SSE connection after session expiry. An explicit Reconnect activity action now renews the browser session and replaces the stream. Backend stream timeout/expiry corrections are tracked in the main validation record.
- Pending approvals now identify the session-reported host, persisted task workspace, and recorded requesting agent/model before the decision controls. Exact invocation/task event correlation prevents another task or agent from supplying the identity. Unknown identity is explicit. Action/risk summaries are deterministic; unknown operations retain the exact policy reason, and cloud context transmission is identified as leaving the host. Exact arguments are expandable and downloadable when truncated.
- After this approval change, the four Access browser tests and four new approval-provenance unit tests passed, and the production build passed. Updated `relay-approval-320.png` and `relay-approval-390.png` were visually inspected; all identities and decisions remain readable, with no horizontal overflow and at least 44px-tall approval targets. The remaining 12 browser scenarios were verified before this focused change.

### Research-backed continuation

The [frontend research record](frontend-research.md) maps official Apple, Meta/React, Fluent, Material and W3C guidance to specific decisions. It preserves the existing visual identity and conversation-first structure. It does not claim adoption of a proprietary frontend protocol or native platform conformance.

Phone navigation is a named full-screen sheet; model and compute controls remain visible in the compact composer. Primary touch actions are 48px, utility controls at least 44px. Activity labels use 13px and supporting text 12px. Compact-height windows use a smaller welcome heading and keep scrolling content separate from the composer. The connection screen and loading skeleton explain real application states before content becomes available.

Resource settings distinguish unsaved, applied, saving, saved and failed states. Custom reserve inputs form a two-column grid that becomes one column on phones; labels and enforced bounds remain visible. The applied profile only changes after server confirmation, and the UI never presents runtime-reported allocations as measured peak memory or Relay-owned allocations.

The complete 22-scenario Chrome suite passed during this continuation, including dark-theme conversation/activity axe checks, phone navigation and focus restoration, local pairing, provider-private-query gating, resource save failures and persistence, and retained approval/diff/stop flows. Final visual review also covers the tablet resource view and compact landscape layout. See `frontend-research.md` for screenshot paths and explicit validation limits.

Final follow-up on October 6: nine browser scenarios passed after activity typography and compact-height refinements. A newly reproduced desktop dialog-chain focus regression was fixed; all seven refinement tests passed afterward, bringing the suite to 23 scenarios. Seven frontend unit tests, the production build and whitespace checks passed. The modal's fallback focus target must be visible on the current layout; a hidden phone-navigation element is never an acceptable desktop focus destination.
