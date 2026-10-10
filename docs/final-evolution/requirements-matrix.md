# Final evolution requirements matrix

Status vocabulary: **Complete and verified**, **Implemented but insufficiently verified**, **Partially implemented**, **Not implemented**, **Blocked by unavailable external resources**. Broad rows are not complete merely because some components exist. Historical 0.1.2 evidence is baseline context, not fresh acceptance.

| ID | Requirement / directive section | Current status | Required evidence / dependency |
|---|---|---|---|
| A01 | Latest-source audit, repeatable baseline, ledger (§3,26) | Partially implemented | Fresh source/CI/tests/build/browser results; requirements inventory |
| A02 | Passing portable CI and release gates (§22) | Partially implemented | c861696 all six host/browser gates pass on Windows/Linux/macOS in run38066150868. Local full125browser pass; subsequent commits have their own gates. Native Linux run38062805371 passed. Release protection remains G05. |
| A03 | Authorization/revocation/security review (§4,11) | Implemented but insufficiently verified | FE-011 ordinary host callback omission fixed: six red/green real-file revocation cases, 1243-test full check. Full threat-model review remains |
| A04 | Overall task deadlines (§11) | Complete and verified | Durable admission/queue/active/approval/resource/restart/finalization regressions, full check 1214 passed/one skip, build and 14 affected browser cases; focused review findings fixed. Native migration portability remains A06/G02. |
| A05 | Suspended execution and uncertain-effect recovery (§11) | Partially implemented | Durable resume and no duplicate mutation scenarios |
| A06 | Native PostgreSQL upgrades/locking/restore (§11) | Complete and verified | PostgreSQL 17.11, two-pool actual migration lock contention, retained version-9 records; pg_dump/pg_restore into separate database with all 32 public tables/rows compared and foreign-key enforcement checked. Scope: local Docker, not remote production cluster. |
| A07 | Encrypted realistic backup/restore (§11) | Complete and verified | 47.6 MB stopped synthetic snapshot: 2,000 tasks, 4,000 messages, memory/schedules/grants, 200 referenced artifacts; exact retained data/hash checks, session and pending-approval revocation, restored execution blocked |
| A08 | Reference-aware artifact retention (§11) | Partially implemented | No deletion of live/historical protected references |
| B01 | Professional design research and three concepts (§13–14) | Complete and verified | `design-research.md`: inspected official/product/community sources, maintenance/license limits; `design-system.md`: ten-criterion comparison, Studio selected. UI implementation remains B02–B11. |
| B02 | New semantic light/dark design system (§14) | Partially implemented | Semantic token layer and compatibility roles integrated; initial light/dark visual/axe checks pass. All feature primitives and states remain open. |
| B03 | New adaptive shell and modular presentation (§18,20) | Partially implemented | Studio shell, explicit account destinations, feature/layout ownership; broad integration and responsive focus acceptance in progress |
| B04 | Conversation/composer redesign (§15A) | Partially implemented | New pane-aware welcome and usable model trigger; confirmed delayed-send draft loss fixed with actual browser regression; full message/composer presentation redesign remains open, existing functional flows retained |
| B05 | Execution Workbench (§15B) | Partially implemented | Dependency graph and modular output/log/check/diff/approval views integrated; visual/state acceptance in progress, full handoff/artifact inspection still open |
| B06 | Project Workspace (§15C) | Not implemented | Real files/diff/tests/checkpoints/publication/rollback/memory |
| B07 | Model Studio (§15D) | Not implemented | Measured vs estimated quality/resource/runtime/cost/reasoning |
| B08 | Devices and Connections (§15E) | Not implemented | Host/browser/Companion separation and revocation |
| B09 | First-class approvals (§15F) | Partially implemented | Focused consequence-first review, explicit host/scope/deadline/arguments, truthful one-request cloud consent and corrected fallback provenance implemented; five focused approval cases and 41 affected browser checks pass; real captures inspected in both themes on phone/desktop and rejection in short landscape. Full sensitive-action taxonomy and remaining states stay open |
| B10 | Settings and onboarding (§15G–H) | Not implemented | Personal vs host administration; everyday and advanced flows |
| B11 | Responsive, interaction, performance, accessibility (§16–19) | Partially implemented | Every new screen/state/viewport; WCAG 2.2 AA target, no certification claim |
| C01 | Larger realistic repository import/discovery (§7) | Partially implemented | Hundreds of files, bounded configurable tiers and relevant search |
| C02 | Safe branch-aware Git worktrees (§7) | Not implemented | Dirty source preservation, isolation, conflicts, review |
| C03 | Create/delete/rename/multi-file publication (§7) | Partially implemented | Presence-aware additions/deletions and rename pairs within existing directories, exact review/rollback, legacy journals and revocation regressions pass; new directories, metadata-preserving renames and Git-aware integration remain open |
| C04 | Reproducible language images/dependency policy (§7) | Partially implemented | Actual TS/JS, Python, .NET execution and source/network controls |
| C05 | Real coding end-to-end acceptance (§4,7) | Partially implemented | Real Docker isolation/read-back/cancellation/emergency acceptance passes after cleanup-race fix; realistic multi-file model task and independent verification remain open |
| D01 | Multilingual overlapping task understanding (§5) | Partially implemented | Held-out English/Hebrew paraphrase and intent comparison |
| D02 | Versioned executable capability benchmarks (§5) | Partially implemented | Challenging multi-file/tasks, outcome graders, held-out set |
| D03 | Evidence-aware intelligent routing (§5) | Partially implemented | Comparable selection/task-quality evidence; hard constraints first |
| D04 | Dynamic safe collaborative execution (§6) | Partially implemented | Multiple isolated workers, durable integration/cancel/resources; depends C02 |
| D05 | Structured handoffs and collaboration utility (§6) | Partially implemented | Receipts/artifacts/context attribution and single-vs-multi outcome benchmark |
| D06 | Hardware admission/residency/performance (§11,23) | Partially implemented | Comparable live resource/latency measurements with reserves unchanged |
| E01 | Companion identity/transport/pairing/revocation (§8) | Not implemented | Authenticated encrypted outbound connection, replay/identity tests |
| E02 | Companion local permissions/folders/execution (§8) | Not implemented | Local approval independent of host; no unrestricted shell |
| E03 | Genuine two-device acceptance (§8) | Blocked by unavailable external resources | Second authorized computer and approved TLS enrollment |
| F01 | Project intelligence/indexing/retrieval (§9) | Partially implemented | Incremental scoped evidence classes, controls, relevance comparison |
| F02 | Google Workspace live read acceptance (§10) | Blocked by unavailable external resources | Configured OAuth application and owner consent |
| F03 | Explicit external writes with duplicate prevention (§10) | Not implemented | Draft/send/event changes; denial/timeout/restart tests |
| F04 | Isolated browser automation (§10) | Not implemented | Controlled navigation/interactions with untrusted page boundaries |
| F05 | Useful schedules/notifications/conditional automation (§10) | Partially implemented | Mutation grants/receipts first, missed-run and recovery acceptance |
| G01 | All fourteen real-world scenarios (§21) | Partially implemented | See acceptance-results; fixture/live evidence separated |
| G02 | Native OS/hardware and packaging (§11,22) | Implemented but insufficiently verified | Windows/Linux/macOS functional claims and signed release limits |
| G03 | Performance budgets and comparable measurements (§23) | Not implemented | Startup/input/history/discovery/load/tools/queue/memory/bundle/retrieval |
| G04 | Threat-model review and security regressions (§11) | Partially implemented | Full boundary inventory and actionable finding closure |
| G05 | Branch protection and license (§22) | Blocked by unavailable external resources | main currently unprotected; owner approval required for license/admin policy |
| G06 | Final evidence, screenshots, comparison and scorecard (§25,27) | Not implemented | Honest evidence-based evaluation; no invented scores or unfinished green rows |

Only A04 (deadlines), A06 (native database acceptance), A07 (encrypted restore drill) and B01 (research/concepts) are complete within their documented verification scope. Local-only historical chat and the existing test suite do not imply the new coding, Companion or redesign criteria are met.
