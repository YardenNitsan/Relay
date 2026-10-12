import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,CalendarClock,ChevronRight,Plus,RefreshCw,Search} from 'lucide-react';
import type {Workspace} from '../../../shared/types';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction} from '../../components/modal-guard';
import {ScheduleForm} from './ScheduleForm';
import {ScheduleInspector} from './ScheduleInspector';
import {displayTime,scheduleState,type Schedule} from './schedule-data';
import '../../styles/schedules.css';
export default function ScheduleStudio({workspaces,onOpenTask}:{workspaces:Workspace[];onOpenTask?:(taskId:string)=>Promise<void>}){
  const client=useQueryClient(),catalog=useQuery({queryKey:['schedules'],queryFn:({signal})=>api<Schedule[]>('/schedules',{signal}),refetchInterval:15000});
  const [selected,setSelected]=useState<string|null>(null),[view,setView]=useState<'index'|'detail'|'create'>('index'),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [inspectionVersion,setInspectionVersion]=useState(0);
  const reportBusy=useCallback((value:boolean)=>setBusy(value),[]),request=useGuardedModalAction();
  const root=useRef<HTMLDivElement>(null),index=useRef<HTMLDivElement>(null),pane=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),searchRef=useRef<HTMLInputElement>(null),newRef=useRef<HTMLButtonElement>(null);
  const rows=useRef(new Map<string,HTMLButtonElement>()),lastFocus=useRef<HTMLElement|null>(null),focusTarget=useRef<'heading'|'index'|'new'|null>(null);
  const listScroll=useRef<HTMLDivElement>(null),narrowScroll=useRef(0);
  const selectedSchedule=catalog.data?.find(schedule=>schedule.id===selected);
  const matching=catalog.data?.filter(schedule=>(filter==='all'||scheduleState(schedule).toLowerCase()===filter)&&`${schedule.name} ${schedule.objective}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))??[];
  const changed=useCallback(async()=>{await client.invalidateQueries({queryKey:['schedules']});},[client]);
  useLayoutEffect(()=>{
    if(focusTarget.current==='heading')heading.current?.focus({preventScroll:true});
    else if(focusTarget.current==='new')newRef.current?.focus({preventScroll:true});
    else if(focusTarget.current==='index')((selected&&rows.current.get(selected))||searchRef.current)?.focus({preventScroll:true});
    focusTarget.current=null;
  },[selected,view,inspectionVersion]);
  useLayoutEffect(()=>{
    const media=window.matchMedia('(max-width: 899px)');let frame=0;
    const changed=()=>{if(media.matches&&view!=='create'){
      const active=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:lastFocus.current;
      if(index.current?.contains(active))setView('index');else if(pane.current?.contains(active)&&selected)setView('detail');
      frame=requestAnimationFrame(()=>{if(listScroll.current)listScroll.current.scrollTop=narrowScroll.current;if(active?.isConnected&&active.getClientRects().length)active.focus({preventScroll:true});});
    }};media.addEventListener('change',changed);return()=>{media.removeEventListener('change',changed);cancelAnimationFrame(frame);};
  },[selected,view]);
  const inspect=(id:string)=>{if(selected===id&&view==='detail'){heading.current?.focus({preventScroll:true});return;}request(()=>{focusTarget.current='heading';setSelected(id);setView('detail');setMessage('');});};
  const create=()=>request(()=>{focusTarget.current='heading';setView('create');setMessage('');});
  const back=()=>request(()=>{focusTarget.current=view==='create'?'new':'index';setInspectionVersion(value=>value+1);setView('index');});
  const saved=(schedule:Schedule)=>{client.setQueryData<Schedule[]>(['schedules'],current=>[schedule,...(current??[]).filter(item=>item.id!==schedule.id)]);focusTarget.current='heading';setSelected(schedule.id);setView('detail');setMessage('Schedule saved disabled. Review and enable it when you are ready.');void changed();};
  return <div ref={root} className={`schedule-studio dispatch-schedules schedule-view-${view}`} onFocusCapture={event=>{lastFocus.current=event.target;}}>
    <div className="schedule-studio-intro"><div><p>Work on your timetable.</p><p className="hint">Local owner schedules. Read-only tasks with bounded budgets. Relay must be running.</p></div>
    <div className="schedule-studio-toolbar"><button ref={newRef} className="button" disabled={busy||view==='create'} onClick={create}><Plus size={17} aria-hidden="true"/>New schedule</button><button className="icon-button" aria-label="Refresh schedules" disabled={busy||catalog.isFetching} onClick={()=>{void catalog.refetch();}}><RefreshCw size={17} aria-hidden="true" className={catalog.isFetching?'spin':''}/></button></div></div>
    {message&&<p className="schedule-feedback" role="status">{message}</p>}
    <div className="schedule-studio-workspace">
      <div className="schedule-index" ref={index}>
        <div className="schedule-index-controls"><label htmlFor="schedule-search">Search schedules</label><div className="schedule-search-field"><Search size={17} aria-hidden="true"/><input ref={searchRef} id="schedule-search" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name or objective"/></div><label className="schedule-filter">Schedule state<select value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All schedules</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="archived">Archived</option></select></label></div>
        <div className="schedule-index-scroll" ref={listScroll} onScroll={event=>{if(window.matchMedia('(max-width: 899px)').matches&&event.currentTarget.getClientRects().length)narrowScroll.current=event.currentTarget.scrollTop;}}>
          {catalog.isError&&<ErrorNotice error={catalog.error} retry={()=>{void catalog.refetch();}}/>}{catalog.isPending?<Loading>Reading schedules…</Loading>:matching.length?<ul className="schedule-index-list">{matching.map(schedule=><li key={schedule.id}><button className="schedule-index-row" ref={node=>{if(node)rows.current.set(schedule.id,node);else rows.current.delete(schedule.id);}} aria-label={`Inspect ${schedule.name}`} aria-current={selected===schedule.id?'true':undefined} disabled={busy} onClick={()=>inspect(schedule.id)}><span><span className="schedule-row-state" data-state={scheduleState(schedule).toLowerCase()}>{scheduleState(schedule)}</span><strong dir="auto">{schedule.name}</strong><span className="schedule-row-objective" dir="auto">{schedule.objective}</span><small>{schedule.nextRunAt?<><span>{schedule.enabled?'Next due':'Planned start'}</span><time dateTime={schedule.nextRunAt}>{displayTime(schedule.nextRunAt)}</time></>:'No further run scheduled'}</small></span><ChevronRight size={16} aria-hidden="true"/></button></li>)}</ul>:catalog.data&&<div className="schedule-empty-index"><h3>{catalog.data?.length?'No matching schedules':'No scheduled tasks'}</h3><p>{catalog.data?.length?'Try another name or schedule state.':'Create a disabled schedule, then review its limits before enabling it.'}</p>{(search||filter!=='all')&&<button className="text-button" onClick={()=>{setSearch('');setFilter('all');searchRef.current?.focus();}}>Clear filters</button>}</div>}
        </div>
      </div>
      <div className="schedule-detail" ref={pane}>
        {view==='create'?<><div className="schedule-pane-navigation"><button className="text-button" disabled={busy} onClick={back}><ArrowLeft size={17}/>All schedules</button></div><ScheduleForm workspaces={workspaces} headingRef={heading} onBusy={reportBusy} onSaved={saved} onCancel={back}/></>:selectedSchedule?<><div className="schedule-pane-navigation schedule-detail-back"><button className="text-button" disabled={busy} onClick={back}><ArrowLeft size={17}/>All schedules</button></div><ScheduleInspector key={`${selectedSchedule.id}:${inspectionVersion}`} schedule={selectedSchedule} workspaceName={selectedSchedule.options.workspaceId?(workspaces.find(workspace=>workspace.id===selectedSchedule.options.workspaceId)?.name??`Workspace ${selectedSchedule.options.workspaceId}`):'No workspace'} changed={changed} onBusy={reportBusy} headingRef={heading} onOpenTask={onOpenTask}/></>:<div className="schedule-detail-empty"><CalendarClock size={32} aria-hidden="true"/><h3>Plan work with clear limits</h3><p>Inspect a schedule to review its next run, authorization and history.</p><p className="hint">One-time tasks and elapsed-minute intervals are supported. A schedule does not send notifications.</p></div>}
      </div>
    </div>
  </div>;
}
