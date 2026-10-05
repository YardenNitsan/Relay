import { z } from 'zod';
import type { ToolContext, ToolDecision, ToolDefinition, ToolRequest } from '../../shared/types';
import { safePath } from './platform';
import { boundedText } from './files';

const pathSchema = z.string().max(2048).refine(path => { try { safePath(path); return true; } catch { return false; } }, 'Unsafe or protected workspace path');
const rootSchema = z.string().max(2048).refine(path => { try { safePath(path, true); return true; } catch { return false; } }, 'Unsafe or protected workspace path');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const content = z.string().refine(value => { try { boundedText(value); return true; } catch { return false; } }, 'Content exceeds limits or is not text');
export const toolSchemas = {
  file_list: z.object({ path: rootSchema.optional() }).strict(),
  file_read: z.object({ path: pathSchema }).strict(),
  file_search: z.object({ query: z.string().min(1).max(512), path: rootSchema.optional() }).strict(),
  file_write: z.object({ path: pathSchema, content, expectedHash: hash.nullable() }).strict(),
  file_delete: z.object({ path: pathSchema, expectedHash: hash }).strict(),
  terminal: z.object({ argv: z.array(z.string().max(4096).refine(value => !value.includes('\0'))).min(1).max(64), timeoutSeconds: z.number().int().min(1).max(120).optional() }).strict(),
};
export type ToolName = keyof typeof toolSchemas;
const descriptions: Record<ToolName, string> = {
  file_list: 'List permitted files in the managed workspace. Optional relative directory path. Source files remain untouched.',
  file_read: 'Read a UTF-8 text file in the managed workspace. Returns content and SHA-256; use that hash when writing/deleting.',
  file_search: 'Search permitted UTF-8 files for a literal case-insensitive query. Returns bounded matching lines and paths.',
  file_write: 'Create or replace a managed UTF-8 text file with a checkpoint and verified hash. expectedHash:null requires a new file; replacement requires the hash returned by file_read.',
  file_delete: 'Delete a managed file only when its current SHA-256 equals expectedHash. A checkpoint supports safe revert.',
  terminal: 'Execute argv in an offline isolated Linux Docker container against a disposable workspace copy. Requires a preinstalled trusted image. No host-shell fallback. Successful file changes are checkpointed. Timeout 1–120 seconds.',
};
export function definitions(): ToolDefinition[] {
  return Object.entries(toolSchemas).map(([name, schema]) => ({ name, description: descriptions[name as ToolName], parameters: z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown> }));
}
export function parseRequest(request: ToolRequest): { name: ToolName; args: Record<string, unknown> } {
  if (!Object.hasOwn(toolSchemas, request.name)) throw new Error('Unknown tool');
  const name = request.name as ToolName;
  return { name, args: toolSchemas[name].parse(request.arguments) };
}
export function decide(context: ToolContext, request: ToolRequest, stopped: boolean): ToolDecision {
  const risk = request.name === 'terminal' ? 'execute' : ['file_write', 'file_delete'].includes(request.name) ? 'write' : 'read';
  const deny = (reason: string): ToolDecision => ({ decision: 'deny', reason, risk });
  if (stopped) return deny('Emergency stop is active');
  if (context.signal.aborted) return deny('Task was cancelled');
  if (!['read_only', 'supervised', 'workspace'].includes(context.access)) return deny('Unrestricted host autonomy is unavailable');
  if (!context.workspaceId || !z.uuid().safeParse(context.workspaceId).success) return deny('Select an authorized managed workspace');
  if (!context.taskId || !context.agentId || !context.allowedTools.includes(request.name)) return deny('Agent has no capability for this tool');
  try {
    const parsed = parseRequest(request);
    if (parsed.name === 'terminal') {
      const argv = parsed.args.argv as string[];
      if (!argv[0] || argv[0].startsWith('-') || /[\r\n]/.test(argv[0])) return deny('Invalid executable argument');
    }
  } catch { return deny('Invalid tool arguments or unsafe/protected workspace path'); }
  if (risk !== 'read' && context.access === 'read_only') return deny('Read-only access does not permit mutation or command execution');
  if (risk !== 'read' && context.access === 'supervised' && !context.approved) return { decision: 'approval', reason: 'This exact mutating action requires task-controller approval', risk };
  return { decision: 'allow', reason: risk === 'read' ? 'Authorized scoped read capability' : context.access === 'workspace' ? 'Authorized managed-workspace capability' : 'Exact action approved by task controller', risk };
}
