# Projects in Dispatch

Authorized frontend-only presentation increment, 12 October 2026. The selected [Dispatch design](design-decision.md) supplies the plum/neutral semantic palette and IBM Plex typography; this surface uses its explicit list/detail hierarchy with a document-focused editing pane. No new library, API, permission or execution behavior.

## Composition

- Project library: a clear title, factual loaded project count, existing search, compact project rows and separate conversation context. Keep real creation/device-folder actions and honest loading/error/empty states.
- Project detail: recognizable folder identity, wrapping project name, existing ownership/date/branch facts and explicit conversation selection. Existing Files, original-source review and integration actions retain their labels and gates.
- File workbench: compact filename/directory rows, exact full-path accessible names, existing search/count/pagination. The document heading shows edit state without replacing the full path. Keep saved-file download, hash-checked save, guarded delete and Close file controls.
- Phones retain the current project index/detail and file index/editor progression. Preserve the 760px/1050px focus-transfer breakpoints, mounted device-folder state and existing hidden selectors. At short heights protect source-editor space and scroll secondary content.

## Implementation and verification

Own only `ProjectWorkspace.tsx`, `ProjectFiles.tsx`, and `projects.css`. Change presentation markup and scoped styles; retain all hooks, query keys, mutation callbacks, guards, component keys, source serialization and access conditions. Keep action names and full-path headings compatible with existing browser assertions.

Use existing browser coverage for project sizes/themes, drafts, creation, source editing, branches and publication; no mirror tests for decorative changes. Root coordinates strict types/build and the single browser fixture. Suggested files: `projects-studio.spec.ts`, `project-draft.spec.ts`, `project-create-file.spec.ts`, `project-fork.spec.ts`, `project-fork-states.spec.ts`, `code-editor.spec.ts`, `branch-integration.spec.ts`, `publication.spec.ts`, plus device-folder cases. This worker runs no browser fixture or build. Record actual verification separately from intended acceptance.

## Implementation checkpoint

Presentation implemented in the three owned files. Existing data and action logic is unchanged; file rows retain the exact full path as their accessible name and the focused editor heading still contains that path. The dirty/saved/read-only label derives from existing editor state. Project and file navigation keep their original guard calls and responsive selectors.

`git diff --check` passes. Installed esbuild successfully parsed/transformed both changed TSX files in memory; PostCSS parsed the scoped stylesheet. These are syntax checks only, not strict type, rendered geometry or accessibility acceptance. No browser, model workload, build or new dependency was run by this worker. Root must inspect actual desktop/phone captures and run existing behavioral checks before calling this increment verified.

## Integrated checkpoint

Root strict production build and rendered acceptance are recorded in [testing](testing.md): initial core92/94, corrected/supporting111/111, scheduling/initial landscape24/24, and final strict landscape/History/viewport14/14. Actual screenshot review is in [design review](design-review.md). Earlier source-only statements above describe the development checkpoint, not the latest acceptance. Physical-device, deployment and final-head CI remain separate.
