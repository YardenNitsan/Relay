# Structured agent handoffs

`server/orchestration/handoff.ts` defines the version 1 handoff contract and a pure builder. Engine integration is tracked separately in the evolution ledger; the builder alone does not change execution or recovery.

A handoff carries task, conversation, workspace and stop-generation identity; an excerpt and SHA-256 of the original objective; the orchestrator's existing graph; current step, dependencies, completed and remaining step IDs; attributed collaborator excerpts; recorded check references; tool receipt references; and artifact references. It introduces no database or inference dependency.

## Authority and provenance

`approvedPlan.source = orchestrator_graph` means the host has selected that graph. It does not mean that the user has approved its tool actions. `grantsPermissions` is always false. Permission, provider, model, cost and resource decisions remain with their existing authorization boundaries. Handoff fields cannot grant a tool or extend a budget.

The builder accepts already-authorized durable records, never model-generated handoff JSON. It rejects mixed-task records, missing steps, duplicate identities, missing dependencies and cycles. The public schema is strict and checks graph accounting and collaborator provenance. A schema-valid object alone does not establish account authorization: callers must obtain records using the authorized task identity.

Only completed direct dependencies supply collaborator excerpts. Each excerpt records its step, role, model, full-output digest and explicit truncation flag. These are model opinions, regardless of claims inside their text. `handoffMessage` emits a **user-role untrusted-data message**, never a system instruction. Prompt injection can still be present in text; deterministic tool authorization remains necessary.

`model_review`, `response` and records explicitly marked `objectiveVerification: false` cannot become verified findings. Other passing durable checks describe their recorded observation, not proof of overall task completion. Failed checks remain separately visible. Check records must arrive in ascending durable sequence order, as `Store.verification` returns them; the latest record for each `checkKey` supersedes earlier records. Unkeyed records remain individually attributable. Changed files, resource state or external state still require fresh verification.

## Input and persistence contracts

```ts
buildHandoff({
  task, currentStepId, steps,
  checks,    // Verification[] with optional checkKey, chronological order
  receipts,  // {id, taskId, agentId, stepId?, name, status}[]
  artifacts, // {id, taskId, name, mime}[]
}, {maxBytes: 8192});
```

Tool statuses remain `running`, `completed`, `failed` or `uncertain`. All supplied receipt references are retained, including successful actions, so size reduction cannot silently erase their execution record. The builder excludes arguments and result bodies. Artifact references include ID, name and MIME type; absolute host paths and file contents are excluded. Resolve those references only through existing authorized storage and tools.

The graph fingerprint covers full step IDs, roles, titles and dependency edges. It remains stable when status changes; it is not an approval token. The objective digest covers the complete original text even when the excerpt is shortened. The original task record and original objective in the execution context remain authoritative.

On restart, existing step context, assistant/tool receipt pairs, interrupted-proposal handling, task pause and uncertain-effect refusal must remain intact. A handoff supplements these records. It must not replace saved recovery context, cause a successful mutation to be replayed or automatically retry an uncertain operation.

## Bounded context

The default maximum is 8,192 UTF-8 bytes of serialized JSON; callers may select 2,048–32,768 bytes. The builder admits at most 32 graph steps, 2,000 check records, 2,000 receipts and 1,000 artifact references. These are context bounds, not permission or execution limits.

Excerpts respect Unicode boundaries, and final sizing includes JSON escaping. Optional collaborator excerpts, passing observations, model assessments and artifact references may be removed, with explicit omission counts. Failure records, receipt references, graph structure and task identity cannot be dropped to fit. If essential records exceed the cap, the builder returns `HANDOFF_BUDGET`; callers must increase context or narrow the objective. Omission is never evidence that no records exist.

The byte cap excludes the short `handoffMessage` wrapper. Callers must also reserve context for that wrapper, the complete current objective, system instructions, tools and required review inputs. Existing context admission must remain active. This contract does not promise that every graph fits every model.

## Validation and remaining work

`npm.cmd test -- tests/handoff.test.ts` verifies provenance, recovery identity, check supersession, model-opinion separation, cross-task rejection, graph validation, argument/result/path exclusion, Unicode/JSON byte limits, omission reporting and essential-record overflow.

Remaining dependencies include engine integration, durable reference loading scoped to the task, end-to-end context/recovery tests, and user-facing evidence presentation. The current constrained planner already selects a bounded specialist list; task-specific subobjectives and dependency edges require a separately validated graph proposal contract. Handoffs do not implement dynamic planning by themselves.
