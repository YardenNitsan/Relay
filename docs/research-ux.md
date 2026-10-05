# Frontend research

Researched 2026-10-04 from primary documentation. Recommendations are engineering/design judgments, not claims that a source endorses Relay.

- [React build guidance](https://react.dev/learn/build-a-react-app-from-scratch): a Vite client is justified by the separate local service and lack of SSR needs. Routing and data fetching remain explicit responsibilities.
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview): cache durable backend state separately from transient view/composer state.
- [SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events): use persisted IDs, replay, heartbeats and reconnection; a browser reconnect is distinct from a failed task.
- [React Aria](https://react-aria.adobe.com/) and native HTML were evaluated for accessible primitives. Native dialogs/selects meet the initial interaction needs with fewer component abstractions.
- [WAI dialogs](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and [comboboxes](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): preserve keyboard editing, contain modal focus, name controls and restore focus.
- [WAI status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html): announce concise state changes, not every streamed token.
- [WCAG focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum): sticky composer and panels must not hide keyboard focus.
- [Grafana log exploration](https://grafana.com/docs/grafana/latest/visualizations/explore/logs-integration/): expandable event details and paused live following inform the activity surface.
- [VS Code changes](https://code.visualstudio.com/docs/sourcecontrol/staging-commits): file-oriented diff navigation, explicit revert semantics, accessible patch views.
- [CodeMirror merge](https://codemirror.net/docs/ref/): evaluated for later rich editing; the current read-only patch viewer uses bounded semantic code lines and offers full text download.
- [xterm.js security](https://xtermjs.org/docs/guides/security/): terminal data is untrusted and browser XSS becomes especially consequential. Structured command output is sufficient initially; an interactive shell is a separate capability.
- [react-markdown security](https://github.com/remarkjs/react-markdown#security): disable raw HTML, preserve safe URL handling and restrict external media.
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction): evaluated for very long feeds; current bounded activity display avoids enormous DOM trees while keeping accessible full-output downloads.
- [IBM Plex](https://github.com/IBM/plex): locally bundled interface and code typography.
- [Playwright accessibility](https://playwright.dev/docs/accessibility-testing): automated checks must be combined with keyboard and manual review.

Design principle: show a useful execution record, never hidden chain-of-thought. Only backend-authoritative events, permissions, evidence and metrics are represented as fact.
