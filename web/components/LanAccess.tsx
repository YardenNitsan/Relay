import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Network } from 'lucide-react';
import { api, mutation } from '../api';
import { ErrorNotice, Loading, shortDate } from './ui';
import {useAccessGuard} from '../features/access/access-operation';

interface LanState { configured: boolean; listening: boolean; origin: string | null; error: string | null }
export function LanStatus() {
  const state = useQuery({ queryKey: ['admin-lan'], queryFn: ({ signal }) => api<LanState>('/admin/lan', { signal }) });
  return <section className="lan-summary" aria-label="Local network access"><div className="section-heading"><h3><Network size={17} />Local network</h3></div>{state.isError&&<ErrorNotice error={state.error} retry={()=>{void state.refetch();}}/>}{state.isPending ? <Loading>Checking local network access…</Loading> : state.data&&<><p>{state.data.listening ? 'The LAN gateway is listening. Open People and inspect an enabled account to invite another browser.' : state.data.configured ? 'LAN is configured but is not listening.' : 'LAN access is not configured. The owner’s local browser works independently.'}</p>{state.data.origin && <code className="lan-origin">{state.data.origin}</code>}{state.data.error && <p className="notice warning">{state.data.error}</p>}<p className="hint">LAN uses a separate HTTPS gateway and a certificate trusted by the other device. Configure it on the host; certificates and private keys are never uploaded through this page. Share an account invitation, never the owner pairing token.</p></>}</section>;
}

export function LanInvitation({ userId, name, disabled }: { userId: string; name: string; disabled: boolean }) {
  const [invitation, setInvitation] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lock=useRef(false);
  useAccessGuard({dirty:false,busy,label:`LAN invitation for ${name}`});
  const create = async () => {
    if (lock.current || disabled) return;
    lock.current=true;setBusy(true); setError(null); setInvitation(null); setCopied(false);
    try { setInvitation(await mutation(`/admin/users/${userId}/lan-invitation`, {})); }
    catch (caught) { setError(caught); }
    finally { lock.current=false;setBusy(false); }
  };
  return <section className="lan-invitation" aria-label={`LAN invitation for ${name}`}><button type="button" className="button" disabled={disabled || busy} onClick={() => { void create(); }}><Network size={16} />{busy ? 'Creating invitation…' : 'Create LAN invitation'}</button><p className="hint">One browser exchange for this account’s existing permissions. It does not grant owner access.</p>{error != null && <ErrorNotice error={error} />}{invitation && <div className="client-token-reveal"><strong>Share privately with {name}</strong><p className="hint">Expires {shortDate(invitation.expiresAt)}. The code is shown once; closing these controls removes it from view.</p><label>LAN invitation code<input type="password" value={invitation.token} readOnly autoComplete="off" onFocus={event => event.currentTarget.select()} /></label><div className="button-row"><button type="button" className="button primary" onClick={() => { if (!navigator.clipboard) { setError(new Error('Clipboard is unavailable. Select the code and copy it manually.')); return; } void navigator.clipboard.writeText(invitation.token).then(() => setCopied(true)).catch(setError); }}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copied' : 'Copy invitation'}</button><button type="button" className="button" onClick={() => setInvitation(null)}>Hide invitation</button></div></div>}</section>;
}
