import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, mutation } from '../api';
import { ErrorNotice, Loading } from './ui';
import { useModalDraftGuard } from './modal-guard';

export interface GoogleStatus { configured: boolean; connected: boolean; quotaProject: string | null; origins: string[]; storage: 'os-keyring' | 'none' }
interface GoogleConfiguration { configured: boolean; clientId: string | null; quotaProject: string | null; origins: string[] }

function GoogleSetup() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ['google-application'], queryFn: ({ signal }) => api<GoogleConfiguration>('/admin/google-oauth', { signal }) });
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [project, setProject] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [savedDraft, setSavedDraft] = useState({ clientId: '', project: '', accepted: false });
  useModalDraftGuard({ dirty: secret.length > 0 || clientId !== savedDraft.clientId || project !== savedDraft.project || accepted !== savedDraft.accepted, busy, label: 'Google application settings' });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      await api('/admin/google-oauth', { method: 'PUT', body: { clientId: clientId.trim(), clientSecret: secret, quotaProject: project.trim(), sharedQuotaAccepted: accepted } });
      setSecret(''); setSavedDraft({ clientId, project, accepted }); setSaved(true);
      void Promise.all([client.invalidateQueries({ queryKey: ['google-application'] }), client.invalidateQueries({ queryKey: ['google-connection'] }), client.invalidateQueries({ queryKey: ['models'] })]).catch(() => {});
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <details className="credential-details"><summary>Host owner: configure Google sign-in</summary>
    <p className="hint">Create a Web application OAuth client in your Google Cloud project, enable the Gemini API and configure its consent screen. Users may need Google project access; Google sign-in does not include a consumer Gemini subscription.</p>
    <a className="text-button" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Open Google Cloud credentials</a>
    {config.isPending ? <Loading>Reading Google application settings...</Loading> : config.isError ? <ErrorNotice error={config.error} /> : <>
      {config.data.configured && <p className="hint">Configured project: <code>{config.data.quotaProject}</code>. Replacing these settings requires users to reconnect.</p>}
      <p className="hint">Register these exact authorized redirect URIs in Google Cloud:</p><ul className="google-redirects">{config.data.origins.map(origin => <li key={origin}><code>{origin}/?relay_google=1</code></li>)}</ul>
      <form className="credential-form" aria-label="Google sign-in application" onSubmit={event => { void save(event); }}>
        <label>Google OAuth client ID<input value={clientId} onChange={event => setClientId(event.target.value)} placeholder={config.data.clientId ?? 'Client ID ending in .apps.googleusercontent.com'} required disabled={busy} autoCapitalize="none" spellCheck={false} /></label>
        <label>Google OAuth client secret<input type="password" value={secret} onChange={event => setSecret(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy} minLength={8} maxLength={2048} /></label>
        <label>Google quota project ID<input value={project} onChange={event => setProject(event.target.value)} placeholder={config.data.quotaProject ?? 'your-google-project'} required disabled={busy} autoCapitalize="none" spellCheck={false} /></label>
        <label className="check-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} required disabled={busy} />I understand that connected users share this project's API quota and any billing I enable in Google Cloud.</label>
        <p className="hint">Relay does not enable Google billing. The client secret and each user's refresh credential stay in the host OS vault. This setup does not grant Gmail or Calendar access.</p>
        <button className="button primary" disabled={busy || !accepted} type="submit">{busy ? 'Saving...' : 'Save Google application'}</button>
      </form>
    </>}
    {error != null && <ErrorNotice error={error} />}{saved && <p role="status">Google application saved. Each user can now connect from a registered address.</p>}
  </details>;
}

export default function GoogleConnection({ owner = false }: { owner?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['google-connection'], queryFn: ({ signal }) => api<GoogleStatus>('/providers/gemini/google', { signal }), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [redirect, setRedirect] = useState<string | null>(null);
  useModalDraftGuard({ dirty: false, busy: busy && redirect === null, label: 'Google connection' });
  // The guard's effect cleanup runs before this effect, releasing its own
  // beforeunload listener before the intentional OAuth navigation. Other drafts
  // still retain their independent protections.
  useEffect(() => {
    if (!redirect) return;
    try { window.location.assign(redirect); }
    catch (caught) { setError(caught); }
    finally {
      // A different draft may cancel beforeunload; leave this action retryable.
      setRedirect(null); setBusy(false);
    }
  }, [redirect]);
  const allowedOrigin = query.data?.origins.includes(window.location.origin) === true;
  const start = async () => {
    setBusy(true); setError(null); setMessage('');
    try {
      const response = await mutation<{ url: string }>('/providers/gemini/google/start', { origin: window.location.origin });
      const url = new URL(response.url);
      if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth' || url.username || url.password || url.port) throw new Error('The host returned an invalid Google sign-in address.');
      setRedirect(url.href);
    } catch (caught) { setError(caught); setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setError(null); setMessage('');
    try {
      const result = await api<{ revoked: boolean }>('/providers/gemini/google', { method: 'DELETE' });
      setMessage(result.revoked ? 'Google disconnected from your Relay account.' : 'Relay removed its Google credential. Google-side revocation could not be confirmed; review your Google account permissions.');
      void Promise.all([client.invalidateQueries({ queryKey: ['google-connection'] }), client.invalidateQueries({ queryKey: ['models'] })]).catch(() => {});
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <section className="google-connection" aria-label="Google connection for Gemini"><h4>Connect with Google</h4>
    {query.isPending ? <Loading>Checking Google connection...</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : <>
      <p className="hint">{query.data.connected ? 'Google authorization is saved for your Relay account. Gemini availability is checked separately by the provider.' : 'Use supported Google authorization for Gemini without entering your own API key.'}</p>
      <p className="hint">Requests use the host-configured Google project's quota and any enabled billing. This is API access, separate from a consumer Gemini subscription. Connecting replaces your saved Gemini API key.</p>
      {!query.data.configured ? <p className="notice">The host owner needs to configure a Google OAuth application first.</p> : query.data.connected ? <button className="button" disabled={busy} onClick={() => { void disconnect(); }}>Disconnect Google</button> : allowedOrigin ? <button className="button" disabled={busy} onClick={() => { void start(); }}>{busy ? 'Opening Google...' : 'Continue with Google'}</button> : <p className="notice">Google sign-in is unavailable at this address. Open Relay through the owner's registered public URL; raw LAN IP addresses are not supported.</p>}
    </>}
    {error != null && <ErrorNotice error={error} />}{message && <p role="status">{message}</p>}
    {owner && <GoogleSetup />}
  </section>;
}
