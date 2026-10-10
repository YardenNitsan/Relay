# Bounded task-specific workflows

`server/orchestration/workflow.ts` provides a pure, schema-validated compiler for a small analysis DAG followed by the host's worker and reviewer. Engine/planning integration and its acceptance evidence are recorded separately in the evolution ledger. The compiler does not call a model or execute tools.

Relay already supports a planner that selects a bounded list of specialist roles. Version 1 extends that proposal with task-specific subobjectives, expected outputs and dependencies. Legacy `{specialists, acceptance, reason}` proposals remain supported. Invalid proposals should retain the existing host-built graph; a malformed plan never grants additional authority.

```json
{
  "version": 1,
  "nodes": [
    {"key":"structure","role":"architect","objective":"Inspect parser boundaries","expectedOutput":"Relevant contracts and evidence references","dependencies":[]},
    {"key":"risk","role":"security_reviewer","objective":"Review the identified parser boundaries","expectedOutput":"Concrete risks and checks","dependencies":["structure"]}
  ],
  "acceptance": ["Existing parser tests pass after implementation"],
  "reason": "Boundary review benefits from the repository inspection."
}
```

## Deterministic boundaries

- Deep permits at most two analysis nodes; Maximum permits at most three. Architect and security reviewer are available in both; researcher requires Maximum. Fast/Balanced remain outside specialist planning.
- The strict schema accepts no permission, tool, command, budget, model or arbitrary role fields. Text fields remain untrusted task data. Schema validation alone does not make their contents safe instructions.
- Node keys must be unique. Unknown, repeated, self and cyclic dependencies are rejected. Forward references are allowed only when the complete graph is acyclic.
- Roots depend on the existing completed planner. The host assigns new durable IDs, joins all analysis leaves into a **single worker**, and appends a reviewer dependent on that worker. Proposals cannot insert mutation-capable workers, replace the reviewer or bypass its dependencies.
- The current engine's role/tool policy must remain active: these analysis roles receive only the existing permitted read tools; only the host's worker may receive mutation tools. Resource admission, shared local inference lease and task budgets remain independent of planning.
- A graph can be adapted only while its single root planner is completed and every other existing step is untouched and pending. Started, completed, failed or cancelled downstream work is frozen. Foreign-task steps and ID collisions are rejected.
- Every pending analysis node plus worker and reviewer requires a remaining model call. This is a minimum admission cost, not an estimate of total completion cost. Tool loops and retries can still exhaust the task budget.

## Integration contract

`compileWorkflow(task, existingSteps, parsedProposal)` returns `steps`, `stepInstructions`, `acceptance`, `reason` and `format` (`dynamic` or `legacy`). Tests may inject `idFactory`; production uses UUIDs. Inputs are not mutated.

`adaptPlan` should retain its existing task-row transaction and one-time `plan_decision` guard. Read **fresh `calls_used` inside that transaction** and pass it as `task.callsUsed`; the task object captured before planner inference is stale. Parse bounded planner text, compile the proposal, and persist the decision, new graph and per-step instructions atomically. On invalid proposals preserve the established graph and record a concise rejection reason, without exposing untrusted text in an error.

Persisted `stepInstructions` gives each analysis node its own objective and expected output. Feed it to that step as attributed user-role task data, never as trusted system policy. Acceptance text is a proposed success criterion; it does not create an executable verification contract or prove completion. Existing deterministic checks and evidence-based finalization remain authoritative.

Existing graph creation currently checks the default graph against total call budget before the planner runs. Supporting lighter generated graphs under budgets smaller than that default requires a separate initial-admission change with tests; this compiler does not silently bypass that existing behavior.

## Verification and limitations

`npm.cmd test -- tests/workflow.test.ts` covers independent/dependent nodes, host-owned worker/reviewer edges, legacy compatibility, zero-specialist plans, duplicate and cyclic graph rejection, role/depth limits, forbidden fields, remaining-call admission, frozen work and ID collision handling.

This increment does not offer arbitrary mutation branches, parallel writers, automated acceptance-test synthesis, quality claims about planner output, or unbounded repair loops. Live model planning and native tool execution require separate integration evidence.
