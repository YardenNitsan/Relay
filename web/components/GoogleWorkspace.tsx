import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {CalendarDays,Mail,ShieldCheck} from 'lucide-react';
import {api,onSessionInvalidated} from '../api';
import {ErrorNotice,Loading} from './ui';
import '../styles/google-workspace.css';

export interface WorkspaceStatus {configured:boolean;connected:boolean;readOnly:true;storage:'os-keyring'|'none';scopes:string[];}
interface Configuration {configured:boolean;clientId:string|null;origins:string[];callbackPath:string;}
interface MailItem {id:string;snippet?:string;headers:{from?:string;to?:string;subject?:string;date?:string};}
interface MailSearch {messages:MailItem[];limited:boolean;}
interface MailBody extends MailItem {text:string|null;bodyUnavailable:boolean;truncated:boolean;}
interface CalendarPoint {date:string|null;dateTime:string|null;timeZone:string|null;}
interface CalendarEvents {events:Array<{id:string;summary:string;description:string;location:string;status:string;start:CalendarPoint;end:CalendarPoint}>;limited:boolean;}
interface Availability {calendars:Array<{id:string;available:boolean;busy:Array<{start:string;end:string}>|null}>;}
const root='/integrations/google-workspace';
function localInput(date:Date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}
function dateLabel(value:string){const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'Time unavailable';}
function pointLabel(point:CalendarPoint){return point.dateTime?dateLabel(point.dateTime):point.date?`${point.date} (all day)`:'Time unavailable';}

function OwnerSetup(){
  const client=useQueryClient(),configuration=useQuery({queryKey:['google-workspace-application'],queryFn:({signal})=>api<Configuration>('/admin/google-workspace',{signal}),retry:false});
  const [clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState<unknown>(null);
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!accepted||busy)return;setBusy(true);setError(null);setSaved(false);try{await api('/admin/google-workspace',{method:'PUT',body:{clientId:clientId.trim(),clientSecret:secret,separateProjectAccepted:true}});setSecret('');setSaved(true);await Promise.all([client.invalidateQueries({queryKey:['google-workspace-application']}),client.invalidateQueries({queryKey:['google-workspace']})]);}catch(caught){setError(caught);}finally{setBusy(false);}};
  return <section className="workspace-google-setup" aria-label="Owner Google Workspace setup">
    <p>Create a Web application OAuth client in a <strong>separate Google Cloud project from Gemini</strong>. Enable the Gmail and Google Calendar APIs and configure the consent screen. Google may require app verification or approved test users.</p>
    <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Open Google Cloud credentials</a>
    {configuration.isPending?<Loading>Reading application settings…</Loading>:configuration.isError?<ErrorNotice error={configuration.error}/>:<>
      <p className="hint">Register these exact authorized redirect URIs:</p><ul className="workspace-google-redirects">{configuration.data.origins.map(origin=><li key={origin}><code>{origin}/?relay_workspace=1</code></li>)}</ul>
      {configuration.data.configured&&<p className="notice">An application is configured. Replacing it requires every account to reconnect.</p>}
      <form className="workspace-google-form" aria-label="Workspace OAuth application" onSubmit={event=>{void save(event);}}>
        <label>Workspace OAuth client ID<input value={clientId} onChange={event=>{setClientId(event.target.value);setAccepted(false);}} placeholder={configuration.data.clientId??'Client ID ending in .apps.googleusercontent.com'} autoCapitalize="none" spellCheck={false} maxLength={300} required disabled={busy}/></label>
        <label>Workspace OAuth client secret<input type="password" value={secret} onChange={event=>{setSecret(event.target.value);setAccepted(false);}} autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={8} maxLength={2048} required disabled={busy}/></label>
        <label className="check-label"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)} disabled={busy}/>This OAuth client belongs to a separate Google Cloud project from Gemini.</label>
        <p className="hint">Relay checks that the client differs from Gemini, but cannot verify which project owns it. Credentials stay in the host OS vault. This setup does not grant access to anyone’s mail or calendar.</p>
        <button className="button primary" disabled={busy||!accepted}>{busy?'Saving…':'Save Workspace application'}</button>
      </form>
    </>}{error!=null&&<ErrorNotice error={error}/>} {saved&&<p role="status">Workspace application saved. Each account must connect separately.</p>}
  </section>;
}

