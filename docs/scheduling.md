# Owner-controlled local scheduling

Relay supports confirmed one-time tasks and fixed intervals from 15 minutes to one year. A schedule stores its objective, explicit call/time/iteration/output budgets, local model selection, context limit and read-only workspace scope. Creation requires `confirmed: true`; `enabled` is a separate required choice. Only a current, local owner session can create, inspect, enable, disable or archive schedules. Merely waiting does not approve a task.

Schedules run through the normal Engine queue, account concurrency checks, local inference lease, hardware admission, memory watch, execution budgets and tool broker. The scheduler does not directly invoke a provider or bypass those boundaries. An unavailable runtime or insufficient resources can pause or fail the resulting task; a saved schedule does not guarantee successful execution.

## Restricted background capabilities

The first implementation permits local-only, read-only tasks. Cloud spending is fixed at zero; network access is denied; MCP servers, personal-assistant tools, direct host access, shell execution and workspace mutations are unavailable. An approved managed workspace may be read. The schema rejects unknown options instead of silently discarding a requested capability. Optional required-read verification uses the existing task contract.

The durable owner account, session version, provider permissions, task budgets and workspace existence are checked again during admission and immediately before dispatch. The saved grant snapshot documents authorization at creation/enable time and never replaces current permission checks. Revoked sessions disable their schedules; explicitly enabling from a current session records fresh authorization. Emergency stop admits no occurrence. Disabling or archiving increments a revision, prevents a pending claim from dispatching and cancels linked unfinished tasks through the Engine.

## Persistence and recovery

Migration 8 creates `task_schedules` and `schedule_runs`. A transaction takes locks in control → user → schedule order, claims a unique `(schedule_id, scheduled_at)` occurrence, invokes the same atomic Store admission used for interactive tasks, creates its conversation/task and advances the next due time. Admission failures roll back all those writes. Account quota failures and unfinished prior runs remain visible and retry later. Due schedules rotate by their last attempt/update so a blocked schedule cannot monopolize the polling loop.

Dispatch is **at most once**, not exactly once. The receipt is marked dispatched before enqueueing. A crash between those operations can lose that occurrence. Startup recovery, after Engine recovery, marks abandoned/paused claims interrupted; it does not automatically replay them. A prior unfinished or paused task blocks further runs of that schedule until reviewed or cancelled. Task state is returned alongside dispatch state, so a dispatched receipt never implies task success.

The poller admits at most one occurrence every 15 seconds and never overlaps its own tick. `stop()` joins its in-progress tick before the database closes. Fixed intervals use stored UTC instants; they are durations, not local-calendar recurrence, and therefore do not shift for daylight saving. The UI converts local date/time input to UTC. No cron or conditional triggers are implemented.

For missed runs, `once` admits at most one overdue occurrence and advances straight to the next future interval. `skip` records an occurrence as skipped when it is first observed more than 60 seconds late after downtime. Each poll remembers first discovery of its bounded due set (at most 50 occurrences, matching the per-account retained schedule limit). Ordinary dispatcher backlog and quota waiting do not turn an already observed on-time occurrence into a missed run. Observations are specific to the schedule, occurrence and authorization revision; they clear after a polling gap over 60 seconds, global stop, pending restoration or service shutdown. This in-memory timing hint never substitutes for durable admission or authorization. Neither policy creates a catch-up storm. A completed one-time schedule has no next due time; create a new schedule to repeat it.

The poller also starts on a restored host, but pending restoration and global stop are checked under the control-row transaction lock before both claiming and dispatching work. Owner review and explicit resume therefore restore scheduling without a process restart. Restored schedules retain revoked session versions and require explicit reauthorization; review alone does not restore old background grants. Remote listeners and optional runtime startup still require their separate host lifecycle review/restart.

Retention is bounded at 50 schedules (including archived schedules) and 5,000 run receipts per account. Reaching capacity blocks creation or pauses scheduling with an explanation. There is no automatic deletion, and archiving preserves linked conversations, tasks and evidence. History reads return the latest 50 receipts. An explicit safe pruning/export workflow is still outstanding.

## API and host lifecycle

`ScheduleService(store, engine, {now?})` exposes `create`, `list`, `runs`, `setEnabled`, `archive`, `tick`, `start` and `stop`. `now` is only a clock seam for deterministic tests. Production calls `await service.start()` after `Engine.initialize()` and `await service.stop()` before closing persistence.

`scheduleRoutes(app, service, owner)` registers:

- `GET /api/schedules`
- `POST /api/schedules`
- `GET /api/schedules/:id/runs`
- `POST /api/schedules/:id/enabled` with `{enabled, confirmed:true}`
- `POST /api/schedules/:id/archive` with `{confirmed:true}`

The creation body is `{name, objective, startAt, intervalMinutes, missedPolicy, enabled, confirmed:true, options}`. `startAt` must be a future UTC ISO timestamp; `intervalMinutes:null` means one-time. Existing HTTP authentication, origin and CSRF controls remain in force. The service independently rechecks account ownership and revocation and scopes every object read/write by account.

## Verification and limits

`tests/schedules.test.ts` uses real in-memory PGlite with a fake Engine queue and injected clock. It covers capability rejection, consent, cross-account isolation, atomic quota rollback, duplicate scheduler instances, no-catch-up behavior, stop/revocation, grant narrowing, bounded retention, blocked-task fairness and disable-before-dispatch races. These are real database/state-machine tests; they are not live inference, real-time timer accuracy or native PostgreSQL concurrency acceptance. Existing task-admission and conversation tests protect the extracted Store admission helper.

Verified on October 10, 2026: `npm.cmd test -- tests/schedules.test.ts tests/task-admission.test.ts tests/conversations.test.ts --maxWorkers=1` passed 23 tests across three files (34.81 seconds), including 14 schedule cases. `npx.cmd tsc --noEmit -p tsconfig.json` passed. No model was loaded or paid provider called for these checks.

Follow-up verification on October 10: `npm.cmd test -- tests/schedules.test.ts --maxWorkers=1` passed all 19 schedule cases (31.72 seconds), including pending-restoration claim/dispatch gates, explicit review without recreating the scheduler, seven simultaneous due occurrences without false backlog skips, and downtime/global-stop observation resets. `npm.cmd run typecheck` passed. This remains deterministic database and queue verification, not native timer or model-execution acceptance.

External integrations, email/calendar actions, notifications, conditional triggers, multi-host scheduler operation and general background mutation are not implemented. Native PostgreSQL lock contention and long-running restart tests remain separate operational acceptance work.
