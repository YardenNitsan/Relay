import {useLayoutEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Check,ChevronRight,Search,Workflow} from 'lucide-react';
import {getAssistantDefinition,type AssistantCatalog,type AssistantId} from '../../../shared/assistants';
import type {TaskFeedPage} from '../../../shared/task-feed';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';
import {AgentInspector} from './AgentInspector';
import {AgentWork} from './AgentWork';
import {agentIcons,capabilityLabel,matchesSearch} from './presentation';
import './agents.css';
export interface AgentStudioProps {selected?:AssistantId;onSelect:(id:AssistantId|undefined)=>Promise<void>;onWorkspace?:()=>void;workspaceSelected?:boolean;onOpenTask?:(taskId:string)=>Promise<void>}
export default function AgentStudio({selected,onSelect,onWorkspace,workspaceSelected=false,onOpenTask}:AgentStudioProps){
  const catalog=useQuery({queryKey:['assistants'],queryFn:({signal})=>api<AssistantCatalog>('/assistants',{signal}),staleTime:15_000});
  const work=useQuery({queryKey:['task-feed',null],queryFn:({signal})=>api<TaskFeedPage>('/tasks?limit=40',{signal}),staleTime:15_000,retry:false});
  const [mode,setMode]=useState<'specialists'|'work'>('specialists');
  const [openingTask,setOpeningTask]=useState<string|null>(null),[openError,setOpenError]=useState<unknown>(null);
  const [inspected,setInspected]=useState<AssistantId|null>(selected??null),[showDetail,setShowDetail]=useState(false),[query,setQuery]=useState('');
  const [preparing,setPreparing]=useState<AssistantId|'general'|null>(null),[error,setError]=useState<unknown>(null),[failed,setFailed]=useState<AssistantId|'general'|null>(null);
  const lock=useRef(false),indexRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null),headingRef=useRef<HTMLHeadingElement>(null),searchRef=useRef<HTMLInputElement>(null);
  const rows=useRef(new Map<AssistantId,HTMLButtonElement>()),focusTarget=useRef<'heading'|'row'|null>(null);
  const indexScroll=useRef<HTMLDivElement>(null),narrowScroll=useRef(0),paneFocus=useRef<HTMLElement|null>(null);
  const workFilter=useRef<HTMLSelectElement>(null),focusWork=useRef(false);
  const busy=preparing!=null||openingTask!=null;
  useModalDraftGuard({dirty:false,busy,label:openingTask?'Opening task':'Agent preparation'});
  useLayoutEffect(()=>{
    const media=window.matchMedia('(max-width: 899px)');
    let frame=0;
    const changed=()=>{if(media.matches){
      const active=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:paneFocus.current;
      if(indexRef.current?.contains(active))setShowDetail(false);else if(detailRef.current?.contains(active))setShowDetail(true);
      frame=requestAnimationFrame(()=>{if(indexScroll.current)indexScroll.current.scrollTop=narrowScroll.current;if(active?.isConnected&&active.getClientRects().length)active.focus({preventScroll:true});});
    }};
    media.addEventListener('change',changed);return()=>{media.removeEventListener('change',changed);cancelAnimationFrame(frame);};
  },[]);
  useLayoutEffect(()=>{
    if(focusTarget.current==='heading')headingRef.current?.focus({preventScroll:true});
    else if(focusTarget.current==='row')((inspected&&rows.current.get(inspected))||searchRef.current)?.focus({preventScroll:true});
    focusTarget.current=null;
  },[inspected,showDetail]);
  useLayoutEffect(()=>{
    if(mode==='work'&&focusWork.current){workFilter.current?.focus();focusWork.current=false;}
  },[mode]);
  const inspect=(id:AssistantId)=>{focusTarget.current='heading';setInspected(id);setShowDetail(true);if(id===inspected&&showDetail)headingRef.current?.focus({preventScroll:true});};
  const back=()=>{focusTarget.current='row';setShowDetail(false);};
  const select=async(id:AssistantId|undefined)=>{
    if(lock.current)return;lock.current=true;setPreparing(id??'general');setError(null);setFailed(null);
    try{await onSelect(id);}catch(caught){setError(caught);setFailed(id??'general');}finally{lock.current=false;setPreparing(null);}
  };
  const openTask=async(id:string)=>{
    if(lock.current||!onOpenTask)return;lock.current=true;setOpeningTask(id);setOpenError(null);
    try{await onOpenTask(id);}catch(caught){setOpenError(caught);}finally{lock.current=false;setOpeningTask(null);}
  };
  const changeMode=(next:'specialists'|'work',focusContent=false)=>{
    focusWork.current=next==='work'&&focusContent;
    setMode(next);
    if(next==='specialists')requestAnimationFrame(()=>{if(indexScroll.current)indexScroll.current.scrollTop=narrowScroll.current;});
  };
  const agent=catalog.data?.assistants.find(item=>item.id===inspected),matches=catalog.data?.assistants.filter(item=>matchesSearch(item,query))??[];
  const selectedName=getAssistantDefinition(selected)?.name??'General orchestration';
  const workProps={work,busy,openingTask,onOpenTask:onOpenTask?(id:string)=>{void openTask(id);}:undefined};
  return <div className={`agent-studio ${showDetail&&agent?'agent-show-detail':''} ${mode==='work'?'agent-work-mode':''}`}>
    <div className="agent-studio-intro"><div><h3>The right approach for your work.</h3><p>Choose a specialist. Follow the tasks it takes on.</p></div><div className="agent-next-role"><span>For your next objective</span><strong>{selectedName}</strong></div></div>
    <nav className="agent-mode-switch" aria-label="Agent views"><button aria-pressed={mode==='specialists'} disabled={busy} onClick={()=>changeMode('specialists')}>Specialists</button><button aria-pressed={mode==='work'} disabled={busy} onClick={()=>changeMode('work')}>Recent work</button><p>Model and computer access stay separate.</p></nav>
    {preparing&&<p className="agent-preparing" role="status">Preparing your agent and file scope…</p>}
    {openError!=null&&<div className="agent-open-error"><ErrorNotice error={openError}/></div>}
    {mode==='work'?<div className="agent-work-scroll"><AgentWork {...workProps} filterRef={workFilter}/></div>:<div className="agent-studio-workspace" onFocusCapture={event=>{paneFocus.current=event.target;}}>
      <div className="agent-index" ref={indexRef}>
        <div className="agent-index-search"><label htmlFor="agent-role-search">Search roles and tools</label><div><Search size={17} aria-hidden="true"/><input ref={searchRef} id="agent-role-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Role or tool"/></div></div>
        <div className="agent-index-scroll" ref={indexScroll} onScroll={event=>{if(window.matchMedia('(max-width: 899px)').matches&&event.currentTarget.getClientRects().length)narrowScroll.current=event.currentTarget.scrollTop;}}>
          <button className="agent-general-choice" aria-pressed={!selected} disabled={busy} onClick={()=>{void select(undefined);}}><Workflow size={21} aria-hidden="true"/><span><strong>General orchestration</strong><small>Bring several kinds of work into one objective</small></span>{!selected&&<Check size={17} aria-hidden="true"/>}</button>
          {error!=null&&failed==='general'&&<ErrorNotice error={error}/>}
          <div className="agent-index-heading"><h3>Specialists</h3><span aria-live="polite">{catalog.data?`${matches.length} of ${catalog.data.assistants.length}`:''}</span></div>
          {catalog.isError&&<><ErrorNotice error={catalog.error}/><button className="button" onClick={()=>{void catalog.refetch();}}>Retry agent capabilities</button></>}
          {catalog.isPending?<Loading>Checking available agent capabilities…</Loading>:catalog.data&&(matches.length?<ul className="agent-role-list">{matches.map(item=>{
            const Icon=agentIcons[item.id];return <li key={item.id}><button ref={node=>{if(node)rows.current.set(item.id,node);else rows.current.delete(item.id);}} className="agent-role-row" aria-label={`Inspect ${item.name} agent`} aria-current={inspected===item.id?'true':undefined} disabled={busy} onClick={()=>inspect(item.id)}><span className="agent-role-icon"><Icon size={21} aria-hidden="true"/></span><span><strong>{item.name}{selected===item.id&&<span className="agent-row-selected">Selected</span>}</strong><span className="agent-role-purpose">{getAssistantDefinition(item.id)?.capabilities.slice(0,2).join(' · ')}</span><small>{capabilityLabel(item)}</small></span><ChevronRight size={16} aria-hidden="true"/></button></li>;
          })}</ul>:<div className="agent-empty-search"><h4>No matching specialists</h4><p>Try a role name or a tool, such as files or calendar.</p><button className="text-button" onClick={()=>{setQuery('');searchRef.current?.focus();}}>Clear search</button></div>)}
        </div>
      </div>
      <div className="agent-detail" ref={detailRef}>{agent?<AgentInspector key={agent.id} agent={agent} selected={selected===agent.id} busy={busy} preparing={preparing===agent.id} error={failed===agent.id?error:null} workspaceSelected={workspaceSelected} onSelect={()=>{void select(agent.id);}} onWorkspace={onWorkspace} onBack={back} headingRef={headingRef} recentWork={<AgentWork {...workProps} role={agent.id} preview/>}/>:<div className="agent-detail-empty"><div className="agent-directory-note"><Workflow size={27} aria-hidden="true"/><h3>A specialist shapes the approach.</h3><p>Inspect its tools and limits, then choose it for your next objective. Selection does not grant access or start work.</p></div><AgentWork {...workProps} preview onShowAll={()=>changeMode('work',true)}/></div>}</div>
    </div>}
  </div>;
}
