# C02 Git worktrees implementation plan

> For agentic workers: use `superpowers:executing-plans` to implement this plan task by task. Independent review is required at the security and integration boundaries. The checkboxes describe future work; none is completed by writing this document.

**Status:** Narrow managed-snapshot forks and staged encrypted-restore relocation are implemented on the modernization branch. Actual Git, API/registration, native migration11, encrypted restore and responsive UI checks pass; the final combined gate is tracked in progress.json. The broader source-aware import, integration/conflict and interrupted-registration lifecycle below remains unimplemented. This document originated as a source-inspection plan; its remaining checkboxes are not completion claims. No production deployment occurred.

**Goal:** Give coding tasks genuinely isolated, branch-aware Git worktrees, preserve the original repository including dirty state, and expose exact changes for reviewed integration.

**Architecture:** A Relay-owned repository contains only admitted workspace content and Relay-created commits. Its linked worktrees belong to durable task records. Source Git metadata and selected commit content enter through a separate bounded reader; the source repository is never the execution repository. Existing file checkpoints and publication remain separate mechanisms with explicit bridges.

**Tech stack:** Node.js 24+, TypeScript, existing trusted Git discovery and process supervision, PostgreSQL/PGlite, ToolStore private filesystem records, Fastify, React, and the existing isolated terminal boundary.

**Spec:** Owner directive sections 6 and 7 in `../Relay/last-prompt.txt`; C02 and D04 in `requirements-matrix.md`; `../product-spec.md`, `../architecture.md`, `../implementation-plan.md`, and `master-plan.md`. C01 size tiers, C03 Git-aware publication, and D04 concurrent collaboration remain distinct dependencies.

## Current behavior and why it is not a worktree

`ToolBroker.createWorkspace` in `server/tools/index.ts` copies `snapshot(source)` into `workspaces/<workspaceId>/files`. `files.ts` and `platform.ts` admit bounded UTF-8 text, exclude Git internals, protected paths and generated trees, and reject links on direct access. The current limits are 2,000 admitted files, 1 MiB per file and 50 MiB total. Imported files are copied as content, not as a faithful representation of source executable bits or ACLs.

`git-baseline.ts` saves an immutable content baseline. A legacy workspace without one receives a truthfully named `first_inspection` baseline; this is not an authentic import baseline. Publication requires `workspace_creation` and accounts for completed publication receipts when deriving its next comparison.

`ManagedGit.inspect` in `git.ts` creates a disposable bare SHA-256 repository under `git-runs`, fast-imports two synthetic snapshots named `baseline` and `current`, and calls `diff-tree`. Every imported entry has mode `100644`. Results explicitly say `managed_workspace_baseline`. There is no source branch, source index, source history, linked worktree, persistent task branch, or merge. Its security depends on never loading source repository configuration.

`git-process.ts` already provides a standard-location executable, shell-free argument arrays, a scrubbed environment, disabled hooks/fsmonitor/helpers/protocols, bounded output and abort handling. This is a useful foundation, not permission to run the same commands against arbitrary `.git` directories. Repository-local configuration and attributes introduce additional behavior that global-config suppression alone does not remove.

Workspace identity is duplicated: `ToolStore` has strict `workspaces.json` records, while `Store.saveWorkspace` writes SQL rows. Checkpoints identify only `workspaceId`. The broker resolves every file operation through `workspaceRoot(id)`, and its queue serializes managed operations globally. `Engine.drain` and `mutateWorkspace` reserve a workspace by ID; `mutateOriginalProject` adds a host-access reservation. Workspace routes in `server/api/app.ts`, publication, task diffs, terminal snapshots and checkpoint restoration currently assume a single file root.

## Design boundaries

### Immediate narrow increment: managed workspace forks

Implement this checkpoint first. It does **not** depend on source Git inspection or selected-commit import in Task 2. Those remain future source-aware work. The existing sanitized managed snapshot is sufficient to create a real Relay-owned repository and linked worktree safely.

