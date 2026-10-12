import {useId,useRef,useState,type RefObject} from 'react';
import {useMutation} from '@tanstack/react-query';
import type {Workspace} from '../../../shared/types';
import {api} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {localInput,scheduleLimits,scheduleOptions,type Schedule} from './schedule-data';
import {useScheduleGuard} from './useScheduleGuard';
export function ScheduleForm({workspaces,onSaved,onCancel,onBusy,headingRef}:{workspaces:Workspace[];onSaved:(schedule:Schedule)=>void;onCancel:()=>void;onBusy:(busy:boolean)=>void;headingRef:RefObject<HTMLHeadingElement|null>}){
  const intervalHint=useId(),lock=useRef(false);
  const [name,setName]=useState(''),[objective,setObjective]=useState(''),[workspaceId,setWorkspaceId]=useState<string|null>(null);
  const [start,setStart]=useState(()=>localInput(new Date(Date.now()+3600_000))),[repeat,setRepeat]=useState('once'),[interval,setInterval]=useState('60'),[missed,setMissed]=useState<'skip'|'once'>('skip');
  const [approved,setApproved]=useState(false),[dirty,setDirty]=useState(false);
  const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone,selectedDate=new Date(start),dateValid=Number.isFinite(selectedDate.getTime())&&localInput(selectedDate)===start;
  const intervalValid=repeat==='once'||(Number.isInteger(Number(interval))&&Number(interval)>=15&&Number(interval)<=525600);
  const save=useMutation({mutationFn:async()=>{
    if(!approved||!dateValid||selectedDate.getTime()<=Date.now()||!intervalValid)throw new Error('Choose a valid future local time, an interval of 15 to 525600 whole minutes if repeating, and approve this schedule.');
    return api<Schedule>('/schedules',{method:'POST',body:{name,objective,startAt:selectedDate.toISOString(),intervalMinutes:repeat==='once'?null:Number(interval),missedPolicy:missed,enabled:false,confirmed:true,options:scheduleOptions(workspaceId)}});
  },onSuccess:schedule=>{setDirty(false);onSaved(schedule);},onSettled:()=>{lock.current=false;}});
  useScheduleGuard(dirty,save.isPending,'Schedule draft',onBusy);
  return <div className="schedule-pane-scroll"><form className="schedule-form" onChange={()=>{setApproved(false);setDirty(true);}} onSubmit={event=>{event.preventDefault();if(approved&&!lock.current){lock.current=true;save.mutate();}}}>
    <header><h3 tabIndex={-1} ref={headingRef}>Create a schedule</h3><p className="hint">Save it disabled, then review its limits before enabling it.</p></header>
    <label>Schedule name<input dir="auto" required maxLength={100} value={name} disabled={save.isPending} onChange={event=>setName(event.target.value)}/></label>
    <label>Objective<textarea dir="auto" required rows={4} maxLength={16000} value={objective} disabled={save.isPending} onChange={event=>setObjective(event.target.value)}/></label>
    <label>Workspace<select value={workspaceId??''} disabled={save.isPending} onChange={event=>setWorkspaceId(event.target.value||null)}><option value="">No workspace</option>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
    <div className="schedule-time-fields"><label>First run<input type="datetime-local" required value={start} disabled={save.isPending} onChange={event=>setStart(event.target.value)}/></label><label>Repeat<select value={repeat} disabled={save.isPending} onChange={event=>setRepeat(event.target.value)}><option value="once">One time</option><option value="interval">At an interval</option></select></label></div>
    <p className="hint">Your timezone: {timezone}. {dateValid?`Saved as ${selectedDate.toISOString()} (UTC).`:'Enter a valid local date and time.'}</p>
    {repeat==='interval'&&<div><label>Interval in minutes<input type="number" min={15} max={525600} step={1} required aria-describedby={intervalHint} value={interval} disabled={save.isPending} onChange={event=>setInterval(event.target.value)}/></label><p id={intervalHint} className="hint">Elapsed minutes, at least 15. Local clock time can shift when daylight saving changes.</p></div>}
    <label>If Relay misses a run<select value={missed} disabled={save.isPending} onChange={event=>setMissed(event.target.value as 'skip'|'once')}><option value="skip">Skip runs missed during downtime</option><option value="once">Run once when Relay returns</option></select></label>
    <p className="hint">{missed==='skip'?'Skip runs first discovered over one minute late after downtime.':'Run once when Relay returns; never replay a backlog.'}</p>
    <section className="schedule-budget" aria-label="Limits for each run"><h4>Limits for each run</h4><p>{scheduleLimits(scheduleOptions(workspaceId))}</p></section>
    <label className="check-label"><input type="checkbox" checked={approved} disabled={save.isPending} onChange={event=>{event.stopPropagation();setApproved(event.target.checked);setDirty(true);}}/>I approve saving this local, read-only schedule</label>
    {save.isError&&<ErrorNotice error={save.error}/>}
    <div className="schedule-actions"><button type="submit" className="button primary" disabled={!approved||save.isPending||!name.trim()||!objective.trim()||!dateValid||!intervalValid}>{save.isPending?'Saving…':'Save disabled schedule'}</button><button type="button" className="text-button" disabled={save.isPending} onClick={onCancel}>Cancel creation</button></div>
  </form></div>;
}
