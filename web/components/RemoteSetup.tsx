import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { mutation } from '../api';
import { ErrorNotice } from './ui';

export interface RemoteConfiguration { publicOrigin: string; issuer: string; audience: string; port?: number; registration: 'invited' | 'approval' }
export interface RemoteSetupState { savedConfig?: RemoteConfiguration | null; publicOrigin: string | null; registration?: 'invited' | 'approval'; restartRequired?: boolean; environmentOverride?: boolean }

export default function RemoteSetup({ state }: { state: RemoteSetupState }) {
  const client = useQueryClient();
  const [config, setConfig] = useState<RemoteConfiguration>(() => state.savedConfig ?? { publicOrigin: state.publicOrigin ?? '', issuer: '', audience: '', registration: state.registration ?? 'invited' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const update = (field: keyof RemoteConfiguration, value: string) => { setSaved(false); setConfig(current => ({ ...current, [field]: value })); };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      const result = await mutation<RemoteSetupState>('/admin/remote/config', { publicOrigin: config.publicOrigin.trim(), issuer: config.issuer.trim(), audience: config.audience.trim(), registration: config.registration });
      client.setQueryData(['admin-remote'], result); setSaved(true);
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <form className="remote-config-form" onSubmit={event => { void save(event); }} aria-label="Remote gateway configuration">
    <h3>Save your gateway configuration</h3>
    <p className="hint">Use a stable hostname on a domain you control and a named Cloudflare Tunnel. This saves Relay’s side of the connection; your domain, tunnel and Google sign-in are configured in Cloudflare.</p>
    <div className="options-grid">
      <label>Public Relay URL<input type="url" value={config.publicOrigin} onChange={event => update('publicOrigin', event.target.value)} placeholder="https://relay.example.com" required autoCapitalize="none" spellCheck={false} /></label>
      <label>Cloudflare Access team URL<input type="url" value={config.issuer} onChange={event => update('issuer', event.target.value)} placeholder="https://your-team.cloudflareaccess.com" required autoCapitalize="none" spellCheck={false} /></label>
      <label>Application audience<input value={config.audience} onChange={event => update('audience', event.target.value)} placeholder="Application Audience (AUD) tag" required autoCapitalize="none" spellCheck={false} /></label>
      <label>New accounts<select value={config.registration} onChange={event => update('registration', event.target.value)}><option value="invited">Invited accounts only</option><option value="approval">Request owner approval after sign-in</option></select></label>
    </div>
    <p className="hint">Route the tunnel only to <code>http://127.0.0.1:4318</code>. Keep the owner service on port 4317 private. A stable URL still requires the host and tunnel to stay running.</p>
    <button type="submit" className="button primary" disabled={busy}>{busy ? 'Saving configuration…' : 'Save gateway configuration'}</button>
    {error != null && <ErrorNotice error={error} />}
    {saved && <p className="notice" role="status">Gateway configuration saved. It does not change the active connection until Relay restarts.</p>}
    {state.restartRequired && <div className="notice warning"><strong>Restart required</strong><p>Stop your setup-managed host with <code>setup.cmd --stop</code> on Windows or <code>sh setup.sh --stop</code> on Linux/macOS, then run setup again. For a manually started host, use its terminal or service manager. Return here to enable remote access after checking your tunnel.</p></div>}
    {state.environmentOverride && <p className="notice warning">Launch-time remote environment settings override saved configuration. Update or remove those settings before restarting to use this form’s values.</p>}
  </form>;
}