**Step A — storage helper and actual Git tests.** Add a private helper in `server/tools/git-worktrees.ts` taking a generated workspace UUID, a bounded `Map<string, string>`, `AbortSignal`, synchronous stop guard and asynchronous authorization callback. It returns an owned repository/worktree binding only after verifying registration, generated branch HEAD, baseline tree and copied file hashes. Callers supply no Git arguments, refs or host paths. Use a bare SHA-256 repository, an empty template, `worktree add --no-checkout` with an explicit generated branch/ref and exact commit ID, `copySnapshot` for raw bytes, and index-only `read-tree` for the known baseline. **The index operation must target the linked worktree's own administrative Git directory/index, not the bare repository's index.** Preserve the current `100644` content-only mode semantics in this first increment.

Keep the child file root at the existing `workspaces/<childWorkspaceId>/files` location so the current file broker, checkpoints and scheduler do not require a new task-root mapping yet. Its `.git` file is generated control metadata and remains excluded from every model/sandbox snapshot. Keep private repositories and operation receipts outside that root. Account for them in `StorageBudget`, use private native ownership, and journal registration before an effect. Stop and cleanup must join Git and share one cleanup promise. A collision must preserve the existing branch/registration; never use `-B`, arbitrary force removal, or global prune.

- [ ] Add actual Git tests proving `worktree list --porcelain` identifies the owned child, its HEAD is the generated branch, and its own index contains the expected baseline while the bare index is not used as a substitute.
- [ ] Verify exact empty/BOM/CRLF/Hebrew text bytes and inherited hostile `GIT_*` variables, source `.gitattributes` filter/diff declarations, hooks/templates and config. Sentinel helpers must never execute. Two children must have distinct branches/indexes and edits in one must not change the other or the parent's files.
- [ ] Inject cancellation during registration/materialization and cleanup failure; verify no unowned paths/refs are removed, partial state is retained for recovery, and stop waits for process closure. Check file/storage limits without relaxing existing limits.
- [ ] Implement only enough helper code to pass these cases, then independently review it. Run its focused actual-Git tests and existing `tests/tools-new-git.test.ts`; no browser or inference run is needed for this checkpoint.

**Step B — explicit broker/API fork.** The implemented `POST /api/workspaces/:id/fork` takes strict `{name}` input. The broker creates a **distinct ordinary Workspace UUID**, captures the parent managed tree under its maintenance/serialization reservation, and invokes Step A. Parent activity must not change the snapshot during capture. The child inherits the parent's immutable owner identity, receives its own authentic fork-time content baseline and has **`sourcePath: null`**. This prevents the existing publication code from mistaking a fork baseline for authority to modify an original source. Integration/publication remain unavailable for forks until their separate reviewed contracts exist.

Persist private repository/parent/child bindings in separate versioned metadata plus an append-only SQL mapping migration; do not invent unsupported properties on the existing strict workspace JSON schema. Publish the child to listings/admission only after filesystem and SQL records agree. Recovery must identify a created child whose SQL save failed; never silently adopt or lose it. Task 1 below expands this model only when task-specific branch lifecycle is introduced.

Existing scheduler reservations already distinguish the child's new workspace ID. Keep current concurrency and broker serialization otherwise unchanged. Private ownership can be inherited, but a grant for the parent UUID does **not** grant the child UUID. Initially permit private-owner forks and local-owner shared-workspace forks; refuse invited-user shared-workspace forks until an explicit child-grant policy exists. Recheck session, account, parent access and stop after waiting and before effects.

- [ ] Add broker/API cases for separate child identity, original/parent bytes unchanged, correct owner, no child grant inferred from a parent grant, live-session revocation, stopped/busy parent, duplicate requests/collisions and JSON/SQL partial failure.
- [ ] Verify existing file read/write, actual terminal export, `git_status`/`git_diff`, checkpoints, task admission and restart work with the child root without escaping through its `.git` pointer. The diff baseline must be the exact fork-time parent content. Verify publication refuses the child with no source path.
- [ ] Run focused authorization/workspace/Git tests and strict types, then add the explicit fork UI and its browser tests only after the API boundary passes review. Record this as **managed Git worktree forks**, with source-branch discovery, source-history preservation in the copy, branch integration and Git-aware publication still open.

