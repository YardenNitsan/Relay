# Dispatch history, memory and schedules

12 October 2026. Frontend-only scope: HistoryStudio/HistoryTimeline/history.css; MemoryStudio/NoteReader/NoteEditor/memory.css; ScheduleStudio/ScheduleInspector/ScheduleForm and the existing dedicated `web/styles/schedules.css`. Shared shell, Modal, APIs and guards remain unchanged.

History becomes a saved-record document with the query controls above the chronology rather than a permanent sidebar. Date headings form a quiet desktop margin; phones stack dates and records. Preserve server order, bounded cursor search, message anchors, delete review and focus restoration.

Memory keeps its proven index/detail progression but gives the index actual note excerpts and a compact creation header. Reading distinguishes the saved context from the controls that allow its later use. Editing groups the note and approval controls without changing revision checks, explicit consent, dirty guards or mutations.

Schedules use a compact header and state-led ledger. Rows show only actual objective, state and planned time; the selected document emphasizes the next due time, objective, limits, authorization and run receipts. No simulated automation or new execution behavior. Preserve interval/time validation, disabled-on-create, enable/archive review, pending locks and responsive focus/scroll rules.

Dispatch tokens, restrained dividers and readable document spacing replace generic rounded-card structure. Use actual content excerpts, no filler status or counts. Preserve accessible labels, existing test hooks, phone pane breakpoint and scroll owners. At short heights favor scrollable content over growing fixed chrome.

Root owns build and browser rendering. Locally run typecheck and scoped diff checks; review control callbacks and effects for accidental changes. Existing history-studio, memory-studio, schedule-studio and related deletion/viewport suites cover behavior. Presentation-only work adds no redundant unit tests.

Implemented History's top query strip and full-width date-grouped document; preserved HistoryTimeline data ordering and controls unchanged. Memory now shows real note excerpts and explicit reading/usage sections. Schedules now combines introduction/actions, shows actual state/objective/time in the index, emphasizes the selected run time and groups creation fields into work and timing. No component effects, requests, mutation locks, callback semantics or authorization checks changed.

`npm.cmd run typecheck` passed. Scoped `git diff --check` passed for all owned feature files. Source review checked existing history, memory and schedule test selectors and preserved their accessible control contracts. Root owns build/browser acceptance, including the top-query History layout's reading space at 844×390 and all narrow focus/dirty-guard cases. Build/render acceptance is pending; no complete surface acceptance claimed.

## Integrated checkpoint

Root strict production build and rendered acceptance are recorded in [testing](testing.md): initial core92/94, corrected/supporting111/111, scheduling/initial landscape24/24, and final strict landscape/History/viewport14/14. Actual screenshot review is in [design review](design-review.md). Earlier source-only statements above describe the development checkpoint, not the latest acceptance. Physical-device, deployment and final-head CI remain separate.
