# Execution time, approvals and host scheduling

Relay's task seconds limit measures active execution. Queue waiting before admission does not start the execution clock. Whole-task human-approval and local-resource waits suspend it. If one parallel agent is still working, the task remains active: another agent's pending approval does not make that work free.

`ExecutionActivity` tracks a complete wave of independent graph branches. It suspends `ExecutionBudget` only when every remaining branch waits, and handles a working sibling finishing while others wait. Mixed human/resource waits are recorded as resource waiting; only an entirely human-blocked wave is recorded as approval waiting. These are exclusive whole-task intervals, not sums of overlapping agent durations.

## Durable accounting and recovery

Migration 5 adds cumulative `approval_wait_ms`, `resource_wait_ms` and a current wait marker. Active execution continues to reserve at most five seconds ahead. Suspension reduces the durable reservation to time already consumed by this run and stops active expiry/refresh timers. Resume obtains a fresh reservation before dispatch. Refresh, suspension, resume and cleanup are serialized and qualified by lease identity; stale cleanup cannot erase a newer run's reservation.

Normal durations use Node's monotonic clock. Recovery consumes only the previous active reservation and records an interrupted wait separately, using its persisted wall-clock start. That recovered wait includes host downtime and is clamped against negative wall-clock changes; it is not billed as execution. This is diagnostic duration, not proof of how long a person was actively considering an approval.

Restart still pauses interrupted tasks and denies old pending approvals. Explicit resume retains iteration/call/cost limits, context, completed receipts and refusal to replay uncertain effects. No automatic approval replay or permission expansion was added. An overall wall-clock task deadline remains unimplemented.

## Capacity and fairness

- Account `maxConcurrentTasks` remains the maximum in-flight task quota, including queued work, pending approvals and tasks awaiting user review. Values above one now permit concurrent execution, subject to host limits.
- `TaskSlots` admits at most three executing tasks. A fully approval-blocked task releases its slot; resumption reacquires one before provider/tool execution. Pending approvals retain their account quota, preventing an account from accumulating unlimited parked tasks.
- Suspended continuations waiting for a slot receive FIFO priority over newly queued tasks. New-task ordering gives the owner a fixed 30-second head start; older remote tasks eventually precede newer owner tasks.
- Local inference retains the existing shared single-call lease, admission checks and pressure monitoring. Raising account concurrency does not enable simultaneous local model loads. Whole-task waits for that lease stop the active clock but retain the task slot, avoiding a lease/slot acquisition deadlock.
- Live workspace and direct-host exclusivity remain held across approval waits. Other tasks on the same protected resource still wait. Releasing these logical locks requires a separate checkpoint/revalidation design.
- Shutdown, emergency stop and queued cancellation are rechecked after asynchronous admission reads. Enqueuing while a drain is underway requests another pass, preventing lost wake-ups.

`/api/status` exposes host limits separately from account grants. The Access form calls the account limit **In-flight tasks** and identifies **Active seconds per task**. Counters are durable diagnostics; a full queue/load/first-token/tool/verification performance view remains outstanding.

## Verification boundaries

`tests/execution-budget.test.ts` exercises long waits, mixed categories, exhausted resume after a delayed write, cleanup races, crash recovery and stale leases. `tests/execution-activity.test.ts` covers parallel branches, cancellation, bounded slots and aging. `tests/engine-scheduling.test.ts` uses actual PGlite, task/approval records and orchestration with deterministic provider/tool fixtures to cover account concurrency, full-slot contention, approval resume, revocation, shutdown/stop/cancel admission races and the shared local lease. These tests do not establish live cloud/provider throughput or native PostgreSQL behavior.

Sources: [Node monotonic performance timing](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html#performancenow), [PostgreSQL transaction locks](https://www.postgresql.org/docs/current/explicit-locking.html), and [durable execution guidance](https://docs.langchain.com/oss/javascript/langgraph/durable-execution). Relay retains its own bounded orchestrator; no new orchestration framework or runtime service is required.
