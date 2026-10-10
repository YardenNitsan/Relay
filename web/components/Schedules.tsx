import {useId,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {TaskOptions,Workspace} from '../../shared/types';
import {api} from '../api';
import {Empty,ErrorNotice,Loading,humanize} from './ui';
import '../styles/schedules.css';

interface Schedule {id:string;name:string;objective:string;options:TaskOptions;intervalMinutes:number|null;missedPolicy:'skip'|'once';nextRunAt:string|null;enabled:boolean;archivedAt:string|null;lastError:string|null;}
interface Run {id:string;scheduledAt:string;taskId:string|null;status:string;reason:string|null;taskStatus:string|null;}
const options=(workspaceId:string|null):TaskOptions=>({depth:'fast',modelId:null,reasoning:'auto',efficiency:'efficient',access:'read_only',workspaceId,contextTokens:4096,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},mcpServerIds:[],budget:{maxCalls:4,maxIterations:2,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}});
const localInput=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
const displayTime=(value:string)=>new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
function limits(value:TaskOptions){return `${value.budget.maxCalls} model calls, ${value.budget.maxSeconds} seconds of execution, ${value.budget.maxOutputTokens??512} output tokens per call, ${value.contextTokens.toLocaleString()} context tokens. Local only. Read-only files. No network or external tools.`;}

