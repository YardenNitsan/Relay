import { describe, expect, it } from 'vitest';
import type { ActivityEvent, Approval, Workspace } from '../shared/types';
import { approvalContext } from './approval';

const approval: Approval = { id: 'approval-a', taskId: 'task-a', toolCallId: 'call-a', tool: 'file_write', arguments: { path: 'notes.txt', content: 'hello', expectedHash: null }, reason: 'This exact mutating action requires task-controller approval', status: 'pending', createdAt: '' };
const event = (id: number, type: string, data: Record<string, unknown>, taskId = 'task-a'): ActivityEvent => ({ id, type, data, taskId, createdAt: '' });
const workspaces: Workspace[] = [{ id: 'task-workspace', name: 'Approved project', sourcePath: null, createdAt: '', fileCount: 0 }, { id: 'other-workspace', name: 'Different project', sourcePath: null, createdAt: '', fileCount: 0 }];

describe('approval identity and scope', () => {
  it('correlates the exact invocation and task, using the persisted task workspace', () => {
    const result = approvalContext(approval, 'task-workspace', workspaces, [
      event(1, 'AGENT_STARTED', { agentId: 'worker-a', role: 'worker', modelId: 'ollama/actual' }),
      event(2, 'AGENT_STARTED', { agentId: 'reviewer-a', role: 'reviewer', modelId: 'openai/other' }),
      event(3, 'TOOL_REQUESTED', { toolCallId: 'call-a', agentId: 'worker-a' }),
      event(4, 'TOOL_REQUESTED', { toolCallId: 'call-a', agentId: 'reviewer-a' }, 'other-task'),
    ]);
    expect(result).toMatchObject({ workspace: 'Approved project', agent: 'Worker', model: 'ollama/actual', action: 'Create notes.txt', reason: approval.reason });
  });
  it('does not invent identity from another agent or a later event', () => {
    const result = approvalContext(approval, 'missing-workspace', workspaces, [
      event(1, 'TOOL_REQUESTED', { toolCallId: 'call-a', agentId: 'missing-agent' }),
      event(2, 'AGENT_STARTED', { agentId: 'missing-agent', role: 'worker', modelId: 'wrong' }),
    ]);
    expect(result.agent).toBe('Agent not recorded');
    expect(result.model).toBe('Model not recorded');
    expect(result.workspace).toBe('Workspace unavailable (missing-workspace)');
  });
  it('identifies cloud context transmission and keeps the controller attribution explicit', () => {
    const cloud = { ...approval, tool: 'cloud_egress', arguments: { provider: 'anthropic', model: 'recorded-model', contextBytes: 2048 } };
    const result = approvalContext(cloud, null, [], []);
    expect(result).toMatchObject({ agent: 'Task controller', model: 'recorded-model', workspace: 'No workspace assigned', action: 'Send context to anthropic' });
    expect(result.risk).toContain('2,048 bytes');
    expect(result.risk).toContain('leaves this host');
  });
  it('attributes a tool proposal to its actual model after fallback, independent of event-array order', () => {
    const result = approvalContext(approval, 'task-workspace', workspaces, [
      event(1, 'AGENT_STARTED', { agentId: 'worker-a', role: 'worker', modelId: 'ollama/failed' }),
      event(5, 'MODEL_REROUTED', { agentId: 'worker-a', from: 'ollama/actual', to: 'ollama/later' }),
      event(4, 'TOOL_REQUESTED', { toolCallId: 'call-a', agentId: 'worker-a' }),
      event(3, 'MODEL_CALL_COMPLETED', { agentId: 'worker-a', modelId: 'ollama/actual' }),
      event(2, 'MODEL_REROUTED', { agentId: 'worker-a', from: 'ollama/failed', to: 'ollama/actual' }),
      event(3, 'MODEL_CALL_COMPLETED', { agentId: 'other-agent', modelId: 'wrong-agent' }),
      event(3, 'MODEL_CALL_COMPLETED', { agentId: 'worker-a', modelId: 'wrong-task' }, 'other-task'),
    ]);
    expect(result).toMatchObject({ agent: 'Worker', model: 'ollama/actual' });
  });
  it('uses recorded rerouting when old history lacks a call-completed event', () => {
    const result = approvalContext(approval, null, [], [
      event(1, 'AGENT_STARTED', { agentId: 'worker-a', role: 'worker', modelId: 'ollama/failed' }),
      event(2, 'MODEL_REROUTED', { agentId: 'worker-a', to: 'ollama/fallback' }),
      event(3, 'TOOL_REQUESTED', { toolCallId: 'call-a', agentId: 'worker-a' }),
    ]);
    expect(result.model).toBe('ollama/fallback');
  });
  it('preserves the exact policy reason for unclassified operations', () => {
    const result = approvalContext({ ...approval, tool: 'new_tool', reason: 'Exact recorded policy explanation.' }, null, [], []);
    expect(result.reason).toBe('Exact recorded policy explanation.');
    expect(result.risk).toBe('Risk not classified. Review the recorded reason and arguments.');
  });
  it('describes personal task storage without implying calendar events or notifications', () => {
    const result = approvalContext({ ...approval, tool: 'personal_tasks', arguments: { action: 'create', title: 'Call the dentist', dueAt: '2026-10-12T09:00:00Z' } }, null, [], []);
    expect(result.workspace).toBe('Your personal task list');
    expect(result.action).toBe('Create personal task: Call the dentist');
    expect(result.risk).toContain('No calendar event or notification');
  });
});