This is the concrete next implementation increment. The remaining tasks below describe the broader source-aware and task-bound evolution; their extra source-import requirements do not block the managed-only helper or fork API.

- Preserve the original worktree, index, refs, reflogs, configuration, hooks, ignored files and untracked files. Never stash, reset, clean, checkout, commit, create a branch, or register a worktree in the source repository. Do not clone with hard links or alternates to source objects. No fetch, submodule update, credential lookup or push is part of C02.
- Use a private repository per managed project and generated refs such as `refs/heads/relay/task/<uuid>`. Keep source branch and source commit identity distinct from Relay branch and Relay baseline identity: sanitized imports are not identical to the original commit.
- Support two explicit import choices: the current working copy, including admitted dirty/untracked files; or an explicitly selected local branch commit without overlaying the current working copy. Never apply dirty files from one branch to another implicitly. Detached HEAD is a supported, disclosed origin. Unsupported source layouts fail with a reason, without silently claiming branch awareness.
- Private task branches start from an immutable imported or integrated workspace baseline. Source changes after capture do not silently refresh a running task. Explicit refresh creates a new reviewed baseline and invalidates old integration/publication previews.
- Keep `.git`, private repositories, refs, indexes, journals and source-object quarantine inaccessible to model file tools, terminal snapshots and ordinary downloads. A worktree's generated `.git` pointer is control metadata, not a file tool exception. It may point only to its recorded private repository.
- Existing permissions, exact approvals, owner-only host imports, session/version checks, emergency-stop generation, deadlines, storage reserves and sandbox limits continue to apply. A Git label, branch name, manifest or repository file grants nothing.
- Do not execute project hooks, filters, text conversion, merge drivers, signing programs, fsmonitor, pagers, credential helpers, editor commands, config includes or repository-supplied Git executables. Keep source comments, commit messages and paths as untrusted data.
- Initial worktree support retains the current text/file limits and scheduler serialization. It provides isolation without claiming parallel execution. D04 may later use the recorded worktree identity to authorize independent writable worker branches and change scheduling.
- Cancellation joins subprocesses before releasing reservations or deleting their directories. A durable prepared operation with an ambiguous effect becomes `uncertain`; restart must not retry it automatically. Cleanup failure retains an inspectable record and cannot convert failure into success.