function ScheduleCard({schedule,changed,onOpenTask}:{schedule:Schedule;changed:()=>Promise<void>;onOpenTask?:(id:string)=>void}){
  const [review,setReview]=useState<'enable'|'archive'|null>(null),[approved,setApproved]=useState(false),[history,setHistory]=useState(false);
  const enableRef=useRef<HTMLButtonElement>(null),archiveRef=useRef<HTMLButtonElement>(null),historyRef=useRef<HTMLButtonElement>(null),historyId=useId();
  const runs=useQuery({queryKey:['schedule-runs',schedule.id],queryFn:({signal})=>api<Run[]>(`/schedules/${schedule.id}/runs`,{signal}),enabled:history,refetchInterval:history?15000:false});
  const toggle=useMutation({mutationFn:(enabled:boolean)=>api(`/schedules/${schedule.id}/enabled`,{method:'POST',body:{enabled,confirmed:true}}),onSuccess:async()=>{setReview(null);setApproved(false);await changed();requestAnimationFrame(()=>enableRef.current?.focus());}});
  const archive=useMutation({mutationFn:()=>api(`/schedules/${schedule.id}/archive`,{method:'POST',body:{confirmed:true}}),onSuccess:async()=>{setReview(null);await changed();requestAnimationFrame(()=>historyRef.current?.focus());}});
  const busy=toggle.isPending||archive.isPending;
  const cancel=()=>{const previous=review;setReview(null);setApproved(false);requestAnimationFrame(()=>(previous==='archive'?archiveRef:enableRef).current?.focus());};
  return <article className="schedule-entry">
    <div className="schedule-entry-heading"><h4>{schedule.name}</h4><span className="schedule-state">{schedule.archivedAt?'Archived':schedule.enabled?'Enabled':'Disabled'}</span></div>
    <p className="schedule-objective">{schedule.objective}</p>
    <dl className="schedule-facts"><div><dt>{schedule.enabled?'Next due':'Planned start'}</dt><dd>{schedule.nextRunAt?displayTime(schedule.nextRunAt):'No further run scheduled'}</dd></div><div><dt>Frequency</dt><dd>{schedule.intervalMinutes?`Every ${schedule.intervalMinutes} minutes`:'One time'}</dd></div></dl>
    <p className="hint">{limits(schedule.options)}</p>
    <p className="hint">Missed run: {schedule.missedPolicy==='skip'?'skip runs first discovered over one minute late after downtime':'run once when Relay returns; never replay a backlog'}.</p>
    {schedule.lastError&&<ErrorNotice error={schedule.lastError}/>}
    <div className="schedule-actions">
      {!schedule.archivedAt&&(schedule.enabled?<button type="button" ref={enableRef} className="button subtle" disabled={busy} onClick={()=>toggle.mutate(false)}>Disable and cancel active runs</button>:<button type="button" ref={enableRef} className="button subtle" disabled={busy||!schedule.nextRunAt||review!==null} onClick={()=>{setApproved(false);setReview('enable');}}>Enable schedule</button>)}
      <button type="button" ref={historyRef} className="text-button" aria-expanded={history} aria-controls={historyId} onClick={()=>setHistory(!history)}>{history?'Hide run history':'Show run history'}</button>
      {!schedule.archivedAt&&<button type="button" ref={archiveRef} className="text-button" disabled={busy||review!==null} onClick={()=>setReview('archive')}>Archive schedule</button>}
    </div>
    {review==='enable'&&<div className="schedule-review" role="group" aria-label="Review schedule authorization"><p>Each occurrence can use the limits above while Relay is running. Disabling cancels queued and active runs.</p><label className="check-label"><input type="checkbox" disabled={busy} checked={approved} onChange={event=>setApproved(event.target.checked)}/>I authorize these limits for each scheduled run</label><div className="schedule-actions"><button type="button" className="button primary" disabled={!approved||busy} onClick={()=>toggle.mutate(true)}>Enable approved schedule</button><button type="button" className="text-button" disabled={busy} onClick={cancel}>Cancel enable</button></div></div>}
    {review==='archive'&&<div className="schedule-review" role="group" aria-label="Confirm schedule archive"><p>Archive this schedule and cancel queued and active runs? Run history will be kept. Archiving cannot be undone here.</p><div className="schedule-actions"><button type="button" className="button danger-button" disabled={busy} onClick={()=>archive.mutate()}>Confirm archive</button><button type="button" className="text-button" disabled={busy} onClick={cancel}>Keep schedule</button></div></div>}
    {(toggle.isError||archive.isError)&&<ErrorNotice error={toggle.error??archive.error}/>}
    <div id={historyId} hidden={!history} className="schedule-history">{history&&(runs.isPending?<Loading>Reading run history...</Loading>:runs.isError?<ErrorNotice error={runs.error} retry={()=>{void runs.refetch();}}/>:runs.data?.length?<ol>{runs.data.map(run=><li key={run.id}><time dateTime={run.scheduledAt}>{displayTime(run.scheduledAt)}</time><p>{humanize(run.status)}{run.taskStatus?` / task ${humanize(run.taskStatus)}`:''}</p>{run.reason&&<p className="hint">{run.reason}</p>}{run.taskId&&(onOpenTask?<button type="button" className="text-button" onClick={()=>onOpenTask(run.taskId!)}>Open task</button>:<p className="hint">Task reference: <code>{run.taskId}</code></p>)}</li>)}</ol>:<p className="hint">No scheduled runs yet.</p>)}</div>
  </article>;
}

