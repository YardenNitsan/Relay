import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CalendarDays,Mail,RefreshCw,Settings2} from 'lucide-react';
import {api,onSessionInvalidated} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {OwnerSetup} from './OwnerSetup';
import {MailReader} from './MailReader';
import {CalendarReader} from './CalendarReader';
import {localInput,workspaceRoot as root,type WorkspaceStatus,type MailSearch,type MailBody,type CalendarEvents,type Availability} from './types';
import './google-workspace.css';

type View='mail'|'calendar'|'setup';
export default function GoogleWorkspaceStudio({owner}:{owner:boolean}){
  const client=useQueryClient(),request=useGuardedModalAction();
  const status=useQuery({queryKey:['google-workspace'],queryFn:({signal})=>api<WorkspaceStatus>(root,{signal}),retry:false});
  const [view,setView]=useState<View>('mail'),[busy,setBusy]=useState(''),[error,setError]=useState<unknown>(null),[message,setMessage]=useState(''),[redirect,setRedirect]=useState<string|null>(null);
  const [search,setSearch]=useState(''),[mail,setMail]=useState<MailSearch|null>(null),[body,setBody]=useState<MailBody|null>(null),[events,setEvents]=useState<CalendarEvents|null>(null),[availability,setAvailability]=useState<Availability|null>(null);
  const [start,setStart]=useState(()=>localInput(new Date())),[end,setEnd]=useState(()=>localInput(new Date(Date.now()+86400000)));
  const pending=useRef<AbortController|null>(null),mounted=useRef(true),lock=useRef(false);
  const clear=()=>{setMail(null);setBody(null);setEvents(null);setAvailability(null);setSearch('');};
  useModalDraftGuard({dirty:false,busy:Boolean(busy),label:'Google Workspace request'});
  useEffect(()=>{mounted.current=true;const unsubscribe=onSessionInvalidated(()=>{pending.current?.abort();clear();setMessage('');setError(null);});return()=>{mounted.current=false;pending.current?.abort();unsubscribe();};},[]);
  useEffect(()=>{if(!status.data?.connected){pending.current?.abort();clear();}},[status.data?.connected]);
  // Commit the idle state first so authorized OAuth navigation does not trigger
  // the pending-operation beforeunload guard.
  useEffect(()=>{if(redirect&&!busy)window.location.assign(redirect);},[redirect,busy]);
  const perform=async(label:string,work:(signal:AbortSignal)=>Promise<void>)=>{
    if(lock.current)return;lock.current=true;
    const controller=new AbortController();pending.current=controller;setBusy(label);setError(null);setMessage('');
    try{await work(AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]));}
    catch(caught){if(mounted.current&&!controller.signal.aborted)setError(caught);}
    finally{if(pending.current===controller){pending.current=null;lock.current=false;if(mounted.current)setBusy('');}}
  };
  const switchView=(next:View)=>request(()=>{setView(next);setError(null);});
  const connect=()=>request(()=>{setView('mail');void perform('connect',async signal=>{
    const response=await api<{url:string}>(root+'/start',{method:'POST',body:{origin:window.location.origin},signal});const url=new URL(response.url);
    if(url.protocol!=='https:'||url.hostname!=='accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.port)throw new Error('The host returned an invalid Google sign-in address.');
    if(!signal.aborted)setRedirect(url.href);
  });});
  const disconnect=()=>request(()=>{setView('mail');clear();void perform('disconnect',async signal=>{
    await client.cancelQueries({queryKey:['google-workspace']});
    const result=await api<{revoked:boolean}>(root,{method:'DELETE',signal});
    setMessage(result.revoked?'Google Workspace disconnected.':'Relay removed its credential. Google-side revocation was not confirmed; review your Google account permissions.');
    client.setQueryData<WorkspaceStatus>(['google-workspace'],previous=>previous?{...previous,connected:false,storage:'none'}:undefined);
    void client.invalidateQueries({queryKey:['google-workspace']});
  });});
  const findMail=()=>{if(lock.current)return;setMail(null);setBody(null);void perform('search',async signal=>{const result=await api<MailSearch>(root+'/mail/search',{method:'POST',body:{query:search,maxResults:10},signal});if(!signal.aborted)setMail(result);});};
  const readMail=(id:string)=>{void perform(`read:${id}`,async signal=>{const result=await api<MailBody>(root+'/mail/read',{method:'POST',body:{id},signal});if(!signal.aborted)setBody(result);});};
  const readCalendar=(kind:'events'|'freebusy')=>{if(lock.current)return;setEvents(null);setAvailability(null);void perform(kind,async signal=>{
    const from=new Date(start),to=new Date(end),duration=to.getTime()-from.getTime();
    if(!Number.isFinite(duration)||duration<=0||duration>31*86400000)throw new Error('Choose a time window greater than zero and no longer than 31 days.');
    const window={timeMin:from.toISOString(),timeMax:to.toISOString()};
    if(kind==='events'){const result=await api<CalendarEvents>(root+'/calendar/events',{method:'POST',body:{...window,calendarId:'primary',maxResults:20},signal});if(!signal.aborted){setEvents(result);setAvailability(null);}}
    else{const result=await api<Availability>(root+'/calendar/freebusy',{method:'POST',body:{...window,calendarIds:['primary']},signal});if(!signal.aborted){setAvailability(result);setEvents(null);}}
  });};
  return <div className="google-studio">
    <div className="google-studio-intro"><h3>Your account. Read-only access.</h3><p>Read selected Gmail messages and your primary calendar. Nothing is fetched until you ask, and these results are not sent to models or conversations.</p></div>
    <section className="google-studio-connection" aria-label="Google Workspace connection">
      {status.isPending&&<Loading>Checking account connection…</Loading>}
      {status.isError&&<div className="google-studio-connection-error"><ErrorNotice error={status.error} retry={()=>{void status.refetch();}}/>{status.data&&<p className="hint">Showing the last loaded connection state.</p>}</div>}
      {status.data&&<><p>{status.data.connected?'Connected for read-only access.':status.data.configured?'Connect your own Google account to begin.':'The host owner must configure a Google Workspace application first.'}</p>{status.data.connected?<button className="button" disabled={!!busy} onClick={disconnect}>{busy==='disconnect'?'Disconnecting…':'Disconnect account'}</button>:status.data.configured&&<button className="button primary" disabled={!!busy} onClick={connect}>{busy==='connect'?'Opening Google…':'Connect Google account'}</button>}</>}
      <button className="icon-button" aria-label="Refresh Google Workspace connection" disabled={!!busy||status.isFetching} onClick={()=>{void status.refetch();}}><RefreshCw size={18} aria-hidden="true"/></button>
    </section>
    <nav className="google-studio-nav" aria-label="Google Workspace views">
      <button aria-pressed={view==='mail'} onClick={()=>switchView('mail')}><Mail size={18} aria-hidden="true"/>Mail</button>
      <button aria-pressed={view==='calendar'} onClick={()=>switchView('calendar')}><CalendarDays size={18} aria-hidden="true"/>Calendar</button>
      {owner&&<button aria-pressed={view==='setup'} onClick={()=>switchView(view==='setup'?'mail':'setup')}><Settings2 size={18} aria-hidden="true"/>Owner setup</button>}
    </nav>
    {error!=null&&<div className="google-studio-feedback"><ErrorNotice error={error}/></div>}{message&&<p className="google-studio-feedback" role="status">{message}</p>}
    <div className="google-studio-content">
      {owner&&view==='setup'?<OwnerSetup/>:status.data?.connected?view==='mail'?<MailReader search={search} onSearch={setSearch} onFind={findMail} onRead={readMail} onBack={()=>setBody(null)} busy={busy} mail={mail} body={body}/>:<CalendarReader start={start} end={end} onStart={setStart} onEnd={setEnd} onRead={readCalendar} busy={busy} events={events} availability={availability}/>:<div className="google-studio-empty google-studio-scroll"><Mail size={30} aria-hidden="true"/><h3>Connect before reading</h3><p>{status.data?.configured?'Connect your Google account above. Then choose what to read.':'The host application must be configured before you can connect your account.'}</p><p className="hint">This view does not request mail or calendar content in the background.</p></div>}
    </div>
    <p className="google-studio-boundary">External content is displayed as text. Sending mail, editing events and autonomous agent access are not available here.</p>
  </div>;
}
