# Dispatch navigation and preferences

12 October 2026. Scope: `web/components/Navigation.tsx`, new `web/features/navigation/navigation.css`, `web/features/settings/SettingsStudio.tsx` and `settings.css`. No shell, backend, routing or other feature changes.

## Composition

More becomes a grouped directory rather than an undifferentiated destination list: Work, Connections, Personal and owner-only Host. Account and actual execution-host identity stay visible above it; browser theme, command palette and conditional remote sign-out form a separate footer. Desktop uses two directory columns, phones a linear reading order. All destinations remain actual callbacks with their existing accessible names.

Settings becomes one preference document: identity, browser appearance, existing task notifications, then connections, personal records and owner-only host controls. Desktop gives each section an explanatory left margin; phone stacks that margin above its controls. Two small decorative reading previews make the current theme choice explicit; aria-pressed and existing light/dark callbacks remain authoritative. No card grid, tab state or new query.

Use Dispatch's existing plum/neutral tokens, IBM Plex Sans for labels and prose, clear dividers, restrained surface variation, 44px minimum controls and visible focus. Both themes change atomically. At 320px and short landscape the native dialog's content scrolls; no sticky identity block consumes the usable height.

## Preserved boundaries and verification

Keep all existing destination callbacks, owner conditions, account/host facts, remote-only sign-out and success-only redirect exactly intact. Settings delegates notification permission/enabled/pending behavior to the existing TaskNotifications component; no copied permission state. Existing appearance button names and semantics stay intact. Root owns production build and browser fixture4319; this task runs strict types and diff review only. Existing notification, settings/navigation and responsive browser cases provide acceptance. Add behavior tests only if behavior changes.

Implemented the grouped directory and preference document, including responsive theme previews and actual account/host identity. The logout async function is unchanged; only its footer composition changed. The notification component and its controls are unchanged. Owner-only destinations remain filtered in both surfaces. Accessible action names remain intact, including light/dark appearance, navigation destinations and all existing settings destinations.

`npm.cmd run typecheck` passed. `git diff --check` passed (the shared workspace emitted an unrelated ProjectWorkspace line-ending warning). Source review confirmed all original destinations and callbacks are retained. No new application behavior or redundant presentation tests added. Parent owns build/browser evidence: settings-studio, dialog-viewport, shared-host, notifications, notification-permission and affected navigation/focus cases. Retained the existing appearance minimum-height contract used by dialog-viewport tests. Browser/visual acceptance remains pending.

## Integrated checkpoint

Root strict production build and rendered acceptance are recorded in [testing](testing.md): initial core92/94, corrected/supporting111/111, scheduling/initial landscape24/24, and final strict landscape/History/viewport14/14. Actual screenshot review is in [design review](design-review.md). Earlier source-only statements above describe the development checkpoint, not the latest acceptance. Physical-device, deployment and final-head CI remain separate.