export default function Schedules({workspaces,onOpenTask}:{workspaces:Workspace[];onOpenTask?:(taskId:string)=>void}){
  const intervalHint=useId();
  const client=useQueryClient(),catalog=useQuery({queryKey:['schedules'],queryFn:({signal})=>api<Schedule[]>('/schedules',{signal}),refetchInterval:15000});
  const [name,setName]=useState(''),[objective,setObjective]=useState(''),[workspaceId,setWorkspaceId]=useState<string|null>(null);
  const [start,setStart]=useState(()=>localInput(new Date(Date.now()+3600_000))),[repeat,setRepeat]=useState('once'),[interval,setInterval]=useState('60'),[missed,setMissed]=useState<'skip'|'once'>('skip');
  const [approved,setApproved]=useState(false),[message,setMessage]=useState('');
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone,selectedDate=new Date(start),dateValid=Number.isFinite(selectedDate.getTime())&&localInput(selectedDate)===start;
  const changed=async()=>{await client.invalidateQueries({queryKey:['schedules']});};
  const save=useMutation({mutationFn:async()=>{
    if(!approved||!dateValid||selectedDate.getTime()<=Date.now())throw new Error('Choose a valid future local time and approve this schedule.');
    return api<Schedule>('/schedules',{method:'POST',body:{name,objective,startAt:selectedDate.toISOString(),intervalMinutes:repeat==='once'?null:Number(interval),missedPolicy:missed,enabled:false,confirmed:true,options:options(workspaceId)}});
  },onSuccess:async()=>{setName('');setObjective('');setApproved(false);setMessage('Schedule saved disabled. Review and enable it when you are ready.');await changed();}});
  return <div className="schedules-panel"><div className="section-intro"><p>Useful work, at a time you choose.</p><p className="muted">Owner-controlled local tasks. Relay must be running. Every run uses the same read-only permissions and bounded budget; no cloud model or external action is allowed.</p></div>
    <form className="schedule-form" onChange={()=>setApproved(false)} onSubmit={event=>{event.preventDefault();if(approved&&!save.isPending)save.mutate();}}>
      <h3>Create a schedule</h3>
      <label>Schedule name<input required maxLength={100} value={name} disabled={save.isPending} onChange={event=>setName(event.target.value)}/></label>
      <label>Objective<textarea required rows={3} maxLength={16000} value={objective} disabled={save.isPending} onChange={event=>setObjective(event.target.value)}/></label>
      <label>Workspace<select value={workspaceId??''} disabled={save.isPending} onChange={event=>setWorkspaceId(event.target.value||null)}><option value="">No workspace</option>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      <div className="schedule-time-fields"><label>First run<input type="datetime-local" required value={start} disabled={save.isPending} onChange={event=>setStart(event.target.value)}/></label><label>Repeat<select value={repeat} disabled={save.isPending} onChange={event=>setRepeat(event.target.value)}><option value="once">One time</option><option value="interval">At an interval</option></select></label></div>
      <p className="hint">Your timezone: {timezone}. {dateValid?`Saved as ${selectedDate.toISOString()} (UTC).`:'Enter a valid local date and time.'}</p>
      {repeat==='interval'&&<div><label>Interval in minutes<input type="number" min={15} max={525600} step={1} required aria-describedby={intervalHint} value={interval} disabled={save.isPending} onChange={event=>setInterval(event.target.value)}/></label><p id={intervalHint} className="hint">Elapsed minutes, at least 15. Local clock time can shift when daylight saving changes.</p></div>}
      <label>If Relay misses a run<select value={missed} disabled={save.isPending} onChange={event=>setMissed(event.target.value as 'skip'|'once')}><option value="skip">Skip runs missed during downtime</option><option value="once">Run once when Relay returns</option></select></label>
      <div className="schedule-budget"><strong>Limits for each run</strong><p>{limits(options(workspaceId))}</p></div>
      <label className="check-label"><input type="checkbox" checked={approved} disabled={save.isPending} onChange={event=>{event.stopPropagation();setApproved(event.target.checked);}}/>I approve saving this local, read-only schedule</label>
      <button type="submit" className="button primary" disabled={!approved||save.isPending||!name.trim()||!objective.trim()||!dateValid}>{save.isPending?'Saving...':'Save disabled schedule'}</button>
      {save.isError&&<ErrorNotice error={save.error}/>}
    </form>
    {message&&<p role="status">{message}</p>}
    <section aria-label="Saved schedules"><h3>Your schedules</h3>{catalog.isPending?<Loading>Reading schedules...</Loading>:catalog.isError?<ErrorNotice error={catalog.error} retry={()=>{void catalog.refetch();}}/>:catalog.data?.length?catalog.data.map(schedule=><ScheduleCard key={schedule.id} schedule={schedule} changed={changed} onOpenTask={onOpenTask}/>):<Empty title="No scheduled tasks"><p>Save a disabled schedule above, then review its limits before enabling it.</p></Empty>}</section>
  </div>;
}
