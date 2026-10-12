import {Link2,ShieldCheck} from 'lucide-react';
import type {ClientAccess} from './types';

export function ClientReference({endpoints}:Pick<ClientAccess,'endpoints'>){
  return <aside className="clients-reference" aria-label="Client connection reference"><details open>
    <summary><Link2 size={18} aria-hidden="true"/>API addresses & access</summary>
    <section aria-label="Client API addresses"><h3>Connect to the host</h3><dl>{Object.entries(endpoints).map(([kind,url])=><div key={kind}><dt>{kind==='local'?'On the host':kind==='lan'?'Local network':'Remote gateway'}</dt><dd><code dir="ltr">{url}</code></dd></div>)}</dl><p className="hint">Use the address reachable from your application. A configured remote address does not confirm that its gateway is reachable.</p></section>
    <section><h3><ShieldCheck size={17} aria-hidden="true"/>What a token allows</h3><p>Tokens use your account’s allowed local models and resource limits. They never reveal provider credentials or grant Relay’s workspace tools.</p><p>Your external agent and its tools run on your device; inference runs on this host. Relay does not save external chat content.</p><p className="hint">The gateway supports limited subsets of the OpenAI Responses, Chat Completions and Anthropic Messages APIs. Compatibility with a particular application must be tested.</p></section>
  </details></aside>;
}
