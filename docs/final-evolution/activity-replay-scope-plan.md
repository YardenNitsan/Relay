# Activity replay scope and restart recovery

Scope: B11/G04 and final mobile session/reconnection acceptance. The current browser stores one numeric cursor per origin; it has no binding to the authenticated session or host lifetime. A different account or restored host can inherit a cursor beyond its available events. Preserve cookie, origin, account filtering, stream capacity and revocation checks.

Use the existing standards-based EventSource transport. Add an opaque replay scope derived from a per-Store random epoch and the authenticated principal/session. This is a cursor namespace, never an authorization token. Both listeners sharing a Store share its epoch. A fresh process/Store naturally changes it; no migration or persistent secret is required.

Before activity, the authenticated server sends a named replay control event with the accepted cursor and current scope. A missing/mismatched scope or a cursor beyond the current event head resets replay. The browser clears old transient activity/text, records only the accepted scope/cursor and recreates its EventSource once with that scope. Ordinary reconnections retain only flushed batches, including when browser storage is unavailable. Legacy numeric storage is ignored. Cleanup must discard pending batches without advancing the replay cursor, and detached stream handlers must not affect a new session.

Server admission still reauthorizes the exact session and filters events per account; no replay scope can bypass it. Existing durable conversation/task reads remain authoritative.

- [x] Reproduce stale browser cursor behavior and native wrong-scope/above-head replay failures before implementation.
- [x] Test matching-scope continuation, different session/account separation, Store restart, cancellation/cleanup and unchanged auth/stream limits.
- [x] Implement small server scope helper, control event and browser cursor parser/state without new dependencies.
- [x] Fresh full check/build, existing mobile network/storage tests plus new replay tests; record fixture/live/physical-device distinctions.
- [ ] Review, commit/push and continue the remaining non-router backlog.

References reviewed12October: [MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) for named events, reconnect and close behavior; [WHATWG EventSource](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface) for Last-Event-ID and event ordering. Application-specific namespace and reset rules are Relay's deterministic transport policy, not semantic AI routing.

Verification: wrong-scope native and obsolete browser cursor regressions failed before implementation. Full strict check1,418passed/one skip across132files303.13s; production build passed. Five mobile reconnection plus seven Workbench browser cases pass1.6min; fifteen conversation/approval cases pass1.9min. These exercise the real authenticated fixture server with deterministic inference, not a physical phone or the deployed gateway. Source review retains account/session filters, revocation and stream limits. No dependencies or authentication relaxations.
