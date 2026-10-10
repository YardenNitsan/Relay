# Execution waits and scheduling implementation plan

**Goal:** Fix active-time accounting and allow unrelated tasks to progress during human approval without weakening concurrency, ownership or replay boundaries.

**Spec:** Original 24-section evolution directive, especially sections 3, 6, 7, 9, 10 and 18; continuation of docs/evolution-plan.md. The user's explicit autonomous implementation instruction authorizes this internal work without a new design approval cycle.

**Architecture:** Preserve the modular monolith, three global execution slots, one local inference lease, workspace/host exclusivity and existing safe restart behavior. Extract independently testable slot admission and parallel-branch activity tracking. Durable monotonic active-time reservations exclude whole-task idle intervals; an active sibling keeps charging time. Waiting approvals remain durable records; restart invalidates stale approvals and pauses work rather than replaying proposals.

## Tasks

- [x] Add an immutable migration for approval/resource wait counters and a current wait marker; preserve v4 SQL/checksum. Update migration acceptance for the appended version.
- [x] Add suspend/resume to ExecutionBudget. Before waiting, persist only already-consumed active reservation, refund future reservation and stop expiry timers. Before resuming, reserve fresh capacity. Persist wait durations, handle crash/stale lease/cancellation and serialize refresh with state changes. Test long human/resource waits, resumed exhaustion and recovery.
- [x] Add branch-aware activity coordination. All branch waits suspend accounting; one still-active branch prevents suspension. Finishing siblings and mixed resource/approval waits must be tested. Integrate tool/cloud approval and local-lease acquisition without changing exact-argument grants.
- [x] Add bounded task slots with cancellation and idempotent release. Release a global slot only when all branches wait for approval; acquire it before resuming any work. Resource waits retain their slot to avoid a local-lease/scheduler deadlock. Keep workspace and host exclusivity for live continuations.
- [x] Honor per-account concurrency grants subject to global capacity. Bound owner preference by queue age. Expose effective limits honestly and distinguish in-flight quota from execution concurrency. Test cloud concurrency, approval-slot reuse, resumed contention, local serialization, cancellation and shutdown.
- [x] Run focused adversarial/integration tests, strict types, full regressions and relevant browser checks. Review changes and update the ledger/report with measured results and remaining limitations. Continue next core workstreams after this increment.

## Invariants and limits

- No model loading, cloud calls or resource stress needed for deterministic acceptance.
- Human waits must not reserve RAM/VRAM or an execution slot indefinitely. Logical workspace/host exclusivity remains until a live task is cancelled or resolved; releasing that lock without durable continuation/revalidation is unsafe and remains a separate enhancement.
- A pending approval still counts toward the account's in-flight quota, preventing unbounded parked tasks. No permission or financial budget increases.
- An approval for one parallel branch must not mark an active sibling unauthorized by flipping the task-wide state prematurely.
- Budget and scheduler reacquisition happen before tool/provider execution. Revocation is checked while waiting and again at the existing execution boundary.
- Recovery charges previously reserved active time only, records interrupted waiting separately, and retains uncertain-effect refusal. It does not silently auto-resume externally consequential actions.
- Wait metrics are exclusive whole-task idle intervals, not the sum of concurrent agent waits. Mixed waits use resource as the dominant category until all branches await human decisions. No configurable overall deadline is added by this increment.

Research checked: Node performance.now monotonic timing, PostgreSQL transaction locks, and durable-execution checkpoint guidance (links in evolution ledger). Framework replacement is unnecessary.
