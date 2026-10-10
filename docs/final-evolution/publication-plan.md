# Controlled file publication implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish explicitly reviewed regular-text additions/deletions/renames as well as modifications, with conservative durable recovery.

**Architecture:** Extend the existing protected HostFileBroker and exact owner-only PublicationService. Version 2 journals distinguish absent files from empty files and bind existing parent identities. An internal creation observer records a new exclusive-created file identity before writing bytes; missing evidence after a crash refuses automatic recovery. Version 1 journals retain their exact digest and readable/recoverable behavior.

**Tech stack:** Existing TypeScript/Zod, native Node file handles, PGlite/PostgreSQL, React, Vitest and Playwright; no dependency.

**Spec:** Owner final-evolution directive sections7,11,15C,21; docs/publication.md; docs/final-evolution/architecture-decisions.md FE-010.

## Global constraints

- Local owner UI with exact live session, CSRF route, frozen digest, expiry and stop generation; no model publication tool or shell.
- Keep host/workspace reservations and preflight every file before any source mutation. At most20files/2MiB reviewed text.
- Version1 journals remain accepted without rewriting their approved digests.
- Same-user OS races remain a documented limitation, not a security certification.
- First increment requires existing destination directories. New-directory publication and branch-aware Git integration remain C03/C02 open; never silently create parents or stage/push.
- Renames are explicit reviewed creation plus deletion, not metadata-preserving filesystem moves. Recreated files use protected defaults; old ACLs/executable bits are not restored. Show this consequence before approval.

## Review focus

1. Unrelated same-content replacement at a created path must block rollback: actual inode identity regression.
2. Empty file versus absent file must remain distinct: real create/delete/rollback tests.
3. Crash after creation before writing/checkpoint completion must remain uncertain, with no replay: injected failure at internal creation observer and restarted service.
4. Changed or linked parent must block even when the leaf is absent: parent replacement/link adversarial tests.
5. Old receipts and sequential publish/rollback baselines must preserve historical behavior: version1 fixture digest and new mixed operations.

## Task1 - Journal/state and protected broker contract

Files: shared/publication.ts; server/tools/host-files.ts; tests/publication.test.ts; tests/host-files.test.ts.
Interfaces: HostFileState {hash:string|null,identity:{dev,ino}|null,parentIdentity:{dev,ino}}. HostFileBroker.inspectFile(path,authorize?) validates existing/missing leaf under unchanged host protections. HostFileBroker.execute gains an internal optional creation observer invoked after exclusive open/verified handle and before any write. The observer receives the exact handle identity; it never comes from model arguments.

- [x] Add outcome tests for new file presence and mixed create/delete/rename publication, empty states and rollback; observe old PUBLICATION_EXISTING_ONLY failure.
- [x] Add schema/version1 compatibility and broker creation/cancel guard regressions.
- [x] Extend journal schema to version2 nullable before/after/hash/identity with parent identity and bounded mutable createdIdentities; preserve legacy digest fields.
- [x] Implement broker state inspection and internal creation observer with safe authorization boundaries; do not expose new tool grants.

## Task2 - Publication lifecycle

Files: server/tools/publication.ts; tests/publication.test.ts.
Consumes inspectFile/creation observer. Produces unchanged preview/apply/rollbackPreview/reconcile public APIs supporting file presence.

- [x] Record exact before state and parent; validate all before states before save/apply.
- [x] Apply creation with O_EXCL, deletion through existing hash-checked broker, modification through metadata-preserving handle writer. Persist newly created identity before content writes; authorization callback handles known pre/post identity without accepting arbitrary replacement.
- [x] Verify final hash/presence/identity and keep uncertain status on any interrupted mutation. Never replay uncertain entries.
- [x] Reverse only exact verified after states; use new approval and restrictive recreated-file permissions. Reconciliation only accepts complete original or approved states.
- [x] Sequential baselines delete absent entries instead of replacing them with empty strings; retain prior rollback behavior.
- [x] Run focused publication/host/reservation security tests, fix failures and obtain focused review.

## Task3 - Exact UI and integrated acceptance

Files: web/components/Publication.tsx; tests/e2e/publication.spec.ts; docs/publication.md; final-evolution ledgers.

- [x] Distinguish Add/Delete/Modify and absence from empty text in file selector/diff/exact contents. State rename and recreation metadata consequences and existing-directory limit before consent. No fake Git stage/push controls.
- [x] Add actual browser approval/rollback of new and deleted files, viewport/axe/capture checks; retain conflict test.
- [x] Strict types/full tests/build; affected browser runs sequentially; inspect rendered screenshots.
- [x] Record scope and remaining directories/Git acceptance; commit/push verified increment and continue.

Verification: full1237pass/one skip, build,5browser pass; focused review findings reproduced and fixed. New-directory and Git-aware work remains outside this bounded increment and open in the master matrix.
