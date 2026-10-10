import { z } from 'zod';

/** Relay branch provenance. This does not identify the original repository's HEAD. */
export const workspaceGitSchema = z.object({
  repositoryId: z.uuid(),
  parentWorkspaceId: z.uuid(),
  branch: z.string().regex(/^relay\/[0-9a-f-]{36}$/),
  baseCommit: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();
export type WorkspaceGit = z.infer<typeof workspaceGitSchema>;
