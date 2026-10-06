import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityEvent } from '../shared/types';
import { mergeEvents, mergeText } from './realtime-state';

interface StreamText { callId: string; text: string }
export function useRealtime(enabled: boolean, reconnectGeneration = 0) {
  const client = useQueryClient();
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [text, setText] = useState<Record<string, StreamText>>({});

  useEffect(() => {
    if (!enabled) {
      setEvents([]); setText({}); setConnection('connecting');
      return;
    }
    let cursor = 0;
    try { cursor = Number(sessionStorage.getItem('relay:event-cursor:v1') ?? 0); } catch { /* Browser storage may be disabled. */ }
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
    const source = new EventSource(`/api/events?after=${cursor}`, { withCredentials: true });
    let batch: ActivityEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      const fresh = batch; batch = []; flushTimer = undefined;
      setEvents(previous => mergeEvents(previous, fresh));
      setText(previous => {
        const next = { ...previous };
        for (const event of fresh) {
          if (!event.taskId) continue;
          const data = event.data;
          if (event.type === 'MODEL_TEXT' && (data.role === 'worker' || data.role === 'supervisor') && typeof data.text === 'string') {
            const callId = String(data.callId ?? data.stepId ?? event.taskId);
            const old = next[event.taskId];
            next[event.taskId] = { callId, text: mergeText(old?.callId === callId ? old.text : '', data.text) };
          }
          if (['TASK_COMPLETED', 'TASK_FAILED', 'TASK_CANCELLED'].includes(event.type)) delete next[event.taskId];
        }
        // Closed conversations do not retain unlimited streaming buffers.
        const keys = Object.keys(next);
        for (const key of keys.slice(0, Math.max(0, keys.length - 20))) delete next[key];
        return next;
      });
      try { sessionStorage.setItem('relay:event-cursor:v1', String(cursor)); } catch { /* SSE still reconnects using its own ID. */ }
    };
    source.onopen = () => {
      setConnection('live');
      void client.invalidateQueries({ queryKey: ['conversation'] });
      void client.invalidateQueries({ queryKey: ['task'] });
      void client.invalidateQueries({ queryKey: ['status'] });
    };
    source.onerror = () => setConnection('reconnecting');
    const receive = (message: MessageEvent<string>) => {
      let event: ActivityEvent;
      try { event = JSON.parse(message.data) as ActivityEvent; } catch { return; }
      if (!Number.isSafeInteger(event.id) || event.id <= cursor || typeof event.type !== 'string' || !event.data || typeof event.data !== 'object') return;
      cursor = event.id; batch.push(event);
      if (!flushTimer) flushTimer = setTimeout(flush, 80);
      if (event.type !== 'MODEL_TEXT' && !refreshTimer) refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        for (const key of ['conversation', 'conversations', 'task', 'status']) void client.invalidateQueries({ queryKey: [key] });
      }, 400);
    };
    source.addEventListener('activity', receive as EventListener);
    return () => {
      source.close();
      if (flushTimer) clearTimeout(flushTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [enabled, client, reconnectGeneration]);
  return { connection, events, text };
}
