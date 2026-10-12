import type { ActivityEvent } from '../shared/types';

export interface ActivityCursor {scope:string|null;cursor:number}
export function storedActivityCursor(value:string|null):ActivityCursor|null {
  try{const saved=JSON.parse(value??'null') as {scope?:unknown;cursor?:unknown}|null;if(saved&&typeof saved.scope==='string'&&/^[a-f0-9]{64}$/.test(saved.scope)&&typeof saved.cursor==='number'&&Number.isSafeInteger(saved.cursor)&&saved.cursor>=0)return {scope:saved.scope,cursor:saved.cursor};}catch{/* Invalid browser storage never grants replay continuity. */}
  return null;
}

export function mergeEvents(previous: ActivityEvent[], incoming: ActivityEvent[], limit = 500): ActivityEvent[] {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const event of incoming) events.set(event.id, event);
  return [...events.values()].sort((a, b) => a.id - b.id).slice(-limit);
}

export function mergeText(previous: string, incoming: string, limit = 120_000): string {
  return (previous + incoming).slice(0, limit);
}
