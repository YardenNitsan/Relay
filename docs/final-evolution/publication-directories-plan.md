# Reviewed source-directory publication

**Goal:** Publish admitted text files into explicitly reviewed missing source directories without weakening the existing host boundary.

**Architecture:** Extend the existing owner-only publication journal to version3 only when folder creation is needed. Preserve v1/v2 digests and readers. Bind each missing directory to its existing parent's identity or an earlier planned parent; create one level at a time without recursive mkdir, record its identity immediately, and reauthorize each effect. Existing file publication still owns all file writes. No model tool gains mkdir authority.

**Rollback scope:** Restore files through the existing reviewed workflow. Retain created directories, including any later owner contents. Show this limitation before approval; do not introduce recursive cleanup or delete unreviewed owner files. Interrupted creation retains identities and uncertain receipts; complete-state reconciliation must still verify planned/missing directory boundaries.

**Spec:** Final directive sections7,8,14; C03 in requirements-matrix.md. Router paused; original host untouched; isolated fixture files only during acceptance.

## Steps

- [x] Red tests in publication.test.ts: nested creation preview has no source effect; exact approved publication; file rollback retains folders and later owner files; appeared/replaced parents refuse before writes; revocation after mkdir yields an uncertain receipt; complete-before reconciliation; bounded32directory limit.
- [x] HostFileBroker adds internal planning and exclusive single-directory creation methods. Apply existing protected component/link/alias checks, native identities, authorization and cancellation. No host shell or generic mkdir tool.
- [x] Version3 optional directory plans/identity receipts in shared/publication.ts, validated for unique paths, parent ordering and file-parent correspondence. Existing v1/v2 behavior/digests stay compatible.
- [x] PublicationService previews and revalidates the directory plan, journals before creation and records each created identity before file effects. Never adopt a directory that appeared after review. Fail closed when an expected creation receipt is missing.
- [x] UI shows exact planned folder names and retained-directory rollback scope. Real phone/desktop browser tests publish nested files and roll back them while preserving unrelated source contents.
- [x] Focused negative tests, full strict check/build, browser acceptance, visual inspection, ledger and reviewed commit/push. Continue the rest of A-G afterward.

## Review focus

- An existing directory is replaced, aliased or linked between preview and dispatch.
- Revocation or cancellation arrives after creation but before its receipt is saved.
- A partial directory tree exists after interruption; no automatic adoption/replay.
- Old publication journals retain their exact original digest and recovery behavior.
- Rollback restores file contents while preserving folders and later independent owner work.
