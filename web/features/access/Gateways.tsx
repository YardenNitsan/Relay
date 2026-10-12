import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Check,Copy,Globe} from 'lucide-react';
import {api,downloadText,mutation} from '../../api';
import {ErrorNotice,Loading,Status} from '../../components/ui';
import {LanStatus} from '../../components/LanAccess';
import RemoteSetup from '../../components/RemoteSetup';
import type {BrowserSession,RemoteState} from './access-state';
import {useAccessBusy,useAccessGuard} from './access-operation';
const setup='# Configure an authenticated named Cloudflare Tunnel before enabling.\n# Its only Relay target is http://127.0.0.1:4318.\n# Never expose the local owner port 4317.\nRELAY_REMOTE_ENABLED=1\nRELAY_REMOTE_ORIGIN=https://your-hostname\nRELAY_ACCESS_ISSUER=https://your-team.cloudflareaccess.com\nRELAY_ACCESS_AUDIENCE=your-application-audience\nRELAY_REMOTE_PORT=4318\n';
export function Gateways(){
  const client=useQueryClient(),remote=useQuery({queryKey:['admin-remote'],queryFn:({signal})=>api<RemoteState>('/admin/remote',{signal})});
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[message,setMessage]=useState(''),[copied,setCopied]=useState(false),lock=useRef(false),state=remote.data;
  useAccessGuard({dirty:false,busy,label:'Remote gateway change'});
  const operationBusy=useAccessBusy();
  const toggle=async()=>{if(!state||lock.current||operationBusy)return;lock.current=true;setBusy(true);setError(null);setMessage('');try{
    await client.cancelQueries({queryKey:['admin-remote']});const updated=await mutation<RemoteState>('/admin/remote/enabled',{enabled:!state.enabled});client.setQueryData(['admin-remote'],updated);
    if(!updated.enabled)client.setQueryData<BrowserSession[]>(['admin-sessions'],current=>current?.filter(session=>!session.remote));
    setMessage(updated.enabled?'Remote gateway enabled for authenticated, allowed users.':'Remote access disabled. Remote sessions and tasks were revoked.');
    void Promise.all(['admin-remote','admin-sessions','admin-tasks'].map(key=>client.invalidateQueries({queryKey:[key]}))).catch(()=>undefined);
  }catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}};
  return <div className="access-document"><h3>Gateways to this host</h3><p className="hint">The owner’s local browser, local network gateway and authenticated remote gateway have separate boundaries.</p>{error!=null&&<ErrorNotice error={error}/>} {message&&<p className="notice" role="status">{message}</p>}
    <section className="access-gateway"><div className="split"><h4><Globe size={18}/>Remote gateway</h4>{state&&<Status status={state.enabled?'ready':'offline'}/>}</div>{remote.isError&&<ErrorNotice error={remote.error} retry={()=>{void remote.refetch();}}/>}{!state&&remote.isPending?<Loading>Reading gateway configuration…</Loading>:state&&<>
      <p>{state.enabled?`Gateway configured for ${state.hostName}.`:'Remote access is disabled. Local access works independently.'}</p>
      {state.configured&&state.listening&&<button className={`button ${state.enabled?'danger-button':'primary'}`} disabled={operationBusy} onClick={()=>{void toggle();}}>{state.enabled?'Disable remote access':'Enable remote access'}</button>}
      {state.enabled&&state.publicOrigin&&<div className="gateway-url"><code>{state.publicOrigin}</code><button className="icon-button" aria-label={copied?'Gateway address copied':'Copy gateway address'} onClick={()=>{if(!navigator.clipboard){setError(new Error('Clipboard access is unavailable. Select and copy the gateway address manually.'));return;}void navigator.clipboard.writeText(state.publicOrigin!).then(()=>setCopied(true)).catch(setError);}}>{copied?<Check size={16}/>:<Copy size={16}/>}</button></div>}
      <p className="hint">Authentication: {state.authentication}. {state.registration==='approval'?'Signed-in visitors may request your approval.':'Only explicitly invited accounts may enter.'} A configured address is not proof that your tunnel is reachable.</p>
      <details className="gateway-setup"><summary>{state.enabled?'Inspect setup requirements':'How to enable remote access'}</summary><ol><li>Create a Cloudflare Access self-hosted application for a stable hostname on a domain you control. Add Google as an identity provider and require an explicit Access policy; use MFA or passkeys where supported.</li><li>Create a named tunnel and route only that hostname to <code>http://127.0.0.1:{state.gatewayPort}</code>. Preserve the public Host header and end ingress with a deny rule. Never tunnel the local owner, model runtime, database or Docker ports.</li><li>Set the following environment variables when starting Relay. These placeholders require your own account and domain.</li></ol><pre className="bounded-output">{setup}</pre><button className="text-button" onClick={()=>downloadText('relay-remote.env.example',setup)}>Download configuration example</button><p className="hint">After configuration, add allowed identity-provider emails. Test an authorized user, an uninvited user and revocation before sharing access. Google authenticates the person signing in to Relay. OpenAI, Claude and Gemini APIs still require that user’s own API credentials. Full instructions: <code>docs/remote-access.md</code> in the project.</p><RemoteSetup state={state}/></details>
    </>}</section><LanStatus/>
  </div>;
}
