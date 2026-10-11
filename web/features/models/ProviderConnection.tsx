import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Cpu, KeyRound } from 'lucide-react';
import type { ProviderStatus } from '../../../shared/types';
import { api, mutation } from '../../api';
import GoogleConnection, { type GoogleStatus } from '../../components/GoogleConnection';
import { useModalDraftGuard } from '../../components/modal-guard';
import { ErrorNotice, humanize, Loading } from '../../components/ui';

export default function ProviderConnection({ provider, owner = false }: { provider: ProviderStatus; owner?: boolean }) {
  const client = useQueryClient();
  const google = useQuery({ queryKey: ['google-connection'], queryFn: ({ signal }) => api<GoogleStatus>('/providers/gemini/google', { signal }), enabled: provider.id === 'gemini', retry: false });
  const [key, setKey] = useState('');
  const [persist, setPersist] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const cloud = !['ollama', 'lmstudio'].includes(provider.id);
  useModalDraftGuard({ dirty: key.length > 0, busy, label: `${provider.name} credential` });
  const perform = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setMessage('');
    try {
      await action(); setMessage(success);
      // A successful provider mutation is acknowledged independently of discovery latency.
      void client.invalidateQueries({ queryKey: ['models'] }).catch(() => {});
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await perform(async () => {
      const response = await mutation<{ saved: boolean; storage: string }>(`/providers/${provider.id}/key`, { key, persist });
      setKey(''); return response;
    }, persist ? 'Your credential was saved for your Relay account in the host secret store.' : 'Your credential is available to your Relay account until the host service restarts.');
  };
  return <article className="provider-row" aria-label={`${provider.name} connection`}>
    <div className="split"><div className="provider-name">{cloud ? <Cloud size={18} aria-hidden="true" /> : <Cpu size={18} aria-hidden="true" />}<strong>{provider.name}</strong><span aria-hidden="true" className={`connection-dot ${provider.connected ? 'connected' : ''}`} /></div><span className="muted">{provider.state ? humanize(provider.state) : provider.connected ? 'Connected' : provider.configured ? 'Unavailable' : 'Not configured'}</span></div>
    {provider.error && <p className="provider-error">{provider.error}</p>}
    {provider.id === 'lmstudio' && <p className="hint">Relay starts an installed LM Studio service in the background when the host starts. Install llmster once to run without the desktop app. Refresh to discover new downloads; embedding models are excluded from chat. Hardware fit is checked before loading, and Relay releases its own model instance after each call.</p>}
    <div className="provider-actions"><label className="check-label"><input type="checkbox" checked={provider.enabled !== false} disabled={busy} onChange={event => { void perform(() => mutation(`/providers/${provider.id}/enabled`, { enabled: event.target.checked }), 'Provider preference updated.'); }} />Enabled</label><button className="text-button" disabled={busy} onClick={() => { void perform(() => mutation(`/providers/${provider.id}/verify`), 'Connection check completed.'); }}>Check connection</button>{provider.secretStorage && <span className="muted">Storage: {provider.secretStorage}</span>}</div>
    {provider.id === 'gemini' && <GoogleConnection owner={owner} />}
    {provider.id === 'gemini' && google.data?.connected && <p className="hint">Disconnect Google before switching this account back to an API key.</p>}
    {cloud && !(provider.id === 'gemini' && google.data?.connected) && <details className="credential-details"><summary><KeyRound size={16} aria-hidden="true" />{provider.configured ? 'Update credential' : 'Connect provider'}</summary><form onSubmit={event => { void save(event); }} className="credential-form"><label>API key<input type="password" value={key} onChange={event => setKey(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste your provider API key" required disabled={busy} /></label><label className="check-label"><input type="checkbox" checked={persist} onChange={event => setPersist(event.target.checked)} disabled={busy} />Save for your Relay account in the host’s secret store</label><p className="hint">The host uses your credential on your behalf. Other Relay accounts cannot use it. Connecting a provider does not authorize sharing task content.</p><div className="button-row"><button type="submit" className="button primary" disabled={busy || !key.trim()}>Save credential</button>{provider.configured && <button type="button" className="button subtle" disabled={busy} onClick={() => { void perform(() => api(`/providers/${provider.id}/key`, { method: 'DELETE' }), 'Your stored credential was removed.'); }}>Remove credential</button>}</div></form></details>}
    {busy && <Loading>Updating provider…</Loading>}{error != null && <ErrorNotice error={error} />}{message && <p className="success-text" role="status">{message}</p>}
  </article>;
}
