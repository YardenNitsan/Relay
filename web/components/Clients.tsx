import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Plus, Unplug } from 'lucide-react';
import { api, mutation } from '../api';
import { Empty, ErrorNotice, Loading, shortDate } from './ui';

interface ClientToken { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt: string | null }
interface ClientAccess { enabled: boolean; tokens: ClientToken[]; endpoints: { local: string; lan?: string; remote?: string } }
interface IssuedToken { id: string; token: string; expiresAt: string }

export default function Clients({ permitted }: { permitted: boolean }) {
  const client = useQueryClient();
  const access = useQuery({ queryKey: ['inference-tokens'], queryFn: ({ signal }) => api<ClientAccess>('/inference/tokens', { signal }), enabled: permitted });
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(30);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const create = async () => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(''); setIssued(null); setCopied(false);
    try { const token = await mutation<IssuedToken>('/inference/tokens', { label: label.trim(), expiresInDays: days }); setIssued(token); setLabel(''); await client.invalidateQueries({ queryKey: ['inference-tokens'] }); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setError(null); setMessage('');
    try { await api(`/inference/tokens/${id}`, { method: 'DELETE' }); if (issued?.id === id) setIssued(null); setMessage('Client token revoked.'); await client.invalidateQueries({ queryKey: ['inference-tokens'] }); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  if (!permitted) return <Empty title="External client access needs a grant">The host owner must enable external model access for your account. A browser session does not grant API access to other applications.</Empty>;
  return <div className="clients-panel"><p className="panel-intro">Connect a compatible application to Relay’s model gateway. Tokens use your account’s allowed local models and resource limits; they never reveal provider credentials.</p><p>Your external agent and its tools run on your device; inference runs on this host. Relay does not save external chat content.</p><p className="hint">The gateway supports limited subsets of the OpenAI Responses, Chat Completions and Anthropic Messages APIs. It does not give another application Relay’s workspace tools or unrestricted computer access. Compatibility with a particular coding agent or CLI must be tested.</p>
    {error != null && <ErrorNotice error={error} />}{message && <p role="status" className="notice">{message}</p>}
    {access.isPending ? <Loading>Checking client access…</Loading> : access.isError ? <><ErrorNotice error={access.error} /><button className="button" onClick={() => { void access.refetch(); }}>Retry client access</button></> : access.data && <>
      {!access.data.enabled && <p className="notice warning">External inference is disabled for this account. Existing tokens can be revoked below.</p>}
      <section className="client-endpoints" aria-label="Client API addresses"><h3>API addresses</h3>{Object.entries(access.data.endpoints).map(([kind, url]) => <div key={kind}><span>{kind === 'local' ? 'On the host' : kind === 'lan' ? 'Local network' : 'Remote gateway'}</span><code>{url}</code></div>)}<p className="hint">Use the address reachable from your application. A configured remote address does not confirm that its gateway is reachable.</p></section>
      {issued && <section className="client-token-reveal" aria-label="New client token"><h3><KeyRound size={17} />Save this token now</h3><p className="hint">It appears once and expires {shortDate(issued.expiresAt)}. Closing this panel removes it from view. Keep it in your client’s credential storage.</p><label>New API token<input value={issued.token} readOnly type="password" autoComplete="off" onFocus={event => event.currentTarget.select()} /></label><div className="button-row"><button className="button primary" onClick={() => { if (!navigator.clipboard) { setError(new Error('Clipboard access requires a secure browser connection. Select the token field and copy it manually.')); return; } void navigator.clipboard.writeText(issued.token).then(() => setCopied(true)).catch(setError); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy token'}</button><button className="button" onClick={() => setIssued(null)}>Done, hide token</button></div></section>}
      <form className="client-token-form" aria-label="Create client token" onSubmit={event => { event.preventDefault(); void create(); }}><div className="options-grid"><label>Application label<input value={label} onChange={event => setLabel(event.target.value)} placeholder="My coding client" maxLength={80} required disabled={busy || !access.data.enabled} /></label><label>Expires in days<input type="number" min={1} max={90} step={1} value={days} onChange={event => setDays(Number(event.target.value))} required disabled={busy || !access.data.enabled} /></label></div><button className="button primary" type="submit" disabled={busy || !label.trim() || !access.data.enabled}><Plus size={16} />{busy ? 'Updating tokens…' : 'Create token'}</button></form>
      <div className="section-heading"><h3>Your client tokens</h3><span>{access.data.tokens.length}</span></div>{access.data.tokens.length ? <div className="client-token-list">{access.data.tokens.map(token => <article key={token.id} aria-label={`${token.label} token`}><div><strong>{token.label}</strong><p>Expires {shortDate(token.expiresAt)}</p><small>{token.lastUsedAt ? `Last used ${shortDate(token.lastUsedAt)}` : 'Not used yet'}</small></div><button className="button subtle" disabled={busy} aria-label={`Revoke ${token.label} token`} onClick={() => { void revoke(token.id); }}><Unplug size={15} />Revoke</button></article>)}</div> : <Empty title="No client tokens">Create a separate token for each application so you can revoke it independently.</Empty>}
    </>}
  </div>;
}
