import {useState,type RefObject} from 'react';
import type {UseQueryResult} from '@tanstack/react-query';
import {ArrowUpRight,Clock3,RefreshCw} from 'lucide-react';
import {assistantDefinitions,getAssistantDefinition,type AssistantId} from '../../../shared/assistants';
import type {TaskFeedPage,TaskSummary} from '../../../shared/task-feed';
import {ErrorNotice,Loading} from '../../components/ui';

interface Props {
  work:UseQueryResult<TaskFeedPage,Error>;
  role?:AssistantId;
  preview?:boolean;
  busy:boolean;
  openingTask:string|null;
  onOpenTask?: (id:string)=>void;
  onShowAll?:()=>void;
  filterRef?:RefObject<HTMLSelectElement|null>;
}

function taskStatus(status:TaskSummary['status']) {
  return status.replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
}
function updatedAt(value:string) {
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'Update time unavailable':new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date);
}

/** A view of the account's bounded task page, never an agent's availability or model quality. */
export function AgentWork({work,role,preview=false,busy,openingTask,onOpenTask,onShowAll,filterRef}:Props) {
  const [filter,setFilter]=useState('all');
  const name=getAssistantDefinition(role)?.name;
  const items=work.data?.items??[];
  const filtered=items.filter(task=>role?task.assistantId===role:filter==='all'||(filter==='general'?task.assistantId===null:task.assistantId===filter));
  const visible=preview?filtered.slice(0,4):filtered;
  return <section className={`agent-work ${preview?'agent-work-preview':''}`} aria-label={name?`Recent ${name} work`:'Recent agent work'}>
    <header className="agent-work-heading"><div><h4>{name?'Recent work with this specialist':'Work already in motion'}</h4><p>{work.data?`${items.length} tasks loaded from the latest account page`:'Your account’s recent objectives'}</p></div><button className="icon-button" aria-label="Refresh recent work" disabled={work.isFetching||busy} onClick={()=>{void work.refetch();}}><RefreshCw size={17} aria-hidden="true"/></button></header>
    {!preview&&!role&&<label className="agent-work-filter">Filter work by specialist<select ref={filterRef} value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">All specialists and general</option><option value="general">General orchestration</option>{assistantDefinitions.map(profile=><option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}
    {work.isPending&&<Loading>Loading recent agent work…</Loading>}
    {work.isError&&<ErrorNotice error={work.error}/>}
    {work.data&&(visible.length?<ol className="agent-work-list">{visible.map(task=>{
      const owner=getAssistantDefinition(task.assistantId??undefined)?.name??'General orchestration';
      const summary=<><span className="agent-work-meta"><span>{owner}</span><time dateTime={task.updatedAt}>{updatedAt(task.updatedAt)}</time></span><strong>{task.objective}{task.objectiveTruncated?'…':''}</strong><span className={`agent-work-status agent-task-${task.status}`}>{taskStatus(task.status)}</span></>;
      return <li key={task.id}>{onOpenTask?<button className="agent-work-task" disabled={busy} onClick={()=>onOpenTask(task.id)} aria-label={`Open task: ${task.objective}`}><span>{summary}</span><ArrowUpRight size={17} aria-hidden="true"/>{openingTask===task.id&&<span className="agent-work-opening" role="status">Opening…</span>}</button>:<div className="agent-work-task agent-work-static"><span>{summary}</span></div>}</li>;
    })}</ol>:<div className="agent-work-empty"><Clock3 size={23} aria-hidden="true"/><p>{role?'No tasks for this specialist on the loaded page.':filter==='all'?'Your tasks will appear here after you start an objective.':'No tasks for this role on the loaded page.'}</p></div>)}
    {work.data&&<p className="agent-work-scope">{preview&&filtered.length>visible.length?`Showing ${visible.length} of ${filtered.length} matching tasks on this page. `:''}Statuses describe recorded tasks, not a specialist’s readiness.{work.data.nextCursor?' Older tasks may not appear here.':''}</p>}
    {onShowAll&&<button className="text-button agent-work-show-all" onClick={onShowAll} disabled={busy}>See all recent work<ArrowUpRight size={16} aria-hidden="true"/></button>}
  </section>;
}
