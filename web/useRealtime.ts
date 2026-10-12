import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ActivityEvent } from '../shared/types';
import { mergeEvents, mergeText } from './realtime-state';

interface StreamText { callId: string; text: string }
export function useRealtime(enabled: boolean, reconnectGeneration = 0) {
  const client = useQueryClient();
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>('connecting');
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [text, setText] = useState<Record<string, StreamText>>({});
  const [online,setOnline]=useState(()=>navigator.onLine);
  const [resumeGeneration,setResumeGeneration]=useState(0);
  const flushedCursor = useRef<number | null>(null);

  useEffect(()=>{
    if(!enabled)return;
    setOnline(navigator.onLine);
    const offline=()=>setOnline(false);
    const resume=()=>{
      setOnline(navigator.onLine);
      // Network availability is only a hint. The fresh authenticated stream
      // must actually open before the UI reports a live connection.
      if(navigator.onLine)setResumeGeneration(value=>value+1);
    };
    const visible=()=>{if(document.visibilityState==='visible')resume();};
    window.addEventListener('offline',offline);window.addEventListener('online',resume);
    document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',resume);document.removeEventListener('visibilitychange',visible);};
  },[enabled]);

  useEffect(() => {
    if (!enabled) {
      flushedCursor.current = null;
      setEvents([]); setText({}); setConnection('connecting');
      return;
    }
    if(!online){setConnection('offline');return;}
    setConnection(previous=>previous==='connecting'?'connecting':'reconnecting');
    if (flushedCursor.current === null) {
      let saved = 0;
      try { saved = Number(sessionStorage.getItem('relay:event-cursor:v1') ?? 0); } catch { /* Browser storage may be disabled. */ }
      flushedCursor.current = Number.isSafeInteger(saved) && saved >= 0 ? saved : 0;
    }
    let cursor = flushedCursor.current;
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
      // Resume only after applied batches, even when browser storage is denied.
      // Cleanup discards pending batches so their IDs must remain replayable.
      flushedCursor.current = cursor;
      try { sessionStorage.setItem('relay:event-cursor:v1', String(cursor)); } catch { /* The mounted hook retains its flushed cursor. */ }
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
      source.onopen=null;source.onerror=null;source.removeEventListener('activity',receive as EventListener);
      source.close();
      if (flushTimer) clearTimeout(flushTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [enabled, client, reconnectGeneration,online,resumeGeneration]);
  return { connection, events, text };
}
