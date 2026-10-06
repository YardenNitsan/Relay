# ADR 013: Explicit task verification contracts

Status: accepted, 2026-10-06.

## Problem

A real local model completed a supervised file write and then claimed that it had called `file_read`. The write's internal read-back was real, but no separate read tool call existed. The strict acceptance script correctly rejected this run. A prompt instruction and model confidence cannot enforce a requested evidence requirement.

## Decision

An authenticated task caller can declare `options.verification.requiredReads`, containing one to eight unique permitted relative file paths and their expected whole-file SHA-256 hashes. The path and hash schema is validated both at the API and task-admission boundary. The task must have an authorized workspace. The contract persists in the existing task options; agents and planner output cannot modify it or gain permissions from it.

The supervisor checks actual completed `file_read` broker calls, their successful tool-outcome records, and their durable completion events. The latest successful read of each required path must have returned that path and exact expected SHA-256 after the latest workspace verification invalidation. An older matching read cannot override a newer mismatch. A model's text, a synthetic context receipt, or a write tool's own read-back does not satisfy this contract.

Direct writes/deletions, commands that commit file changes, and owner uploads/reverts invalidate earlier evidence across unfinished tasks sharing the workspace. Execution owns the workspace until the task yields or finishes; maintenance reservations prevent upload/revert races. Invalidation is deliberately conservative: an unrelated file change also requires new reads. Historical completed tasks remain historical records, not continuous assertions about current files.

If a worker proposes a final answer with unmet requirements, its text stays a non-final step-context candidate. Factual supervisor feedback identifies missing reads; the worker continues within the existing model-call, time and iteration budgets. No tool execution is invented or silently attributed to a model. Missing capabilities or exhausted budgets pause execution. The database completion transaction checks the contract again before creating the assistant conversation message.

## Alternatives

- Stronger prompt wording still leaves the model as the final authority.
- Matching English phrases such as “use file_read” is brittle, language-dependent and easily confused by quoted untrusted content.
- A synthetic supervisor read could provide useful evidence, but would not demonstrate that the agent executed the explicitly required tool sequence. It also needs distinct execution provenance.
- Requiring a second read for every write would change ordinary task behavior even when the broker already performs an internal hash-verified read-back. Explicit predicates preserve that distinction.

## Scope and limitations

This is a reusable exact-file predicate, not a general natural-language truth detector. It does not prove every sentence in an answer or infer arbitrary acceptance criteria from prose. Initial declaration is through the API; the ordinary browser composer does not yet expose a contract editor. Files remain bounded UTF-8 managed-workspace files. `file_read` computes its hash over the whole file before truncating displayed content, so a shortened display can still carry complete hash evidence. Arbitrary third-party tools cannot claim this trusted broker identity.

The actual Ollama acceptance declares the expected greeting bytes through this contract while retaining its original independent requirements: completion, exact changed bytes, persisted assistant reply, and a real `TOOL_COMPLETED(file_read)` event. Ordinary tests use deterministic providers and the actual task/evidence ledger; expensive cloud access is unnecessary.
