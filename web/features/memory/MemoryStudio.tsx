import {useLayoutEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,ChevronRight,Download,NotebookPen,Plus,RefreshCw,Search} from 'lucide-react';
import type {Workspace} from '../../../shared/types';
import {api,downloadText} from '../../api';
import {ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {NoteEditor} from './NoteEditor';
import {NoteReader} from './NoteReader';
import {blankDraft,draftFrom,scopeName,type Note,type NoteDraft} from './types';
import './memory.css';

export default function MemoryStudio({workspaces}:{workspaces:Workspace[]}){
  const client=useQueryClient(),notes=useQuery({queryKey:['memory'],queryFn:({signal})=>api<Note[]>('/memory',{signal})});
  const [selected,setSelected]=useState<string|null>(null),[mode,setMode]=useState<'read'|'new'|'edit'>('read');
  const [draft,setDraft]=useState<NoteDraft>(blankDraft),[baseline,setBaseline]=useState<Note|null>(null);
  const [approved,setApproved]=useState(false),[deleting,setDeleting]=useState(false),[showDetail,setShowDetail]=useState(false);
  const [query,setQuery]=useState(''),[message,setMessage]=useState('');
  const heading=useRef<HTMLHeadingElement>(null),search=useRef<HTMLInputElement>(null),newButton=useRef<HTMLButtonElement>(null);
  const indexPane=useRef<HTMLDivElement>(null),detailPane=useRef<HTMLDivElement>(null),paneFocus=useRef<HTMLElement|null>(null);
  const rows=useRef(new Map<string,HTMLButtonElement>()),focusTarget=useRef<'heading'|'row'|'new'|null>(null);
  const request=useGuardedModalAction();
  const refresh=()=>{void client.invalidateQueries({queryKey:['memory']});};
  const cacheNote=(note:Note)=>{client.setQueryData<Note[]>(['memory'],current=>[note,...(current??[]).filter(item=>item.id!==note.id)]);refresh();};
  const save=useMutation({mutationFn:({value,original}:{value:NoteDraft;original:Note|null})=>original?
    api<Note>(`/memory/${original.id}`,{method:'PUT',body:{title:value.title,content:value.content,enabled:value.enabled,revision:original.revision,confirm:true}}):
    api<Note>('/memory',{method:'POST',body:{...value,confirm:true}}),onSuccess:note=>{
      cacheNote(note);setSelected(note.id);setMode('read');setBaseline(null);setDraft(blankDraft());setApproved(false);
      setMessage(note.enabled?'Memory saved. It can be used as context in future tasks.':'Memory saved and disabled for future tasks.');
      focusTarget.current='heading';setShowDetail(true);
    }});
  const update=useMutation({mutationFn:(note:Note)=>api<Note>(`/memory/${note.id}`,{method:'PUT',body:{title:note.title,content:note.content,enabled:!note.enabled,revision:note.revision,confirm:true}}),onSuccess:note=>{cacheNote(note);setMessage('Memory preference updated.');}});
  const remove=useMutation({mutationFn:(note:Note)=>api(`/memory/${note.id}`,{method:'DELETE',body:{revision:note.revision}}),onSuccess:(_data,note)=>{
    client.setQueryData<Note[]>(['memory'],current=>(current??[]).filter(item=>item.id!==note.id));refresh();
    setSelected(null);setDeleting(false);setShowDetail(false);setMessage('Memory deleted. Earlier task records and backups are unchanged.');focusTarget.current='new';
  }});
  const exportNotes=useMutation({mutationFn:()=>api('/memory/export'),onSuccess:data=>downloadText('relay-memory.json',JSON.stringify(data,null,2))});
  const busy=save.isPending||update.isPending||remove.isPending||exportNotes.isPending;
  const original=baseline?draftFrom(baseline):blankDraft();
  const dirty=mode!=='read'&&(draft.title!==original.title||draft.content!==original.content||draft.enabled!==original.enabled||draft.workspaceId!==original.workspaceId);
  useModalDraftGuard({dirty,busy,label:baseline?.title??'new memory'});
  useLayoutEffect(()=>{
    if(focusTarget.current==='heading')heading.current?.focus({preventScroll:true});
    else if(focusTarget.current==='row')((selected&&rows.current.get(selected))||search.current)?.focus({preventScroll:true});
    else if(focusTarget.current==='new')newButton.current?.focus({preventScroll:true});
    focusTarget.current=null;
  },[selected,mode,showDetail]);
  useLayoutEffect(()=>{
    const media=window.matchMedia('(max-width: 899px)');let frame=0;
    const changed=()=>{
      if(!media.matches)return;
      const active=document.activeElement instanceof HTMLElement&&document.activeElement!==document.body?document.activeElement:paneFocus.current;
      if(indexPane.current?.contains(active))setShowDetail(false);
      else if(detailPane.current?.contains(active))setShowDetail(true);
      frame=requestAnimationFrame(()=>{if(active?.isConnected&&active.getClientRects().length)active.focus({preventScroll:true});});
    };
    media.addEventListener('change',changed);return()=>{media.removeEventListener('change',changed);cancelAnimationFrame(frame);};
  },[]);
  const clearEditor=()=>{setBaseline(null);setDraft(blankDraft());setApproved(false);setDeleting(false);save.reset();update.reset();remove.reset();};
  const inspect=(id:string)=>{
    if(id===selected){focusTarget.current='heading';setShowDetail(true);if(showDetail)heading.current?.focus({preventScroll:true});return;}
    request(()=>{clearEditor();setMode('read');setSelected(id);focusTarget.current='heading';setShowDetail(true);});
  };
  const create=()=>{
    if(mode==='new'){focusTarget.current='heading';setShowDetail(true);if(showDetail)heading.current?.focus({preventScroll:true});return;}
    request(()=>{clearEditor();setSelected(null);setMode('new');focusTarget.current='heading';setShowDetail(true);});
  };
  const back=()=>request(()=>{clearEditor();setMode('read');focusTarget.current=selected?'row':'new';setShowDetail(false);});
  const cancel=()=>request(()=>{clearEditor();setMode('read');focusTarget.current=selected?'heading':'new';if(!selected)setShowDetail(false);});
  const selectedNote=notes.data?.find(note=>note.id===selected);
  const edit=(note:Note)=>{clearEditor();setBaseline({...note});setDraft(draftFrom(note));setMode('edit');focusTarget.current='heading';};
  const filtered=(notes.data??[]).filter(note=>`${note.title}\n${note.content}\n${scopeName(note,workspaces)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className={`memory-studio dispatch-memory ${showDetail?'memory-show-detail':''}`}>
    <div className="memory-studio-intro"><p>A notebook for future tasks.</p><p className="hint">Save the context you choose. Notes belong to your account and never grant permission to act.</p></div>
    {message&&<p className="memory-feedback" role="status">{message}</p>}
    <div className="memory-notebook" onFocusCapture={event=>{paneFocus.current=event.target;}}>
      <div ref={indexPane} className="memory-index">
        <div className="memory-index-toolbar"><div><h3>Saved notes</h3><span>{notes.data?.length??0}</span></div><button ref={newButton} className="button primary" disabled={busy} onClick={create}><Plus size={17} aria-hidden="true"/>New memory</button></div>
        <div className="memory-index-search"><label htmlFor="memory-note-search">Search notes</label><div><Search size={17} aria-hidden="true"/><input ref={search} id="memory-note-search" type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Title, content or scope"/></div></div>
        <div className="memory-index-scroll">
          {notes.isPending&&<Loading>Reading your memory…</Loading>}
          {notes.isError&&<ErrorNotice error={notes.error} retry={()=>{void notes.refetch();}}/>}
          {filtered.length?<ul className="memory-index-list">{filtered.map(note=><li key={note.id}><button ref={node=>{if(node)rows.current.set(note.id,node);else rows.current.delete(note.id);}} aria-label={`Open ${note.title}`} aria-current={selected===note.id?'true':undefined} disabled={busy} onClick={()=>inspect(note.id)}><span><strong dir="auto">{note.title}</strong><span className="memory-row-excerpt" dir="auto">{note.content}</span><span className="memory-row-meta"><span className="memory-row-scope" dir="auto">{scopeName(note,workspaces)}</span><small data-enabled={note.enabled}>{note.enabled?'Enabled':'Disabled'}</small></span></span><ChevronRight size={17} aria-hidden="true"/></button></li>)}</ul>:
            !notes.isPending&&!notes.isError&&<div className="memory-index-empty"><NotebookPen size={28} aria-hidden="true"/><h4>{query?'No matching notes':'Your notebook starts here'}</h4><p>{query?'Try another title, phrase or scope.':'Add a preference or project fact you want to keep. Nothing is remembered automatically.'}</p>{query&&<button className="text-button" onClick={()=>{setQuery('');search.current?.focus();}}>Clear search</button>}</div>}
        </div>
        <div className="memory-index-footer"><button className="text-button" disabled={busy||notes.isFetching} onClick={()=>{void notes.refetch();}}><RefreshCw size={16} aria-hidden="true"/>Refresh notes</button><button className="text-button" disabled={busy||!notes.data?.length} onClick={()=>exportNotes.mutate()}><Download size={16} aria-hidden="true"/>Export JSON</button>{exportNotes.isError&&<ErrorNotice error={exportNotes.error}/>}</div>
      </div>
      <div ref={detailPane} className="memory-document">
        <div className="memory-detail-navigation"><button className="text-button" disabled={busy} onClick={back}><ArrowLeft size={17} aria-hidden="true"/>All notes</button></div>
        {mode!=='read'?<NoteEditor draft={draft} baseline={baseline} workspaces={workspaces} approved={approved} busy={busy} saving={save.isPending} changedElsewhere={Boolean(baseline&&selectedNote&&baseline.revision!==selectedNote.revision)} error={save.error} headingRef={heading} onChange={value=>{setDraft(value);setApproved(false);}} onApprove={setApproved} onSave={()=>save.mutate({value:{...draft},original:baseline})} onCancel={cancel}/>:
          selectedNote?<NoteReader note={selectedNote} workspaces={workspaces} busy={busy} deleting={deleting} removing={remove.isPending} error={update.error??remove.error} headingRef={heading} onEdit={()=>edit(selectedNote)} onToggle={()=>update.mutate(selectedNote)} onDelete={()=>setDeleting(true)} onKeep={()=>setDeleting(false)} onConfirmDelete={()=>remove.mutate(selectedNote)}/>:
            <div className="memory-document-empty"><NotebookPen size={32} aria-hidden="true"/><h3>Keep useful context close.</h3><p>Open a note to read it, choose whether future tasks can use it, or make an approved edit.</p><p className="hint">A note records what you saved. It is not a verified source.</p></div>}
      </div>
    </div>
  </div>;
}
