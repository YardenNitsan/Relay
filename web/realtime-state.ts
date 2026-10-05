import type { ActivityEvent } from '../shared/types';

export function mergeEvents(previous: ActivityEvent[], incoming: ActivityEvent[], limit = 500): ActivityEvent[] {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((a, b) => a.id - b.id).slice(-limit);
}

export function mergeText(previous: string, incoming: string, limit = 120_000): string {
  return (previous + incoming).slice(0, limit);
}
