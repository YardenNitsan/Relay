import type { ActivityEvent, TaskStep } from '../shared/types';

export function taskModelEvidence(taskId: string, events: ActivityEvent[], steps: TaskStep[] = []) {
  const recorded = events.filter(event => event.taskId === taskId).sort((a, b) => a.id - b.id);
  const used = new Set<string>();
  let current: { modelId: string; stage: 'selected' | 'used' } | null = null;
  for (const event of recorded) {
    const id = event.type === 'MODEL_REROUTED' ? event.data.to : event.data.modelId;
    if (typeof id !== 'string' || !id || id.length > 500) continue;
    if (['MODEL_SELECTED', 'MODEL_REROUTED'].includes(event.type)) current = { modelId: id, stage: 'selected' };
    if (['MODEL_CALL_STARTED', 'MODEL_CALL_COMPLETED'].includes(event.type)) {
      used.add(id); current = { modelId: id, stage: 'used' };
    }
  }
  // Older call events can fall outside the bounded event page. Completed agent
  // steps retain the assigned model that produced their recorded output.
  for (const step of steps) if (step.taskId === taskId && step.status === 'completed' && step.modelId) used.add(step.modelId);
  return { current, used: [...used] };
}
