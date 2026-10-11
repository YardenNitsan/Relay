import {useLayoutEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Check,ChevronRight,Search,Workflow} from 'lucide-react';
import type {AssistantCatalog,AssistantId} from '../../../shared/assistants';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';
import {AgentInspector} from './AgentInspector';
import {agentIcons,capabilityLabel,matchesSearch} from './presentation';
import './agents.css';
export interface AgentStudioProps {selected?:AssistantId;onSelect:(id:AssistantId|undefined)=>Promise<void>;onWorkspace?:()=>void;workspaceSelected?:boolean}
export default function AgentStudio({selected,onSelect,onWorkspace,workspaceSelected=false}:AgentStudioProps){
  const catalog=useQuery({queryKey:['assistants'],queryFn:({signal})=>api<AssistantCatalog>('/assistants',{signal}),staleTime:15_000});
  const [inspected,setInspected]=useState<AssistantId|null>(selected??null),[showDetail,setShowDetail]=useState(false),[query,setQuery]=useState('');
  const [preparing,setPreparing]=useState<AssistantId|'general'|null>(null),[error,setError]=useState<unknown>(null),[failed,setFailed]=useState<AssistantId|'general'|null>(null);
  const lock=useRef(false),indexRef=useRef<HTMLDivElement>(null),detailRef=useRef<HTMLDivElement>(null),headingRef=useRef<HTMLHeadingElement>(null),searchRef=useRef<HTMLInputElement>(null);
  const rows=useRef(new Map<AssistantId,HTMLButtonElement>()),focusTarget=useRef<'heading'|'row'|null>(null);
  const indexScroll=useRef<HTMLDivElement>(null),narrowScroll=useRef(0),paneFocus=useRef<HTMLElement|null>(null);
  useModalDraftGuard({dirty:false,busy:preparing!=null,label:'Agent preparation'});
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
  const inspect=(id:AssistantId)=>{focusTarget.current='heading';setInspected(id);setShowDetail(true);if(id===inspected&&showDetail)headingRef.current?.focus({preventScroll:true});};
  const back=()=>{focusTarget.current='row';setShowDetail(false);};
  const select=async(id:AssistantId|undefined)=>{
    if(lock.current)return;lock.current=true;setPreparing(id??'general');setError(null);setFailed(null);
    try{await onSelect(id);}catch(caught){setError(caught);setFailed(id??'general');}finally{lock.current=false;setPreparing(null);}
  };
  const agent=catalog.data?.assistants.find(item=>item.id===inspected),matches=catalog.data?.assistants.filter(item=>matchesSearch(item,query))??[];
  return <div className={`agent-studio ${showDetail&&agent?'agent-show-detail':''}`}>
    <div className="agent-studio-intro"><p>Choose an approach for your next objective.</p><p className="hint">Model, compute depth and computer access stay separate.</p></div>
    {preparing&&<p className="agent-preparing" role="status">Preparing your agent and file scope…</p>}
    <div className="agent-studio-workspace" onFocusCapture={event=>{paneFocus.current=event.target;}}>
      <div className="agent-index" ref={indexRef}>
        <div className="agent-index-search"><label htmlFor="agent-role-search">Search roles and tools</label><div><Search size={17} aria-hidden="true"/><input ref={searchRef} id="agent-role-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Role or tool"/></div></div>
        <div className="agent-index-scroll" ref={indexScroll} onScroll={event=>{if(window.matchMedia('(max-width: 899px)').matches&&event.currentTarget.getClientRects().length)narrowScroll.current=event.currentTarget.scrollTop;}}>
          <button className="agent-general-choice" aria-pressed={!selected} disabled={preparing!=null} onClick={()=>{void select(undefined);}}><Workflow size={21} aria-hidden="true"/><span><strong>General orchestration</strong><small>Work across available capabilities</small></span>{!selected&&<Check size={17} aria-hidden="true"/>}</button>
          {error!=null&&failed==='general'&&<ErrorNotice error={error}/>}
          <div className="agent-index-heading"><h3>Specialists</h3><span aria-live="polite">{catalog.data?`${matches.length} of ${catalog.data.assistants.length}`:''}</span></div>
          {catalog.isPending?<Loading>Checking available agent capabilities…</Loading>:catalog.isError?<><ErrorNotice error={catalog.error}/><button className="button" onClick={()=>{void catalog.refetch();}}>Retry agent capabilities</button></>:matches.length?<ul className="agent-role-list">{matches.map(item=>{
            const Icon=agentIcons[item.id];return <li key={item.id}><button ref={node=>{if(node)rows.current.set(item.id,node);else rows.current.delete(item.id);}} className="agent-role-row" aria-label={`Inspect ${item.name} agent`} aria-current={inspected===item.id?'true':undefined} disabled={preparing!=null} onClick={()=>inspect(item.id)}><Icon size={20} aria-hidden="true"/><span><strong>{item.name}{selected===item.id&&<span className="agent-row-selected">Selected</span>}</strong><small>{capabilityLabel(item)}</small></span><ChevronRight size={16} aria-hidden="true"/></button></li>;
          })}</ul>:<div className="agent-empty-search"><h4>No matching specialists</h4><p>Try a role name or a tool, such as files or calendar.</p><button className="text-button" onClick={()=>{setQuery('');searchRef.current?.focus();}}>Clear search</button></div>}
        </div>
      </div>
      <div className="agent-detail" ref={detailRef}>{agent?<AgentInspector key={agent.id} agent={agent} selected={selected===agent.id} busy={preparing!=null} preparing={preparing===agent.id} error={failed===agent.id?error:null} workspaceSelected={workspaceSelected} onSelect={()=>{void select(agent.id);}} onWorkspace={onWorkspace} onBack={back} headingRef={headingRef}/>:<div className="agent-detail-empty"><Workflow size={32} aria-hidden="true"/><h3>A focused approach, the same controls</h3><p>Inspect a specialist to see its role, tools and current limits.</p><p className="hint">A specialist defines an approach. It does not connect accounts, choose your model or grant computer access.</p></div>}</div>
    </div>
  </div>;
}
