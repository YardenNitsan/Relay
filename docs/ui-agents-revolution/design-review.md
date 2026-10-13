# Dispatch rendered review

## Current0.4 checkpoint ?13 October2026

Current live Dispatch Work/Agents/Projects reviewed at320/390/768/1440/2560px in both themes (30combinations); no document overflow, representative screenshots inspected. Native0.4 uses original outline navigation icons, explicit private notification permission/copy and offline Retry/Forget states. Secure-screen UIAutomator evidence is interaction evidence, not visual screenshot proof. Full premium native design remains in progress. [Acceptance](android-0.4.md).

These observations cover actual browser renders of the new implementation, using disposable authenticated fixture data. They are not generated design mockups, physical-device evidence or live-model results. The three original concepts and selection rationale remain in [design decision](design-decision.md).

| Surface inspected | Observation |
|---|---|
| Conversation320px light | Writing-first composer,44px actions, distinct model/profile/context controls and persistent multiline draft. Welcome content scrolls above the composer. |
| Conversation768px | Initial253px composer exceeded the250px reading-space gate; letting controls share a row from650px container width resolves the unchanged regression. |
| Models1440px light | Library list and selected model document are distinct; factual availability, exact identity, measured speed and explicit actions remain legible. |
| Projects320px light | Full source path wraps, saved state is explicit, native editor controls and all four file actions remain reachable. Horizontal code scrolling preserves source bytes. |
| Settings390px light | Account/host identity, theme previews and private-notification controls form a scrollable preference document. Final minimum button sizing passes the zoom regression. |
| Memory390px dark | A readable note document separates content from enable/edit/delete controls; note scope remains explicit. |
| Access320px light | Person identity, account state and permission sections remain readable; no new grants or hidden owner actions. |
| Host844x390 dark | Horizontal section navigation leaves telemetry scroll space; measured resource facts remain distinct from admission/recovery controls. |
| Google Workspace1440px dark | Search/results and message document remain separate; hostile HTML is visibly plain text and Hebrew direction is retained. |
| History844x390 | Strict applied-message-search reproduced a clipped excerpt; shared short-height workspace scrolling now makes the full result and pagination reachable, verified by the14-case final rerun. |

Representative inspected files are retained in [evidence](evidence/README.md). The broad supporting run passes111 browser cases, including tagged axe checks, both themes, narrow/wide/short layouts, dirty/busy guards, focus return, authorization-dependent visibility and loading/error states. Earlier core run passed92/94 before the two documented corrections. See [testing](testing.md) for final follow-ups rather than treating a screenshot review as full acceptance.

No extra frontend dependency was introduced for this presentation work. Existing React, Query, CodeMirror, local fonts and icons remain. The old core StudioFrame was already removed in the core milestone; feature hooks and compatibility selectors still used by existing controls are intentionally retained. Further deletion needs reference/use evidence, not appearance-based cleanup.

Open gates include physical phone keyboards and TalkBack/screen readers, Edge/Samsung Internet, full installed native UI review, fresh final-head CI and deployment acceptance. The overall product remains incomplete.
