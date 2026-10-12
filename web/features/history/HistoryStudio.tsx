import {useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,ArrowRight,History as HistoryIcon,MessageSquare,Plus,RefreshCw,Search} from 'lucide-react';
import type {Conversation} from '../../../shared/types';
import type {HistoryPage} from '../../../shared/history';
import {api} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {HistoryTimeline,type HistoryItem} from './HistoryTimeline';
import {DeleteConversation} from './DeleteConversation';
import './history.css';

interface Props {selected:string|null;onSelect:(conversationId:string,messageId?:string)=>void;onNew:()=>void;onDeleted:(conversationId:string)=>void}
type Criteria={scope:'conversations'|'messages';q:string};
type FocusTarget={kind:'results'}|{kind:'search'}|{kind:'delete';id:string};

export default function HistoryStudio({selected,onSelect,onNew,onDeleted}:Props){
  const client=useQueryClient(),request=useGuardedModalAction();
  const [draft,setDraft]=useState(''),[criteria,setCriteria]=useState<Criteria>({scope:'conversations',q:''});
  const [cursors,setCursors]=useState<Array<string|null>>([null]);
  const [pendingDelete,setPendingDelete]=useState<Pick<Conversation,'id'|'title'>|null>(null);
  const [deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState<unknown>(null),[notice,setNotice]=useState('');
  const lock=useRef(false),cancelRef=useRef<HTMLButtonElement>(null),searchRef=useRef<HTMLInputElement>(null),resultsHeading=useRef<HTMLHeadingElement>(null);
  const scroll=useRef<HTMLDivElement>(null),deleteButtons=useRef(new Map<string,HTMLButtonElement>()),focusTarget=useRef<FocusTarget|null>(null);
  const cursor=cursors.at(-1),parameters=new URLSearchParams({limit:'40'});
  if(criteria.q)parameters.set('q',criteria.q);
  if(cursor)parameters.set('before',cursor);
  const searchable=criteria.scope==='conversations'||Boolean(criteria.q);
  const query=useQuery({queryKey:['history',criteria.scope,criteria.q,cursor],queryFn:({signal})=>api<HistoryPage<HistoryItem>>(`/history/${criteria.scope==='conversations'?'conversations':'search'}?${parameters}`,{signal}),enabled:searchable,staleTime:0});
  // Search text is a transient filter, not a saved document. Only an in-flight
  // destructive request blocks dismissal; cancelling its review remains easy.
  useModalDraftGuard({dirty:false,busy:deleting,label:'Conversation deletion'});
  useLayoutEffect(()=>{
    if(pendingDelete)cancelRef.current?.focus();
  },[pendingDelete]);
  useLayoutEffect(()=>{
    if(pendingDelete)return;
    if(deleting||!focusTarget.current)return;
    if(focusTarget.current.kind==='results'){
      if(searchable&&query.isPending)return;
      if(scroll.current)scroll.current.scrollTop=0;
      resultsHeading.current?.focus({preventScroll:true});
    }else if(focusTarget.current.kind==='search')searchRef.current?.focus({preventScroll:true});
    else (deleteButtons.current.get(focusTarget.current.id)??searchRef.current)?.focus({preventScroll:true});
    focusTarget.current=null;
  },[pendingDelete,deleting,criteria,cursor,query.isPending,query.data,searchable]);
  const update=(scope:Criteria['scope'],q:string)=>{
    if(lock.current)return;
    focusTarget.current={kind:'results'};setCriteria({scope,q});setCursors([null]);
  };
  const cancelDelete=()=>{
    if(lock.current||!pendingDelete)return;
    focusTarget.current={kind:'delete',id:pendingDelete.id};setPendingDelete(null);setDeleteError(null);
  };
  const removeConversation=async()=>{
    if(!pendingDelete||lock.current)return;
    const conversation=pendingDelete;
    lock.current=true;setDeleting(true);setDeleteError(null);
    try{
      await client.cancelQueries({queryKey:['history']});
      await api(`/conversations/${conversation.id}`,{method:'DELETE'});
      // Acknowledgement is authoritative. Do not leave a deleted row available
      // or hold navigation hostage to a subsequent read that may fail.
      client.setQueriesData<HistoryPage<HistoryItem>>({queryKey:['history']},current=>current?{...current,items:current.items.filter(item=>('messageId' in item?item.conversationId:item.id)!==conversation.id)}:current);
      setPendingDelete(null);setCursors([null]);setNotice(`Deleted “${conversation.title}” from history.`);focusTarget.current={kind:'search'};
      void client.invalidateQueries({queryKey:['history']});
      onDeleted(conversation.id);
    }catch(error){setDeleteError(error);}
    finally{lock.current=false;setDeleting(false);}
  };
  const readyItems=query.data?.items??[];
  return <div className="history-studio dispatch-history">
    <div className="history-studio-intro"><div><p className="history-intro-title">Pick up where you left off.</p><p className="hint">Find a conversation or return to an exact saved message.</p></div><button className="button" disabled={deleting||pendingDelete!=null} onClick={()=>request(onNew)}><Plus size={17} aria-hidden="true"/>New</button></div>
    {notice&&<p className="history-studio-notice" role="status">{notice}</p>}
    {pendingDelete&&<DeleteConversation conversation={pendingDelete} busy={deleting} error={deleteError} cancelRef={cancelRef} onCancel={cancelDelete} onDelete={()=>{void removeConversation();}}/>}
    <div className="history-studio-workspace" hidden={pendingDelete!=null}>
      <aside className="history-search-pane" aria-label="History search">
        <form className="history-search-form" onSubmit={event=>{event.preventDefault();update(criteria.scope,draft.trim());}}>
          <label htmlFor="history-search-input">Search history</label><div className="history-search-input"><Search size={18} aria-hidden="true"/><input id="history-search-input" ref={searchRef} autoFocus type="search" value={draft} disabled={deleting} maxLength={240} placeholder={criteria.scope==='conversations'?'Conversation titles':'Saved message content'} onChange={event=>setDraft(event.target.value)}/></div>
          <label htmlFor="history-search-scope">Search in</label><select id="history-search-scope" value={criteria.scope} disabled={deleting} onChange={event=>update(event.target.value as Criteria['scope'],draft.trim())}><option value="conversations">Conversation titles</option><option value="messages">Message content</option></select>
          <button className="button primary" type="submit" disabled={deleting}>Search</button>
        </form>
        <p className="history-search-guidance hint">{criteria.scope==='messages'?'Searches all your saved messages on this host. Use quotes for a phrase, OR for alternatives, or - to exclude a word.':'Newest conversations first. Updates do not change page order.'}</p>
        {criteria.q&&<div className="history-search-applied"><p>Results for <strong dir="auto">{criteria.q}</strong></p><button className="text-button" disabled={deleting} onClick={()=>{setDraft('');update(criteria.scope,'');}}>Clear search</button></div>}
      </aside>
      <section className="history-results-pane" aria-label="Saved history">
        <div className="history-results-toolbar"><div><h3 ref={resultsHeading} tabIndex={-1}>{criteria.scope==='messages'?'Matching messages':'Your conversations'}</h3>{query.data&&searchable&&<p>{readyItems.length} {criteria.scope==='messages'?'messages':'conversations'} on this page</p>}</div><button className="icon-button" aria-label="Refresh history" disabled={deleting||query.isFetching||!searchable} onClick={()=>{void query.refetch();}}><RefreshCw size={18} aria-hidden="true"/></button></div>
        <div className="history-results-scroll" ref={scroll}>
          {query.isError&&searchable&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}
          {!searchable?<div className="history-result-empty"><MessageSquare size={30} aria-hidden="true"/><h4>Find a past message</h4><p>Enter words from a conversation to search beyond recent history.</p></div>:query.isPending?<Loading>Loading history…</Loading>:readyItems.length?<HistoryTimeline items={readyItems} selected={selected} busy={deleting} deleteButtons={deleteButtons.current} onSelect={(id,messageId)=>request(()=>onSelect(id,messageId))} onDelete={conversation=>{setPendingDelete({id:conversation.id,title:conversation.title});setDeleteError(null);setNotice('');}}/>:!query.isError&&<div className="history-result-empty"><HistoryIcon size={30} aria-hidden="true"/><h3>{criteria.q?'No matching history':'A fresh page'}</h3><p>{criteria.q?'Try fewer words or switch between titles and message content.':'Your saved conversations will appear here.'}</p></div>}
        </div>
        {searchable&&(query.data||cursors.length>1)&&<nav className="history-studio-pagination" aria-label="History pages"><button className="button" disabled={deleting||cursors.length===1} onClick={()=>{focusTarget.current={kind:'results'};setCursors(values=>values.slice(0,-1));}}><ArrowLeft size={16} aria-hidden="true"/>Previous</button><span aria-live="polite">Page {cursors.length}</span><button className="button" disabled={deleting||query.isFetching||!query.data?.nextCursor} onClick={()=>{const next=query.data?.nextCursor;if(next){focusTarget.current={kind:'results'};setCursors(values=>[...values,next]);}}}>Next<ArrowRight size={16} aria-hidden="true"/></button></nav>}
      </section>
    </div>
  </div>;
}
