import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowLeft,ArrowUpRight,Check,Inbox,Search} from 'lucide-react';
import type {TaskFeedPage,TaskSummary} from '../../../shared/task-feed';
import type {TaskDetail,TaskRecord} from '../../../shared/types';
import {getAssistantDefinition} from '../../../shared/assistants';
import {api,errorMessage} from '../../api';
import {useRememberedFocus} from '../../layout/useRememberedFocus';
import {Loading} from '../../components/ui';
import './dispatch.css';

const label=(value:string)=>value.replaceAll('_',' ').replace(/^./,value=>value.toUpperCase());
const date=(value:string)=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
export default function DispatchBoard({onNew,onOpen,removedConversation}:{removedConversation:string|null;onNew:()=>void;onOpen:(task:TaskRecord)=>void}){
  const [cursor,setCursor]=useState<string|null>(null),[previous,setPrevious]=useState<(string|null)[]>([]);
  const [search,setSearch]=useState(''),[selected,setSelected]=useState<TaskSummary|null>(null);
  const feed=useQuery({queryKey:['task-feed',cursor],queryFn:({signal})=>api<TaskFeedPage>(`/tasks?limit=40${cursor?`&before=${encodeURIComponent(cursor)}`:''}`,{signal}),retry:false});
  useEffect(()=>{if(selected?.conversationId===removedConversation)setSelected(null);},[removedConversation,selected]);
  const items=(feed.data?.items??[]).filter(task=>task.objective.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  function back(){const id=selected?.id;setSelected(null);requestAnimationFrame(()=>(document.getElementById(`dispatch-${id}`)??document.getElementById('dispatch-search'))?.focus());}
  return <main id="dispatch" className={`dispatch ${selected?'dispatch-inspecting':''}`}>
    <header className="dispatch-intro"><div><span className="dispatch-eyebrow">RELAY / YOUR WORK</span><h1>Your work,<br/>moving forward.</h1><p>Follow the work. Review the evidence. Decide what happens next.</p></div><button className="dispatch-start" onClick={onNew}>Start something<ArrowUpRight size={21}/></button></header>
    <div className="dispatch-body"><section className="dispatch-inbox" aria-label="Your tasks"><div className="dispatch-section-title"><h2>Task inbox</h2><span>{feed.data?`${feed.data.items.length} on this page`:'Account activity'}</span></div>
      {feed.isPending&&<Loading>Loading your tasks…</Loading>}{feed.isError&&<div className="dispatch-error" role="alert"><p>{errorMessage(feed.error)}</p><button className="text-button" onClick={()=>void feed.refetch()}>Try again</button></div>}{feed.data&&<>
        <label className="dispatch-search"><Search size={17}/><input id="dispatch-search" type="search" aria-label="Search this task page" placeholder="Find work on this page" value={search} onChange={event=>setSearch(event.target.value)}/></label>
        {items.length?<ol className="dispatch-tasks">{items.map(task=><li key={task.id}><button id={`dispatch-${task.id}`} aria-label={`Inspect task: ${task.objective}`} aria-current={selected?.id===task.id?'true':undefined} onClick={()=>setSelected(task)}><span className={`dispatch-task-mark status-${task.status}`} aria-hidden="true">{task.status==='completed'?<Check size={17}/>:<span/>}</span><span className="dispatch-task-copy"><span className="dispatch-task-meta">{(getAssistantDefinition(task.assistantId??undefined)?.name??'Relay')}<span>·</span><time dateTime={task.createdAt}>{date(task.createdAt)}</time></span><strong>{task.objective}{task.objectiveTruncated?'…':''}</strong><span className={`dispatch-status status-${task.status}`}>{label(task.status)}</span></span><ArrowUpRight size={18}/></button></li>)}</ol>:<div className="dispatch-empty"><Inbox size={32}/><h3>{search?'No matching work':'A clear space for your next idea.'}</h3><p>{search?'Search applies to the tasks on this page.':'Start a conversation to give Relay an objective. Its execution and evidence will appear here.'}</p>{!search&&<button className="text-button" onClick={onNew}>Create a conversation</button>}</div>}
        <div className="dispatch-pagination"><button disabled={!previous.length} onClick={()=>{setCursor(previous.at(-1)??null);setPrevious(previous.slice(0,-1));setSearch('');}}>Newer tasks</button><button disabled={!feed.data.nextCursor} onClick={()=>{setPrevious([...previous,cursor]);setCursor(feed.data?.nextCursor??null);setSearch('');}}>Older tasks</button></div>
      </>}
    </section>{selected?<TaskFocus id={selected.id} onBack={back} onOpen={onOpen}/>:<aside className="dispatch-guide"><span className="dispatch-eyebrow">FROM INTENT TO EVIDENCE</span><h2>Good work leaves<br/>a clear trail.</h2><p>Select a task to see its plan, agent activity and verification. Decisions stay connected to the work they affect.</p><div><span>01</span><p><strong>Give it an objective</strong>Choose the right agent and permitted project.</p></div><div><span>02</span><p><strong>Stay close to the work</strong>Inspect actual stages and requested actions.</p></div><div><span>03</span><p><strong>Review the outcome</strong>Read recorded checks before accepting the result.</p></div></aside>}</div>
  </main>;
}
function TaskFocus({id,onBack,onOpen}:{id:string;onBack:()=>void;onOpen:(task:TaskRecord)=>void}){
  const region=useRef<HTMLElement>(null),lastFocus=useRememberedFocus();
  useLayoutEffect(()=>{region.current?.focus();},[id]);
  useEffect(()=>{const narrow=matchMedia('(max-width:900px)');const changed=()=>{const active=document.activeElement===document.body?lastFocus.current:document.activeElement;if(narrow.matches&&active?.closest('.dispatch-inbox,.dispatch-intro'))region.current?.focus();};narrow.addEventListener('change',changed);return()=>narrow.removeEventListener('change',changed);},[lastFocus]);
  const detail=useQuery({queryKey:['task',id],queryFn:({signal})=>api<TaskDetail>(`/tasks/${encodeURIComponent(id)}`,{signal}),retry:false});
  const data=detail.data;
  return <section ref={region} tabIndex={-1} className="dispatch-focus" aria-label="Selected task"><button className="dispatch-back" onClick={onBack}><ArrowLeft size={18}/>Back to tasks</button>{detail.isPending&&<Loading>Opening task evidence…</Loading>}{detail.isError&&<div role="alert"><p>{errorMessage(detail.error)}</p><button onClick={()=>void detail.refetch()}>Try again</button></div>}{data&&<>
    <span className={`dispatch-status status-${data.task.status}`}>{label(data.task.status)}</span><h2>{data.task.objective}</h2><p className="dispatch-detail-meta">Updated {date(data.task.updatedAt)} · {data.task.callsUsed} model calls recorded</p>
    {data.task.status==='waiting_for_approval'&&<p className="dispatch-decision">A decision is waiting. Open execution to inspect its exact scope and consequences.</p>}
    {data.task.error&&<p className="dispatch-error">{data.task.error}</p>}
    <button className="dispatch-open" onClick={()=>onOpen(data.task)}>Open execution<ArrowUpRight size={19}/></button>
    <h3>Execution trail</h3>{data.steps.length?<ol className="dispatch-trail">{data.steps.map(step=><li key={step.id}><span className={`dispatch-status status-${step.status}`}>{label(step.status)}</span><strong>{step.title}</strong><span>{label(step.role)}{step.modelId?` · ${step.modelId}`:''}</span></li>)}</ol>:<p>No execution stages recorded yet.</p>}
    <h3>Verification</h3>{data.verification.length?<ul className="dispatch-verification">{data.verification.map(check=><li key={check.id}><strong>{check.passed?'Passed':'Failed'} · {check.kind}</strong><p>{check.summary}</p></li>)}</ul>:<p>No verification receipts recorded.</p>}
    <p className="dispatch-detail-meta">Open execution for tool requests, approvals, changes and the full work log.</p>
  </>}</section>;
}
