import { useState } from 'react';
import { ArrowRight, Link2, LockKeyhole, RefreshCw } from 'lucide-react';
import { ApiError, pairSession, type SessionInfo } from '../api';
import { ErrorNotice, Loading } from './ui';

export default function Connection({ error, pending, onPaired, onRetry }: { error: unknown; pending: boolean; onPaired: (session: SessionInfo) => void; onRetry: () => void }) {
  const [token, setToken] = useState('');
  const [pairing, setPairing] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const lanRequired = error instanceof ApiError && error.code === 'LAN_PAIRING_REQUIRED';
  const required = lanRequired || error instanceof ApiError && error.code === 'PAIRING_REQUIRED';
  const awaitingApproval = error instanceof ApiError && error.code === 'REMOTE_PENDING';
  const remoteDenied = error instanceof ApiError && error.code === 'REMOTE_DENIED';
  const denied = error instanceof ApiError && [401, 403].includes(error.status) && !required;
  const submit = async () => {
    if (!token.trim() || pairing) return;
    const provided = token.trim();
    setToken(''); setPairing(true); setFailure(null);
    try { onPaired(await pairSession(provided)); }
    catch (caught) { setFailure(caught); }
    finally { setPairing(false); }
  };

  return <main className="connection-page"><div className="connection-brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>relay</span></div><section className="connection-card" aria-labelledby="connection-title">
    <div className="connection-symbol" aria-hidden="true">{required ? <LockKeyhole size={27} /> : <Link2 size={27} />}</div>
    <h1 id="connection-title">{pending ? 'Connecting to Relay' : required ? lanRequired ? 'Join this host' : 'Connect this browser' : awaitingApproval ? 'Waiting for host approval' : remoteDenied ? 'Access is disabled' : denied ? 'Access needs attention' : 'The host is unavailable'}</h1>
    {pending ? <Loading>Checking the host connection…</Loading> : required ? <>
      <p className="connection-intro">{lanRequired ? 'Enter a one-use invitation from the host owner. You receive only the account access they granted; models and tools run on their computer.' : 'Pair once with the local host to open your conversations and control execution.'}</p>
      <form className="pairing-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label htmlFor="pairing-token">{lanRequired ? 'One-use invitation code' : 'One-use pairing token'}</label><input id="pairing-token" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} maxLength={1024} required aria-describedby="pairing-help" disabled={pairing} autoFocus />
        <p id="pairing-help" className="hint">{lanRequired ? 'Ask the owner to create an invitation for your account. Keep the code private and use it before its stated expiry.' : 'Read the token from the protected file created on this computer. It expires after five minutes.'}</p>
        <button className="button primary" type="submit" disabled={!token.trim() || pairing}>{pairing ? 'Pairing browser…' : 'Pair this browser'}<ArrowRight size={17} /></button>
      </form>
      {failure != null && <ErrorNotice error={failure} />}
      {!lanRequired && <details className="pairing-instructions"><summary>Get a pairing token</summary><ol><li>On the host, open the Relay folder. For a portable installation, run <code>node launch.mjs --pair</code>. From source, run <code>npm run pair</code>.</li><li>Open the protected file at the path printed by the command.</li><li>Copy its <code>token</code> value into the field above.</li></ol><p>The token is used only for this exchange. Relay does not save it in browser storage or the address bar.</p></details>}
    </> : <><p className="connection-intro">{awaitingApproval ? 'You are signed in. The host owner needs to approve your account and choose its permissions before you can open Relay.' : remoteDenied ? 'The host owner has disabled or declined access for this account. Contact them before trying again.' : denied ? 'This browser has no authorized session. Open the access link provided by the host owner, or return to the local host.' : 'Check that the Relay service is running, then reconnect. Your saved work remains on the host.'}</p><ErrorNotice error={error} /><button className="button primary" onClick={onRetry}><RefreshCw size={16} />{awaitingApproval ? 'Check approval' : 'Try connecting again'}</button>{awaitingApproval && <p className="hint">Keep this page or return to the same address after the owner approves you. Local models and tools will run on their host.</p>}</>}
    <p className="connection-origin"><LockKeyhole size={13} />{window.location.host}</p>
  </section></main>;
}
