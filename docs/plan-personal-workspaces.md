# Personal files and agent autonomy

The existing attachment button requires write permission to an owner-granted workspace. That incorrectly couples a user's intentional upload to the agent's computer-control ceiling. The requested change gives each approved user their own managed file space and independent choice of agent autonomy there.

## Boundaries

- Personal workspaces live on the Relay host. Uploading copies a selected text file; it does not grant access to the uploading device's filesystem.
- Ownership comes from the authenticated server principal and is immutable. A client-supplied owner ID or host source path cannot create authority.
- Users may create bounded empty personal workspaces, inspect, upload, download, edit and delete their own supported text files. Manual file operations are separate from agent approval mode.
- Read only, Supervised and Autonomous workspace apply to agents within the selected personal workspace. They do not widen host-folder, network, provider, MCP or spending permissions. Unrestricted host-file access remains a local-owner capability.
- Shared, host-managed workspaces retain their existing owner grants and access ceilings. Another user's personal workspace cannot become accessible by guessing its ID or injecting it into a grant list.
- The host owner administers storage and accounts; privacy between Relay users is not encryption against the machine owner.
- Existing file/path/link protections, mutation serialization, storage admission and emergency stop remain active. Manual edits/deletes require an observed content hash; conflicting changes are rejected.

## Implementation

1. Persist personal ownership in relational and broker workspace metadata without assigning old shared workspaces to arbitrary users.
2. Centralize trusted ownership resolution across HTTP authorization, durable admission, resume and later execution authorization.
3. Add bounded per-user workspace creation and manual text-file operations with audit records.
4. Enable empty workspace creation and attachments for ordinary accounts; show the storage scope and let users select their own agent autonomy.
5. Test two-user isolation, forged ownership/source paths, stale writes, grants, revocation and task admission. Exercise desktop/phone controls and inspect actual browser screenshots.
6. Build and restart the existing local host after checking active work, then verify the compiled service and document limitations.

The approach follows [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): validate the specific resource on every request rather than treating general feature access as authorization. Device-local browser file access is a separate capability that requires explicit user permission and browser support; see [MDN File System API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API).
