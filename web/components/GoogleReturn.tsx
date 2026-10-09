import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage, mutation, onSessionInvalidated } from '../api';
import type { GoogleStatus } from './GoogleConnection';

interface ReturnParameters { state: string; code?: string; error?: string }
// Capture before App renders or sends requests. Never put OAuth data in storage,
// a conversation, logs or error copy. Scrub Google's extra query fields as well.
function captureReturn(): ReturnParameters | null {
  const url = new URL(window.location.href);
  if (url.searchParams.get('relay_google') !== '1') return null;
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  url.search = ''; url.hash = '';
  window.history.replaceState({}, '', url.pathname);
  if (state.length > 128 || (code?.length ?? 0) > 4096 || (error?.length ?? 0) > 128) return { state: '', error: 'invalid_response' };
  return { state, ...(error ? { error } : code ? { code } : {}) };
}
let pending = captureReturn();
const returned = pending !== null;
let exchange: Promise<GoogleStatus> | null = null;
onSessionInvalidated(() => { pending = null; exchange = null; });
function complete(): Promise<GoogleStatus> {
  if (!exchange) {
    const input = pending; pending = null;
    exchange = input?.state
      ? mutation<GoogleStatus>('/providers/gemini/google/complete', input)
      : Promise.reject(new Error('Google sign-in was incomplete or the Relay session changed. Start again from Models.'));
  }
  return exchange;
}

export default function GoogleReturn({ onModels }: { onModels: () => void }) {
  const client = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<{ done: boolean; error?: string }>({ done: false });
  useEffect(() => {
    if (!returned) return;
    let active = true;
    // Module promise intentionally survives React StrictMode effect replay, so
    // the single-use authorization state is exchanged exactly once.
    void complete().then(async status => {
      if (!status.connected) throw new Error('Google did not confirm a saved connection. Start again from Models.');
      client.setQueryData(['google-connection'], status);
      await client.invalidateQueries({ queryKey: ['models'] });
      if (active) setResult({ done: true });
    }).catch(error => { if (active) setResult({ done: true, error: errorMessage(error) }); });
    return () => { active = false; };
  }, [client]);
  if (!returned || dismissed) return null;
  return <section className={`notice ${result.error ? 'warning' : ''}`} aria-label="Google sign-in result" role={result.error ? 'alert' : 'status'}>
    <p>{!result.done ? 'Completing your Google authorization...' : result.error ?? 'Google authorization saved for your Relay account. Model availability is checked separately.'}</p>
    {result.done && <div className="button-row"><button className="button" onClick={onModels}>Open models</button><button className="button" onClick={() => setDismissed(true)}>Dismiss</button></div>}
  </section>;
}
