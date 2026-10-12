# Reviewed managed-branch integration

**Goal:** Integrate selected, reviewed child changes into its recorded managed parent, with conflict detection, stale-review rejection and durable rollback evidence.

**Architecture:** Reuse the serialized ToolBroker, managed file checks, checkpoints and deterministic Engine scheduling. Compare the immutable creation snapshot with current child and parent files. This is a conservative three-way file integration, not original-repository Git history import or a Git merge commit. Same-file divergent edits require explicit resolution in the editor; no model or heuristic merges them.

**Spec:** Final directive sections 6–8 and 14; `managed-branches.md`, `master-plan.md`, `requirements-matrix.md` C02.

**Constraints:** Router paused. Only the local owner can integrate. Original source remains untouched. No source Git configuration/hooks, host shell, new dependency or schema migration. Preserve fail-closed path, expected hash, per-effect authorization, quota and uncertainty guards. Use the existing isolated modernization worktree.

## Steps and ownership

- [x] Add failing reservation tests in `tests/workspace-safety.test.ts`: both IDs reserved before asynchronous checks; queued work waits; either busy rejects; failure releases both; both prior command checks become stale. Implement `Engine.mutateWorkspaces(ids, operation)` and delegate the existing single-workspace method to it.
- [x] Add failing `tests/branch-integration.test.ts` for real managed parent/fork/create/edit/delete, independent parent edits, identical edits, conflicts, stale digest, missing/noncreation baseline, revocation, emergency stop, checkpoint failures and rollback conflicts. Implement comparison in `server/tools/branch-integration.ts` and strict existing-baseline reading in `git-baseline.ts`; broker methods provide preview, bounded file detail, selected apply, history and rollback. Prepared checkpoints block further integration until inspected; never retry uncertain writes automatically.
- [x] Add local-owner/session/CSRF/API tests. Register focused routes in `server/api/branch-integration.ts`; reserve immutable child and parent together. Reauthorize both within queue and at every file effect. Return durable receipts; audit the outcome without source contents.
- [x] Add `IntegrateBranch.tsx` under Projects. Show exact parent, changed-file index, explicit selectable safe changes, base/parent/child comparison, conflicts, confirmation, persisted receipts and guarded rollback. Keep phone actions reachable, preserve draft/busy guards, and acknowledge successful writes before refresh. Update fork copy accurately.
- [x] Strict checks and build, real browser acceptance at 320/390/desktop, inspect rendered output, update operating rules/ledgers and commit/push this reviewed increment. Hosted gates are tracked separately.

## Review focus

1. Partial multi-file writes are uncertain, not atomic: prepared receipts remain visible and block blind retries.
2. Parent and child admission must be reserved synchronously before any database await.
3. Missing historical baseline must refuse integration rather than capture current files as a fabricated ancestor.
4. File/directory path collisions, stale snapshots and account revocation must fail without overwriting unrelated files.
5. A lost response must be recoverable through persisted history; rollback checks the current parent and never overwrites later edits.

Use the existing execution/TDD/verification skill workflow; continue inline. This plan is an implementation checkpoint, not product completion.

Verification: full1399passed/one skip, strict build, final31browser cases pass. Hosted release gates and broader C02 source-history/merge requirements remain separate.
