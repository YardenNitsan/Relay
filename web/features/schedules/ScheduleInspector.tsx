import {useEffect,useId,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../../api';
import {ErrorNotice,Loading,humanize} from '../../components/ui';
import {displayTime,isArchived,scheduleLimits,scheduleState,type Schedule,type ScheduleRun} from './schedule-data';
import {useScheduleGuard} from './useScheduleGuard';
interface Props {schedule:Schedule;workspaceName:string;changed:()=>Promise<void>;onOpenTask?:(id:string)=>Promise<void>;onBusy:(busy:boolean)=>void;headingRef:RefObject<HTMLHeadingElement|null>}
export function ScheduleInspector({schedule,workspaceName,changed,onOpenTask,onBusy,headingRef}:Props){
  const [review,setReview]=useState<'enable'|'archive'|null>(null),[approved,setApproved]=useState(false),[history,setHistory]=useState(false);
  const client=useQueryClient(),archived=isArchived(schedule),openLock=useRef(false);
  const [openingTask,setOpeningTask]=useState<string|null>(null),[taskError,setTaskError]=useState<unknown>(null);
  const enableRef=useRef<HTMLButtonElement>(null),archiveRef=useRef<HTMLButtonElement>(null),historyRef=useRef<HTMLButtonElement>(null),approvalRef=useRef<HTMLInputElement>(null),archiveConfirmRef=useRef<HTMLButtonElement>(null),historyId=useId();
  const runs=useQuery({queryKey:['schedule-runs',schedule.id],queryFn:({signal})=>api<ScheduleRun[]>(`/schedules/${schedule.id}/runs`,{signal}),enabled:history,refetchInterval:history?15000:false});
  const toggle=useMutation({onMutate:()=>client.cancelQueries({queryKey:['schedules']}),mutationFn:(enabled:boolean)=>api<Schedule>(`/schedules/${schedule.id}/enabled`,{method:'POST',body:{enabled,confirmed:true}}),onSuccess:updated=>{
    client.setQueryData<Schedule[]>(['schedules'],current=>(current??[]).map(item=>item.id===updated.id?updated:item));
    setReview(null);setApproved(false);void changed().catch(()=>undefined);requestAnimationFrame(()=>enableRef.current?.focus());
  }});
  const archive=useMutation({onMutate:()=>client.cancelQueries({queryKey:['schedules']}),mutationFn:()=>api<{ok:true}>(`/schedules/${schedule.id}/archive`,{method:'POST',body:{confirmed:true}}),onSuccess:()=>{
    client.setQueryData<Schedule[]>(['schedules'],current=>(current??[]).map(item=>item.id===schedule.id?{...item,enabled:false,archiveAcknowledged:true}:item));
    setReview(null);void changed().catch(()=>undefined);requestAnimationFrame(()=>historyRef.current?.focus());
  }});
  const busy=toggle.isPending||archive.isPending||openingTask!==null;
  useScheduleGuard(review!==null,busy,'Schedule authorization review',onBusy);
  const authorization=JSON.stringify([schedule.objective,schedule.options,schedule.intervalMinutes,schedule.missedPolicy]);
  useEffect(()=>{setApproved(false);},[authorization]);
  useEffect(()=>{if(archived||schedule.enabled){setReview(null);setApproved(false);}},[archived,schedule.enabled]);
  useLayoutEffect(()=>{if(review==='enable')approvalRef.current?.focus();else if(review==='archive')archiveConfirmRef.current?.focus();},[review]);
  const cancel=()=>{const previous=review;setReview(null);setApproved(false);requestAnimationFrame(()=>(previous==='archive'?archiveRef:enableRef).current?.focus());};
  const openTask=async(id:string)=>{if(!onOpenTask||busy||openLock.current)return;openLock.current=true;setOpeningTask(id);setTaskError(null);try{await onOpenTask(id);}catch(error){setTaskError(error);}finally{openLock.current=false;setOpeningTask(null);}};
  return <article className="schedule-pane-scroll schedule-inspector" aria-label={`${schedule.name} schedule`}>
    <header className="schedule-inspector-heading"><h3 tabIndex={-1} ref={headingRef} dir="auto">{schedule.name}</h3><span className="schedule-state">{scheduleState(schedule)}</span></header>
    <p className="schedule-objective" dir="auto">{schedule.objective}</p>
    <dl className="schedule-facts"><div><dt>{schedule.enabled?'Next due':'Planned start'}</dt><dd>{schedule.nextRunAt?<time dateTime={schedule.nextRunAt}>{displayTime(schedule.nextRunAt)}</time>:'No further run scheduled'}</dd></div><div><dt>Frequency</dt><dd>{schedule.intervalMinutes?`Every ${schedule.intervalMinutes} minutes`:'One time'}</dd></div><div><dt>Read-only workspace</dt><dd dir="auto">{workspaceName}</dd></div><div><dt>Model selection</dt><dd>{schedule.options.modelId??'Automatic local model'}</dd></div></dl>
    {schedule.intervalMinutes!=null&&<p className="hint">Intervals use elapsed minutes. Local clock time can shift when daylight saving changes.</p>}
    <p className="hint">Missed run: {schedule.missedPolicy==='skip'?'skip runs first discovered over one minute late after downtime':'run once when Relay returns; never replay a backlog'}.</p>
    <section className="schedule-budget" aria-label="Limits for each run"><h4>Limits for each run</h4><p>{scheduleLimits(schedule.options)}</p></section>
    <p className="hint">Relay must be running. A saved schedule does not guarantee successful execution; review each task’s result and evidence.</p>
    {schedule.lastError&&<ErrorNotice error={schedule.lastError}/>}
    <div className="schedule-actions">
      {!archived&&(schedule.enabled?<button type="button" ref={enableRef} className="button subtle" disabled={busy} onClick={()=>toggle.mutate(false)}>Disable and cancel active runs</button>:<button type="button" ref={enableRef} className="button subtle" disabled={busy||!schedule.nextRunAt||review!==null} onClick={()=>{toggle.reset();setApproved(false);setReview('enable');}}>Enable schedule</button>)}
      <button type="button" ref={historyRef} className="text-button" disabled={busy} aria-expanded={history} aria-controls={historyId} onClick={()=>setHistory(!history)}>{history?'Hide run history':'Show run history'}</button>
      {!archived&&<button type="button" ref={archiveRef} className="text-button" disabled={busy||review!==null} onClick={()=>{archive.reset();setReview('archive');}}>Archive schedule</button>}
    </div>
    {review==='enable'&&<div className="schedule-review" role="group" aria-label="Review schedule authorization"><h4>Authorize each occurrence</h4><p>Each occurrence can use the limits above while Relay is running. Disabling cancels queued and active runs.</p><label className="check-label"><input ref={approvalRef} type="checkbox" disabled={busy} checked={approved} onChange={event=>setApproved(event.target.checked)}/>I authorize these limits for each scheduled run</label><div className="schedule-actions"><button type="button" className="button primary" disabled={!approved||busy} onClick={()=>toggle.mutate(true)}>{toggle.isPending?'Enabling…':'Enable approved schedule'}</button><button type="button" className="text-button" disabled={busy} onClick={cancel}>Cancel enable</button></div></div>}
    {review==='archive'&&<div className="schedule-review" role="group" aria-label="Confirm schedule archive"><h4>Archive this schedule?</h4><p>Archive this schedule and cancel queued and active runs? Run history will be kept. Archiving cannot be undone here.</p><div className="schedule-actions"><button type="button" ref={archiveConfirmRef} className="button danger-button" disabled={busy} onClick={()=>archive.mutate()}>{archive.isPending?'Archiving…':'Confirm archive'}</button><button type="button" className="text-button" disabled={busy} onClick={cancel}>Keep schedule</button></div></div>}
    {(toggle.isError||archive.isError)&&<ErrorNotice error={toggle.error??archive.error}/>}
    {taskError!=null&&<ErrorNotice error={taskError}/>}
    <div id={historyId} hidden={!history} className="schedule-history">{history&&<><h4>Run history</h4><p className="hint">Latest 50 receipts. Dispatch state and task outcome are separate.</p>{runs.isError&&<ErrorNotice error={runs.error} retry={()=>{void runs.refetch();}}/>}{runs.isPending?<Loading>Reading run history…</Loading>:runs.data?.length?<ol>{runs.data.map(run=><li key={run.id}><time dateTime={run.scheduledAt}>{displayTime(run.scheduledAt)}</time><p>{humanize(run.status)}{run.taskStatus?` / task ${humanize(run.taskStatus)}`:''}</p>{run.reason&&<p className="hint" dir="auto">{run.reason}</p>}{run.taskId&&(onOpenTask?<button type="button" className="text-button" disabled={busy||review!==null} onClick={()=>{void openTask(run.taskId!);}}>{openingTask===run.taskId?'Opening task…':'Open task'}</button>:<p className="hint">Task reference: <code>{run.taskId}</code></p>)}</li>)}</ol>:runs.data&&<p className="hint">No scheduled runs yet.</p>}</>}</div>
  </article>;
}