export default function GoogleWorkspace({owner}:{owner:boolean}){
  const client=useQueryClient(),status=useQuery({queryKey:['google-workspace'],queryFn:({signal})=>api<WorkspaceStatus>(root,{signal}),retry:false});
  const [setup,setSetup]=useState(false),[tab,setTab]=useState<'mail'|'calendar'>('mail'),[busy,setBusy]=useState(''),[error,setError]=useState<unknown>(null),[message,setMessage]=useState('');
  const [search,setSearch]=useState(''),[mail,setMail]=useState<MailSearch|null>(null),[body,setBody]=useState<MailBody|null>(null),[events,setEvents]=useState<CalendarEvents|null>(null),[availability,setAvailability]=useState<Availability|null>(null);
  const [start,setStart]=useState(()=>localInput(new Date())),[end,setEnd]=useState(()=>localInput(new Date(Date.now()+86400000)));
  const pending=useRef<AbortController|null>(null),mounted=useRef(true);
  const clear=()=>{setMail(null);setBody(null);setEvents(null);setAvailability(null);setSearch('');};
  useEffect(()=>{mounted.current=true;const unsubscribe=onSessionInvalidated(()=>{pending.current?.abort();clear();setMessage('');setError(null);});return()=>{mounted.current=false;pending.current?.abort();unsubscribe();};},[]);
  useEffect(()=>{if(!status.data?.connected){pending.current?.abort();clear();}},[status.data?.connected]);
  const perform=async(label:string,work:(signal:AbortSignal)=>Promise<void>)=>{pending.current?.abort();const controller=new AbortController();pending.current=controller;setBusy(label);setError(null);setMessage('');try{await work(AbortSignal.any([controller.signal,AbortSignal.timeout(45_000)]));}catch(caught){if(mounted.current&&!controller.signal.aborted)setError(caught);}finally{if(mounted.current&&pending.current===controller)setBusy('');}};
  const connect=()=>perform('connect',async signal=>{const response=await api<{url:string}>(root+'/start',{method:'POST',body:{origin:window.location.origin},signal});const url=new URL(response.url);if(url.protocol!=='https:'||url.hostname!=='accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.port)throw new Error('The host returned an invalid Google sign-in address.');window.location.assign(url.href);});
  const disconnect=()=>{clear();void perform('disconnect',async signal=>{const result=await api<{revoked:boolean}>(root,{method:'DELETE',signal});setMessage(result.revoked?'Google Workspace disconnected.':'Relay removed its credential. Google-side revocation was not confirmed; review your Google account permissions.');client.setQueryData<WorkspaceStatus>(['google-workspace'],previous=>previous?{...previous,connected:false,storage:'none'}:undefined);await client.invalidateQueries({queryKey:['google-workspace']});});};
  const findMail=(event:React.FormEvent)=>{event.preventDefault();setMail(null);setBody(null);void perform('search',async signal=>{const result=await api<MailSearch>(root+'/mail/search',{method:'POST',body:{query:search,maxResults:10},signal});if(!signal.aborted)setMail(result);});};
  const readMail=(id:string)=>{setBody(null);void perform('read',async signal=>{const result=await api<MailBody>(root+'/mail/read',{method:'POST',body:{id},signal});if(!signal.aborted)setBody(result);});};
  const readCalendar=(kind:'events'|'freebusy')=>{setEvents(null);setAvailability(null);void perform(kind,async signal=>{const from=new Date(start),to=new Date(end),duration=to.getTime()-from.getTime();if(!Number.isFinite(duration)||duration<=0||duration>31*86400000)throw new Error('Choose a time window greater than zero and no longer than 31 days.');const window={timeMin:from.toISOString(),timeMax:to.toISOString()};if(kind==='events'){const result=await api<CalendarEvents>(root+'/calendar/events',{method:'POST',body:{...window,calendarId:'primary',maxResults:20},signal});if(!signal.aborted)setEvents(result);}else{const result=await api<Availability>(root+'/calendar/freebusy',{method:'POST',body:{...window,calendarIds:['primary']},signal});if(!signal.aborted)setAvailability(result);}});};
  return <div className="workspace-google">
    <div className="workspace-google-intro"><ShieldCheck size={25} aria-hidden="true"/><div><h3>Your account. Read-only access.</h3><p>Read selected Gmail messages and your primary calendar. Nothing is fetched until you ask, and these results are not sent to models or conversations.</p></div></div>
    <section className="workspace-google-connection" aria-label="Google Workspace connection">
      {status.isPending?<Loading>Checking account connection…</Loading>:status.isError?<ErrorNotice error={status.error} retry={()=>{void status.refetch();}}/>:<>
        <p>{status.data.connected?'Connected for read-only access.':status.data.configured?'Connect your own Google account to begin.':'The host owner must configure a Google Workspace application first.'}</p>
        {status.data.connected?<button className="button" disabled={busy==='disconnect'||busy==='connect'} onClick={disconnect}>{busy==='disconnect'?'Disconnecting…':'Disconnect account'}</button>:status.data.configured&&<button className="button primary" disabled={!!busy} onClick={()=>{void connect();}}>{busy==='connect'?'Opening Google…':'Connect Google account'}</button>}
      </>}
    </section>
    {owner&&<details className="workspace-google-owner" onToggle={event=>setSetup(event.currentTarget.open)}><summary>Owner setup</summary>{setup&&<OwnerSetup/>}</details>}
    {status.data?.connected&&<>
      <div className="workspace-google-tabs" role="group" aria-label="Google information"><button aria-pressed={tab==='mail'} onClick={()=>setTab('mail')}><Mail size={18} aria-hidden="true"/>Mail</button><button aria-pressed={tab==='calendar'} onClick={()=>setTab('calendar')}><CalendarDays size={18} aria-hidden="true"/>Calendar</button></div>
      {tab==='mail'?<section aria-label="Read Gmail" className="workspace-google-reader">
        <form className="workspace-google-form" onSubmit={findMail}><label>Gmail search<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="For example: newer_than:7d" maxLength={1000} disabled={!!busy}/></label><p className="hint">Returns up to 10 message previews. Open an individual message to read its plain text. Attachments and embedded content are excluded.</p><button className="button primary" disabled={!!busy}>{busy==='search'?'Searching…':'Search mail'}</button></form>
        {mail&&<div className="workspace-google-results" aria-label="Mail results"><p role="status">{mail.messages.length?`${mail.messages.length} message previews returned.`:'No messages matched this search.'}{mail.limited?' More matches exist; narrow your search.':''}</p>{mail.messages.map(item=><article key={item.id} className="workspace-google-message"><h4>{item.headers.subject||'No subject'}</h4><p className="hint">{item.headers.from||'Sender not supplied'}{item.headers.date?` · ${item.headers.date}`:''}</p><p>{item.snippet}</p><button className="text-button" disabled={!!busy} onClick={()=>readMail(item.id)}>Read message</button>{body?.id===item.id&&<div className="workspace-google-body">{body.bodyUnavailable?<p>Plain-text content is unavailable. HTML and attachments are not displayed.</p>:<pre>{body.text}</pre>}{body.truncated&&<p className="notice">This message exceeded the read limit; only part is shown.</p>}</div>}</article>)}</div>}
      </section>:<section aria-label="Read primary calendar" className="workspace-google-reader">
        <form className="workspace-google-form" onSubmit={event=>{event.preventDefault();readCalendar('events');}}><div className="workspace-google-dates"><label>From<input type="datetime-local" value={start} onChange={event=>setStart(event.target.value)} required disabled={!!busy}/></label><label>Until<input type="datetime-local" value={end} onChange={event=>setEnd(event.target.value)} required disabled={!!busy}/></label></div><p className="hint">Your primary calendar, up to 20 events within 31 days. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone||'your browser time zone'}.</p><div className="button-row"><button className="button primary" disabled={!!busy}>{busy==='events'?'Reading…':'Read events'}</button><button className="button" type="button" disabled={!!busy} onClick={()=>readCalendar('freebusy')}>{busy==='freebusy'?'Checking…':'Check availability'}</button></div></form>
        {events&&<div className="workspace-google-results" aria-label="Calendar results"><p role="status">{events.events.length?`${events.events.length} events returned.`:'No events returned in this window.'}{events.limited?' More events exist; narrow the time window.':''}</p>{events.events.map((event,index)=><article className="workspace-google-event" key={`${event.id}-${index}`}><h4>{event.summary||'Untitled event'}</h4><p>{pointLabel(event.start)} — {pointLabel(event.end)}</p>{event.location&&<p className="hint">{event.location}</p>}{event.description&&<p className="workspace-google-description">{event.description}</p>}</article>)}</div>}
        {availability&&<div className="workspace-google-results" aria-label="Calendar availability">{availability.calendars.map(item=><div key={item.id}>{!item.available||!item.busy?<p role="status">Availability could not be verified.</p>:item.busy.length?<><p role="status">{item.busy.length} busy periods returned.</p><ul>{item.busy.map((period,index)=><li key={index}>{dateLabel(period.start)} — {dateLabel(period.end)}</li>)}</ul></>:<p role="status">No busy periods were returned for this calendar in the selected window.</p>}</div>)}</div>}
      </section>}
      <p className="hint workspace-google-boundary">External content is displayed as text. Sending mail, editing events and autonomous agent access are not available here.</p>
    </>}
    {error!=null&&<ErrorNotice error={error}/>} {message&&<p role="status">{message}</p>}
  </div>;
}
