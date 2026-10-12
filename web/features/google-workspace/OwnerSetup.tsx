import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';
import type {Configuration,WorkspaceStatus} from './types';

export function OwnerSetup(){
  const client=useQueryClient(),configuration=useQuery({queryKey:['google-workspace-application'],queryFn:({signal})=>api<Configuration>('/admin/google-workspace',{signal}),retry:false});
  const [clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<unknown>(null);
  const lock=useRef(false);
  useModalDraftGuard({dirty:Boolean(clientId||secret||accepted),busy,label:'Google Workspace application'});
  const save=async(event:React.FormEvent)=>{
    event.preventDefault();if(!accepted||lock.current)return;
    lock.current=true;setBusy(true);setError(null);setSaved(false);
    try{
      await Promise.all([client.cancelQueries({queryKey:['google-workspace-application']}),client.cancelQueries({queryKey:['google-workspace']})]);
      const result=await api<Configuration>('/admin/google-workspace',{method:'PUT',body:{clientId:clientId.trim(),clientSecret:secret,separateProjectAccepted:true}});
      client.setQueryData(['google-workspace-application'],result);
      // Replacing the application invalidates the existing account grants.
      client.setQueryData<WorkspaceStatus>(['google-workspace'],previous=>previous?{...previous,configured:result.configured,connected:false,storage:'none'}:undefined);
      setClientId('');setSecret('');setAccepted(false);setSaved(true);
      void client.invalidateQueries({queryKey:['google-workspace-application']});
      void client.invalidateQueries({queryKey:['google-workspace']});
    }catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}
  };
  const changed=()=>{setAccepted(false);setSaved(false);};
  return <section className="google-studio-owner google-studio-scroll" aria-label="Owner Google Workspace setup">
    <header><h3>Host application setup</h3><p>Configure the OAuth application for this host. Each person still connects their own Google account.</p></header>
    <p>Create a Web application OAuth client in a <strong>separate Google Cloud project from Gemini</strong>. Enable the Gmail and Google Calendar APIs and configure the consent screen. Google may require app verification or approved test users.</p>
    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Open Google Cloud credentials</a>
    {configuration.isPending&&<Loading>Reading application settings…</Loading>}
    {configuration.isError&&<ErrorNotice error={configuration.error} retry={()=>{void configuration.refetch();}}/>}
    {configuration.data&&<>
      <p className="hint">Register these exact authorized redirect URIs:</p><ul className="google-studio-redirects">{configuration.data.origins.map(origin=><li key={origin}><code>{origin}/?relay_workspace=1</code></li>)}</ul>
      {configuration.data.configured&&<p className="google-studio-warning">An application is configured. Replacing it requires every account to reconnect.</p>}
      <form className="google-studio-form" aria-label="Workspace OAuth application" onSubmit={event=>{void save(event);}}>
        <label>Workspace OAuth client ID<input value={clientId} onChange={event=>{setClientId(event.target.value);changed();}} placeholder={configuration.data.clientId??'Client ID ending in .apps.googleusercontent.com'} autoCapitalize="none" spellCheck={false} maxLength={300} required disabled={busy}/></label>
        <label>Workspace OAuth client secret<input type="password" value={secret} onChange={event=>{setSecret(event.target.value);changed();}} autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={8} maxLength={2048} required disabled={busy}/></label>
        <label className="check-label"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)} disabled={busy}/>This OAuth client belongs to a separate Google Cloud project from Gemini.</label>
        <p className="hint">Relay checks that the client differs from Gemini, but cannot verify which project owns it. Credentials stay in the host OS vault. This setup does not grant access to anyone’s mail or calendar.</p>
        <button className="button primary" disabled={busy||!accepted}>{busy?'Saving…':'Save Workspace application'}</button>
      </form>
    </>}
    {error!=null&&<ErrorNotice error={error}/>}{saved&&<p role="status">Workspace application saved. Each account must connect separately.</p>}
  </section>;
}
