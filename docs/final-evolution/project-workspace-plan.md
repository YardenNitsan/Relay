# Studio Project Workspace implementation plan

Owner directive B06/sections15C,16,20. Execute inline using the already selected Studio direction and researched design principles. This increment replaces the workspace presentation while preserving all existing file/import/device-folder/publication contracts. It does not pretend unfinished Git worktrees, project indexing or test discovery are available.

## Product decisions

- Open Projects as a spacious document surface with a compact project index, explicit execution/storage location, and a selected project inspector. Desktop uses separate index/inspector regions; compact windows show one focused region with a clear back action. Keep the native modal focus boundary for this increment; a whole navigation/router rewrite is unnecessary.
- Inspecting a project and selecting it for the conversation are distinct actions. Show the current conversation workspace explicitly, including No workspace. Preserve personal/shared permissions, host-owned source information and original-copy semantics.
- Separate files, original-source review and browser folder connection with contextual navigation and headings. A project file search filters actual paths; the interface remains bounded for thousands of entries. Preserve the existing pagination until measurement justifies virtualization.
- File content, save/conflict status and consequential delete/discard controls get a stable editor footer. Publication keeps exact frozen reviews and rollback; no fake checkpoints or Git controls.
- Closing the project surface, changing project/file or hiding the editor must not silently discard a dirty draft. Retain a close guard through Escape, backdrop and header close, plus accessible explicit discard confirmation. Do not store another user's private file text in shared browser storage. In-flight mutations cannot be dismissed ambiguously.

## Ordered work and evidence

1. Reproduce dirty-file loss through the outer modal and identify all unmount paths. Add a real browser regression before the fix; preserve expected-hash conflict behavior and account ownership checks.
2. Extract project API/types, file browser/editor and project creation into understandable feature modules. Retain the lazy entry point and existing server endpoints. Add feature-owned token-based CSS, not more unrelated global rules.
3. Implement index/inspector composition, search, explicit conversation selection and progressive project creation/import. Maintain source-path ownership and browser-device distinctions. Preserve accessible names where they remain appropriate; update tests only when verified product interaction changes.
4. Integrate exact original publication and DeviceFolder flows in coherent dedicated views. Recheck all existing creation, download/edit/delete, import/writeback/conflict/rollback and shared-account cases.
5. Render realistic populated/empty/loading/error/long-path states at320,390,768,1024,1440 and2560 plus short landscape. Inspect actual light/dark captures, keyboard/focus, axe and overflow. Capture before/after evidence; fix weaknesses found.
6. Run strict types, relevant unit/security checks, production build and affected browser suites. Update B06 as partial until all requested project workflows have real acceptance; no invented backend functionality.

Dependencies: current API contracts are sufficient for this presentation increment. Git worktrees, branch-aware review, new-directory publication, full project memory and richer test history remain C/D/F work and must be labeled unavailable rather than shown as functioning controls.