Git supports linked worktrees with shared repository data and separate administrative state, and `worktree add --no-checkout` suppresses materialization. Use explicit generated branch names and commit IDs, avoiding forced branch reset. These are proposed building blocks, not verified Relay behavior. See the [Git worktree manual](https://git-scm.com/docs/git-worktree).

## Contracts and file ownership for implementation

| File | Planned responsibility |
| --- | --- |
| `shared/git-worktrees.ts` | Versioned public schemas for source provenance, worktree summaries, operation states, integration previews and receipts. |
| `server/tools/git-source.ts` | Read-only source layout/ref capture and bounded selected-tree extraction; never runs Git with source configuration. |
| `server/tools/git-process.ts` | Fixed internal commands, binary-safe object output, abort/join behavior and trusted private execution configuration. |
| `server/tools/git-worktree-store.ts` | Validated private metadata paths and durable filesystem operation journal. |
| `server/tools/git-worktrees.ts` | Private repository creation, worktree allocation, raw-byte commits, validation, recovery and scoped cleanup. |
| `server/tools/git-integration.ts` | Immutable three-way comparison, reviewed integration into the managed project, and conflict receipts. |
| `server/db/git-worktrees.ts`, `server/db/migrations.ts` | Account/project/task associations, operation state and compare-and-swap updates. |
| `server/tools/index.ts`, `store.ts`, `git.ts`, `files.ts`, `git-baseline.ts` | Root resolution, checkpoint identity, actual branch-aware inspection and compatible snapshot behavior. |
| `server/orchestration/engine.ts`, `server/db/store.ts` | Allocation/resume lifecycle, reservations, final verification, recovery and shutdown ownership. |
| `server/api/git-worktrees.ts`, `server/api/app.ts` | Authenticated source preview/import, worktree inspection, integration and discard contracts. |
| `server/tools/publication.ts`, `shared/publication.ts` | Explicit Git-aware publication boundary after managed integration; preserve v1/v2 digests. |
| `web/features/projects/*`, task diff/checkpoint consumers | Source/Relay branch distinction, branch selection, conflicts, review and lifecycle feedback. |
| `server/tools/storage-budget.ts`, `server/db/backup.ts`, restore/retention callers | Include Git storage, retain uncertain operations, and validate restored bindings. |

New public IDs are opaque UUIDs. Clients and models never supply a Git directory, worktree root, arbitrary ref expression, arbitrary command, remote URL or filesystem cleanup target.

Proposed internal interfaces:

```ts
type GitOperationContext = {
  signal: AbortSignal;
  guard: () => void;
  authorize: () => Promise<void>;
};

captureGitSource(input: SourceSelection, context: GitOperationContext): Promise<SourceCapture>;
allocateTaskWorktree(taskId: string, context: GitOperationContext): Promise<WorktreeBinding>;
resolveTaskFiles(taskId: string, workspaceId: string): Promise<WorkspaceFilesBinding>;
previewWorktreeIntegration(worktreeId: string, context: GitOperationContext): Promise<GitIntegrationPreview>;
applyWorktreeIntegration(previewId: string, digest: string, context: GitOperationContext): Promise<GitIntegrationReceipt>;
recoverGitOperations(): Promise<GitRecoverySummary>;
```

Define these types in Task 1 before implementing their callers. `WorkspaceFilesBinding` is a discriminated union for a legacy snapshot or a registered worktree, with a validated root and immutable baseline identity. `WorktreeBinding` carries workspace/task/owner IDs, private repository ID, generated ref, base commit, current recorded commit and operation version. `SourceCapture` contains admitted content, omission manifest, source identities, selected ref/OID and capture hashes; raw source objects are not part of its public contract.

## Review focus

1. A dirty source and a linked source worktree must remain byte-for-byte unchanged; Task 2 tests both.
2. Malicious configuration, attributes and Git metadata must not launch a helper or reach outside admitted paths; Tasks 2 and 3 use sentinel programs and denied paths.
3. Revocation while queued or during allocation/integration must stop subsequent mutation and preserve uncertain evidence; Tasks 3, 4 and 5 inject these boundaries.
4. A task's review, terminal result and checkpoint must refer to the same tree even after restart or another task's integration; Tasks 4 and 5 pin identities and reject mismatches.
5. Partial cleanup or restored absolute Git pointers must not remove a different directory or silently resume a branch; Tasks 3 and 7 exercise native failure and restore cases.

## Dependency-ordered tasks

### Task 1: Freeze contracts and durable ownership

Depends on no new runtime behavior. Modify the shared contracts, add `server/db/git-worktrees.ts` and append the next unused immutable SQL migration. Do not assume a migration number; inspect `server/db/migrations.ts` at implementation time. Read `../database-upgrades.md` first.

Store `workspace_git_repositories`, `task_worktrees` and `git_operations` as normalized records with owner/workspace/task foreign keys, unique generated ref/root identities, a version for compare-and-swap, and bounded indexed queries for nonterminal operations. States must distinguish `prepared`, `active`, `integrating`, `completed`, `discarding`, `discarded` and `uncertain`. SQL is authoritative for permission and task binding; a private filesystem journal records effects that can precede the matching SQL update. Do not pretend the two stores commit atomically.

Keep existing `Workspace` records compatible. Add Git metadata through a separate summary endpoint or an optional versioned field with corresponding strict ToolStore schema changes, not an unvalidated extra JSON property. Existing records remain snapshot workspaces until an explicit conversion creates a new baseline. Extend checkpoint metadata with an optional worktree/baseline binding; absent fields retain the old root semantics. No old task or checkpoint is silently reinterpreted.

- [ ] Add failing migration/contract cases in `tests/git-worktree-store.test.ts`: old workspaces and checkpoints still parse, mismatched owners cannot bind, duplicate task/ref allocation fails, unknown versions fail closed, and SQL failure leaves a recognizable prepared filesystem record.
- [ ] Implement the schemas, repository queries and append-only migration. Define bounded journal entry fields, content digests, operation IDs and allowed transitions.
- [ ] Run `npm.cmd test -- tests/git-worktree-store.test.ts tests/migrations.test.ts --maxWorkers=1`, using the actual migration test filename if renamed; require all existing migration-preservation assertions to remain passing.
- [ ] Obtain review of the schema/ownership boundary before allocating any real worktree. Record this as a coherent implementation checkpoint when commits are authorized.

### Task 2: Capture source branch identity without trusting its execution settings

Depends on Task 1. Implement `captureGitSource` in `git-source.ts`, with tests in `tests/git-source.test.ts`. This is the largest new trust boundary and must be independently reviewed before integration.

Resolve ordinary `.git` directories and linked-worktree `.git` files through a dedicated internal reader. Validate all parent components, ownership, canonical identity and ordinary file/directory types. For linked worktrees, bind the administrative directory and common directory separately; do not follow an arbitrary `gitdir` or `commondir` value into an unapproved location. Metadata reads must be bounded and stable across capture. Never relax `safePath` for model-facing `.git` access.

Read branch/ref and object-format metadata as data. Configuration may be parsed only through a bounded inert reader, for example the trusted executable's explicit-file config query with includes disabled and a trusted empty working directory. Never use that file as the configuration of a repository operation. Copy only validated object data into a private quarantine with a fresh Relay-written repository configuration; do not copy hooks, config, index extensions, alternates, replacement refs, grafts, remotes or credential settings. Do not hard-link copied objects. Explicitly refuse alternates, partial/promisor repositories, unsupported ref storage and unsupported object-format extensions rather than fetching or guessing.

Use full resolved object IDs, verify object type and identity, enumerate only the selected tree, and obtain raw blobs without textconv or filters. Protected files, links, gitlinks/submodules, non-UTF-8 content and over-limit entries must appear in an omission/refusal manifest and never materialize. Preserve allowed executable-mode metadata separately from content and disclose that this does not preserve source ACLs. Case-folding/Unicode normalization collisions and platform-invalid names must fail before creating files.

Proposed initial source-inspection caps are 1,024 refs, 1 MiB aggregate textual Git metadata, 20,000 copied object/pack entries, 256 MiB copied object bytes, and a 30-second command deadline. These are new conservative design limits, not claims about existing configuration. All copies also consume `StorageBudget` and retain host disk reserves. Check advertised decompressed sizes before reading blobs; hostile packs/deltas additionally require an enforced process memory boundary for object decoding. Reuse a reviewed isolated Git helper with explicit image provisioning if the host cannot enforce that boundary. Source-object decoding is not permitted to ship with only a compressed-byte cap and timeout; this dependency must be resolved before exposing selected-commit imports.

For working-copy import, capture admitted current bytes plus source HEAD/ref, index-byte digest and source/root identities before and after the scan. Retry only read-only capture within a small fixed bound; otherwise report source activity and refuse. Preserve the original index and dirty tree by never writing them. For a selected branch import, use the selected committed tree without unrelated working-copy dirt. Record source commit ID and the distinct sanitized Relay baseline digest; do not claim the source index's staging distinctions are reproduced in Relay.

Filters can execute commands during checkout/check-in, and `cat-file --filters` transforms content. That is why source extraction uses raw object reads and materialization stays in Relay file code. See [Git attributes](https://git-scm.com/docs/gitattributes), [Git cat-file](https://git-scm.com/docs/git-cat-file), and [Git config](https://git-scm.com/docs/git-config).

- [ ] Add failing actual-repository cases for ordinary/linked/detached repositories, dirty staged/unstaged/untracked content, branch movement during capture, packed refs, malformed metadata, source symlinks and source-object size limits.
- [ ] Add sentinel hook/filter/fsmonitor/credential/include tests; assert no sentinel executes and no source/config/index/ref bytes change. Test injected inherited `GIT_*`, SSH and pager variables, plus source `includeIf` and worktree-specific configuration.
- [ ] Implement the source reader and private quarantine lifecycle. A crash may leave only an owned prepared quarantine record; it must never expose raw object content through task APIs or backup exports unintentionally.
- [ ] Run `npm.cmd test -- tests/git-source.test.ts tests/tools-new-git.test.ts --maxWorkers=1`. Run native object-decoding resource tests separately after active inference/browser work has stopped. Unsupported decoding infrastructure must produce an unavailable result.

### Task 3: Create real private worktrees and own their lifecycle

Depends on Tasks 1 and 2. Implement `git-worktree-store.ts` and `git-worktrees.ts`; extend `git-process.ts` and storage accounting. Keep control metadata under `git-repositories/<repositoryId>` and `git-operations/<operationId>`, with task files under `worktrees/<worktreeId>/files`. Apply the existing private-directory/ownership helpers on Windows as well as Unix; `mkdir` mode alone is not a Windows ACL guarantee.

Create a fresh private repository with an empty template and only Relay-generated configuration. Import admitted bytes using plumbing/raw blobs. For each task, persist a prepared operation before creating its generated branch and registering an actual linked worktree with `--no-checkout`; populate admitted bytes through `files.ts`. Build its index from the known raw object IDs and modes, avoiding `git add` and checkout filters. Keep metadata outside the files admitted to the sandbox. Recheck the generated `.git` pointer and repository identity before each internal Git command.

The process wrapper must support bounded binary object streams without decoding arbitrary blobs as UTF-8, fixed internal argument builders, explicit full refs/OIDs, and joined cancellation. Disable replacement objects and lazy fetch in addition to the existing scrubbed environment; refuse source-config inheritance. Use compare-and-swap ref updates, never force-reset a branch. Validate raw paths before passing them after `--`, and never interpret a client string as a revision expression.

Persist filesystem and SQL receipts after read-back verification. One shared cleanup promise must own each worktree removal; stop, finalization and restart recovery cannot race separate removals. Before any remove, validate the recorded absolute root and generated registration. Never use global worktree prune or a recursive delete inferred solely from an untrusted `.git` file. Retain dirty/reviewable task content unless an authorized discard explicitly covers it.

- [ ] Add `tests/git-worktrees.test.ts` red cases: two real linked worktrees have separate indexes/refs/files; changing one cannot change its sibling or source; generated control metadata cannot be overwritten through file/terminal tools.
- [ ] Add `tests/git-worktree-recovery.test.ts` fault injection before and after registration, content materialization, ref update, journal write and cleanup. Verify stop joins processes and records ambiguous effects instead of replaying them.
- [ ] Implement allocation, read-back verification, recoverable discard and bounded recovery enumeration. Add `git-repositories`, `worktrees`, quarantine and operation journals to storage accounting before allocating them.
- [ ] Run both focused test files plus `tests/storage-budget.test.ts` and `tests/tools-new-git.test.ts`; retain actual Git versions and platform results. No successful fake-process test substitutes for native registration/removal evidence.

### Task 4: Bind every task caller to the same worktree

Depends on Task 3. Implement `resolveTaskFiles` and wire `ToolBroker.execute`, terminal export/checkpoint commit, `diffs`, `revert`, task verification and engine lifecycle to it. `ToolContext` receives only a server-resolved worktree binding, if needed; model tool arguments do not choose one. Manual project editing continues to use the canonical managed-project root, while worktree inspection/edit endpoints require an explicit authorized worktree ID.

Allocate once from the pinned managed baseline when an authorized writable task starts, before its first workspace tool or model context requiring files. Resume must reuse the same durable binding and base. Read-only tasks may use a pinned read-only view; they cannot acquire a writable branch through a tool proposal. Allocation authorization includes durable task owner, live session version, workspace scope, access, stop generation and deadline after waiting and immediately before effects. The callback must not reenter the broker queue or the outer SQL connection from a transaction.

Keep the existing workspace scheduling exclusion initially. Add repository/worktree operation reservations for shared refs and maintenance, but do not remove `Engine.drain`'s workspace exclusion as incidental cleanup. Define lock order: engine maintenance reservation, broker serialization, repository operation; do not await queue entry recursively while already holding it. A future D04 scheduler change needs separate concurrency acceptance.

Extend checkpoints with the resolved worktree/base identity. A legacy checkpoint targets only the legacy managed root. Verify and invalidate command evidence by worktree identity and final tree hash, so a pass from a sibling branch or an earlier tree cannot satisfy completion. A completed task with an unintegrated branch is completed task execution, not completed project integration or publication.

- [ ] Add failing cases in `tests/git-worktree-authorization.test.ts` for revoked session/account/workspace grant/deadline while allocation is queued and at the last mutation boundary; require retained partial-operation evidence when an effect already occurred.
- [ ] Add tests that file reads, writes, terminal snapshots, `git_diff`, final verification and checkpoint restoration all address the same bound tree; a wrong-worktree checkpoint and stale/sibling test receipt must be rejected.
- [ ] Implement dispatch and lifecycle changes, including startup reconciliation before scheduling and joined shutdown. A missing/mismatched binding pauses the task; it never falls back to canonical files.
- [ ] Run the new authorization/recovery cases plus `tests/tool-authorization.test.ts`, `tests/workspace-safety.test.ts`, `tests/task-deadline.test.ts` and `tests/engine-scheduling.test.ts` with one worker. Verify manual edits and legacy snapshot tasks retain their existing behavior.

### Task 5: Review branch changes and integrate into the managed project

Depends on Task 4. Implement `git-integration.ts` and branch-aware `ManagedGit.inspect`. Keep old snapshot result semantics for old workspaces. New results identify source provenance, Relay branch, base/current commit and tree digests, omissions, truncation and whether tests concern the exact reviewed tree.

Build an immutable three-way preview from the task's base, current canonical managed tree and task tree. For each path, accept unchanged destination or identical resulting changes; report divergent edits and delete/modify conflicts explicitly. Initial integration may conservatively conflict on any same-file divergence rather than invoke repository merge drivers. Additions with colliding normalized paths must conflict. Do not silently choose one side or resolve conflicts with an unverified model answer.

Preview digests bind actor/session, stop generation, repository/worktree IDs, all three tree identities, selected changes, operation sequence and expiry. Apply reacquires reservations, reauthorizes, checks every expected content/ref identity, records a prepared multi-file checkpoint and verifies the final tree. A later canonical integration or newer task edit invalidates the old preview. Interrupted multi-file integration is uncertain until inspected; old test receipts cannot become evidence for a newly combined tree. Run fresh independent checks before reporting the integrated result as verified.

- [ ] Add `tests/git-worktree-integration.test.ts` failures for disjoint edits, identical edits, divergent same-file edits, additions/deletions, stale previews, branch/ref replacement, case collisions and cancellation after one write.
- [ ] Implement preview/apply without automatic source publication, staging, merge, checkout or push. Preserve the task branch for review and recovery after integration.
- [ ] Run the focused integration tests and existing checkpoint/workspace safety tests; assert unrelated canonical files and the complete original source state stay unchanged.
- [ ] Review this checkpoint before exposing integration in the UI.

### Task 6: Expose authenticated project/worktree review and bridge publication

Depends on Task 5. Add dedicated routes in `server/api/git-worktrees.ts`, registered from `app.ts`. Use the existing principal, session, `authorizeWorkspace`, CSRF, origin and local-owner checks. Source discovery and import remain local-owner-only; invited accounts may inspect/use only granted managed worktrees and never learn ungranted host paths or source refs. Do not derive permission from ownership in a JSON file alone.

Proposed route families are owner-only source preview/import, `/api/workspaces/:id/git` for authorized summaries, `/api/worktrees/:id/files` for the selected tree, `/api/worktrees/:id/integration-preview`, and exact preview apply/discard operations. Bodies are strict and use opaque IDs/digests. Preserve the current workspace creation/upload routes for snapshots and browser DeviceFolder imports. Browser directory handles do not authorize host Git metadata access; those imports remain honestly labeled snapshots.

Projects must distinguish original source branch, private Relay branch and imported dirty baseline. Display omitted content and unsupported modes, keep error/retry and uncertainty states visible, and guard dirty editors when changing trees. Show task changes relative to the imported task baseline, not all pre-existing user dirt. Preserve keyboard focus, short-height review controls, and exact-action confirmation on integration/discard.

C03 publication must remain a separate local-owner operation after integration. Existing v1/v2 journal digests cannot acquire new fields retroactively. Introduce a new version only when Git source identity is bound into publication preview/apply: source root, current branch/HEAD, source index digest, expected file identities and sequence must still match. If Git-aware publication is not implemented in the same increment, explicitly refuse publication for Git workspaces; never fall through to content-only publication while implying branch protection. Source staging/commit/push and new-directory publication remain separate capabilities requiring their own reviewed contracts.

- [ ] Add API tests for cross-account IDs, revoked sessions, stale previews, owner/remote distinction, and no source-path leakage. Reuse real paired sessions.
- [ ] Add `tests/e2e/git-worktrees.spec.ts` for source versus Relay labels, branch selection, dirty-editor guard, conflict review, cancelled operations, focus restoration and unavailable publication. Test at 320px, desktop and short landscape in both themes.
- [ ] Extend publication tests for Git HEAD/index changes even when affected file content is unchanged; preserve all legacy v1/v2 and presence/identity tests. Only enable the bridge after these pass.
- [ ] Build once before browser tests and wait for the currently active fixture to finish. Never rebuild `dist` during a suite or start another fixture on port 4319.

### Task 7: Recovery, backup and native acceptance

Depends on all prior tasks; remains necessary even if UI work ships later. Include Git repositories, worktree files, operation journals, refs and branch/checkpoint mappings in storage inventory and stopped backup/restore. Source quarantine must be absent or explicitly quarantined before backup; it can contain unadmitted historical data. Keep unresolved worktrees and uncertain operations out of automatic retention deletion.

Linked Git worktrees record filesystem locations. A restored directory can therefore contain stale absolute pointers. Restore must leave scheduling stopped, validate all identities, and repair only recorded owned links inside the new data root under an explicit recovery operation. Never follow a restored pointer back into the old live data directory. Native PostgreSQL and embedded backups must capture SQL and filesystem records from the same quiesced state.

- [ ] Add restart tests that reopen actual persisted repositories and SQL records, preserve reviewable branches, refuse orphan/mismatched refs, and require inspection of prepared/uncertain effects. Inject disk-full, missing Git, subprocess timeout and removal failure.
- [ ] Add restore tests into a different absolute directory; prove no read/write/delete crosses into the original host data or source repository. Test unrelated directories and unowned worktree registrations survive cleanup.
- [ ] Create `scripts/git-worktree-acceptance.ts` using only disposable sibling sources and private data. Seed real source commits with branches, tracked staged and unstaged edits, untracked and ignored files, secrets, hooks and filters. Hash source contents, index, refs and relevant metadata before and after the full run.
- [ ] Run two task worktrees from one baseline, make distinct edits through the broker, run actual sandbox checks, review disjoint integration, reject a real conflict, restart, cancel and discard one worktree, and verify the remaining tree and source. If C03 is enabled, perform exact publication and rollback while preserving unrelated user changes. Actual inference is a later separate acceptance; deterministic provider output must be labeled accordingly.
- [ ] Run focused tests, strict types/full tests, production build, browser cases, then native Git acceptance sequentially with no competing inference. Record actual Windows, Linux and macOS results separately; do not infer native platform acceptance from portable TypeScript tests. Extend hosted workflows only after local evidence and source review.
- [ ] Update the ledger, architecture decisions, user documentation and validation evidence with exact supported source layouts, size/mode limits and retained failures. Mark C02 complete only for the accepted scope, and keep C01/C03/D04 dependencies open where their outcomes have not been demonstrated.

## Acceptance and handoff

The decisive evidence is an actual private linked-worktree lifecycle with verified isolation, unchanged dirty source, inert malicious Git settings, correct task/root binding, exact reviewed integration, revocation/cancellation handling and recoverable restart/restore. A diagram, a generated branch name, a synthetic `diff-tree` result, or a successful `git worktree add` alone is insufficient.

This plan authorizes no deployment by itself. The immediate implementation checkpoint is Step A's managed-snapshot worktree helper and real Git tests, followed by independent review and Step B's explicit workspace fork API. Task 2's source-object decoding resource boundary is a prerequisite for later source-commit import, not for managed-only forks. No existing snapshot behavior should be relabeled as full source-aware C02 support while the remaining tasks are open.
