# Project file creation and acknowledged edits

Scope: B06/C03. Complete the current Project Workspace with an explicit new-text-file flow, including nested relative paths, and release saved/deleted editors from background list refreshes. Keep original-source publication separate. The owner has authorized implementation; router work stays paused.

Use the existing managed-file PUT with `expectedHash: null`, which refuses collisions and returns the authoritative file hash. The upload endpoint delegates to the same collision check but returns only an acknowledgement. No backend authority or filesystem policy changes are needed.

The New file action opens a focused editor pane on phone and desktop. Show the managed destination, relative path, text contents and create/cancel actions. Preserve draft and in-flight guards across navigation. Empty files are valid. After success, seed the exact document and list caches before background refresh, then open the saved editor. Existing save/delete use the same acknowledgement rule and preserve server conflict errors. Deletion removes the document from the local list only after the server succeeds.

- [x] Browser reds: nested empty creation on phone/desktop, exact-path collision preserves existing contents/draft, dirty navigation guard, held list refresh does not trap successful save/delete/create.
- [x] Implement a small NewProjectFile component and ProjectFiles cache acknowledgements; reuse semantic tokens, editor surfaces and touch/focus behavior.
- [x] Fresh strict production build, affected project/publication browser checks, real UI captures and accessibility checks.
- [x] Record accurate evidence, review and commit/push; continue the non-router backlog.

Not included: binary upload, standalone empty directory creation, source Git history, actual model coding reliability or physical phone certification.
