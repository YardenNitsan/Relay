import { describe, expect, it } from 'vitest';
import type { ActivityEvent, TaskStep } from '../shared/types';
import { taskModelEvidence } from '../web/task-models';

const event = (id: number, type: string, data: Record<string, unknown>, taskId = 'task'): ActivityEvent => ({ id, type, data, taskId, createdAt: new Date(0).toISOString() });
describe('actual task model evidence', () => {
  it('does not label a selected model as executed and follows recorded fallback', () => {
    expect(taskModelEvidence('task', [event(1, 'MODEL_SELECTED', { modelId: 'ollama/a' })])).toEqual({ current: { modelId: 'ollama/a', stage: 'selected' }, used: [] });
    const events = [event(1, 'MODEL_SELECTED', { modelId: 'ollama/a' }), event(2, 'MODEL_CALL_STARTED', { modelId: 'ollama/a' }), event(3, 'MODEL_REROUTED', { from: 'ollama/a', to: 'ollama/b' })];
    expect(taskModelEvidence('task', events)).toEqual({ current: { modelId: 'ollama/b', stage: 'selected' }, used: ['ollama/a'] });
    expect(taskModelEvidence('task', [...events, event(4, 'MODEL_CALL_COMPLETED', { modelId: 'ollama/b' })]).used).toEqual(['ollama/a', 'ollama/b']);
  });
  it('ignores other tasks, model text and unexecuted planned steps', () => {
    const step = { id: 'step', taskId: 'task', role: 'worker', title: 'Worker', dependencies: [], status: 'pending', modelId: 'ollama/unexecuted', output: null } satisfies TaskStep;
    expect(taskModelEvidence('task', [event(1, 'MODEL_TEXT', { modelId: 'untrusted-content' }), event(2, 'MODEL_CALL_STARTED', { modelId: 'other-user' }, 'other')], [step])).toEqual({ current: null, used: [] });
    expect(taskModelEvidence('task', [], [{ ...step, status: 'completed', modelId: 'ollama/persisted' }]).used).toEqual(['ollama/persisted']);
  });
});
