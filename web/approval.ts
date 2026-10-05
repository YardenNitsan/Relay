import type { ActivityEvent, Approval, Workspace } from '../shared/types';

const recordedText = (value: unknown): string | null => typeof value === 'string' && value.length > 0 ? value : null;

/** Summaries are deterministic UI copy; only the backend can authorize execution. */
export function approvalContext(approval: Approval, workspaceId: string | null, workspaces: Workspace[], events: ActivityEvent[]) {
  const taskEvents = events.filter(event => event.taskId === approval.taskId);
  const request = taskEvents.find(event => event.type === 'TOOL_REQUESTED' && event.data.toolCallId === approval.toolCallId);
  const agentId = recordedText(request?.data.agentId);
  const started = agentId && taskEvents.find(event => event.type === 'AGENT_STARTED' && event.data.agentId === agentId && event.id < request!.id);
  const role = started && recordedText(started.data.role);
  const cloud = approval.tool === 'cloud_egress';
  const agent = role ? role.charAt(0).toUpperCase() + role.slice(1).replaceAll('_', ' ') : cloud ? 'Task controller' : 'Agent not recorded';
  const model = (started && recordedText(started.data.modelId)) || (cloud && recordedText(approval.arguments.model)) || 'Model not recorded';
  const workspace = workspaceId === null ? 'No workspace assigned' : workspaces.find(item => item.id === workspaceId)?.name ?? `Workspace unavailable (${workspaceId})`;
  const path = recordedText(approval.arguments.path);
  let action = `Requested tool: ${approval.tool}`;
  let risk = 'Risk not classified. Review the recorded reason and arguments.';

  if (approval.tool === 'file_write' && path) {
    action = `${approval.arguments.expectedHash === null ? 'Create' : 'Write'} ${path}`;
    risk = 'Changes a file in the managed workspace. Existing content is checked before writing.';
  } else if (approval.tool === 'file_delete' && path) {
    action = `Delete ${path}`;
    risk = 'Removes a file from the managed workspace. Existing content is checked before deletion.';
  } else if (approval.tool === 'terminal' && Array.isArray(approval.arguments.argv) && approval.arguments.argv.every(value => typeof value === 'string')) {
    action = `Run ${JSON.stringify(approval.arguments.argv)}`;
    risk = 'Runs a process that may modify workspace files. Execution still requires the verified isolation boundary.';
  } else if (cloud) {
    action = `Send context to ${recordedText(approval.arguments.provider) ?? 'the selected provider'}`;
    const bytes = approval.arguments.contextBytes;
    const size = typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? ` (${bytes.toLocaleString('en-US')} bytes)` : '';
    risk = `Selected model context${size} leaves this host. It may contain conversation and workspace content. Provider retention terms apply.`;
  }

  return { workspace, agent, model, action, risk, reason: approval.reason };
}
