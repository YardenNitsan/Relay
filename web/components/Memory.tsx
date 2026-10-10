import {useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {Workspace} from '../../shared/types';
import {api,downloadText} from '../api';
import {Empty,ErrorNotice,Loading} from './ui';

interface Note {id:string;workspaceId:string|null;title:string;content:string;enabled:boolean;revision:number;updatedAt:string;}
const blank={title:'',content:'',workspaceId:null as string|null,enabled:true};
export default function Memory({workspaces}:{workspaces:Workspace[]}){
  const client=useQueryClient(),notes=useQuery({queryKey:['memory'],queryFn:({signal})=>api<Note[]>('/memory',{signal})});
  const [draft,setDraft]=useState({...blank}),[editing,setEditing]=useState<Note|null>(null),[approved,setApproved]=useState(false),[deleting,setDeleting]=useState<string|null>(null);
  const [message,setMessage]=useState('');
  const changed=()=>{void client.invalidateQueries({queryKey:['memory']});};
  const save=useMutation({mutationFn:()=>editing?api(`/memory/${editing.id}`,{method:'PUT',body:{title:draft.title,content:draft.content,enabled:draft.enabled,revision:editing.revision,confirm:true}}):api('/memory',{method:'POST',body:{...draft,confirm:true}}),onSuccess:()=>{setDraft({...blank});setEditing(null);setApproved(false);setMessage(draft.enabled?'Memory saved. It can be used as context in future tasks.':'Memory saved and disabled for future tasks.');changed();}});
  const update=useMutation({mutationFn:(note:Note)=>api(`/memory/${note.id}`,{method:'PUT',body:{title:note.title,content:note.content,enabled:!note.enabled,revision:note.revision,confirm:true}}),onSuccess:()=>{setMessage('Memory preference updated.');changed();}});
  const remove=useMutation({mutationFn:(note:Note)=>api(`/memory/${note.id}`,{method:'DELETE',body:{revision:note.revision}}),onSuccess:()=>{setDeleting(null);setMessage('Memory deleted. Earlier task records and backups are unchanged.');changed();}});
  const exportNotes=useMutation({mutationFn:()=>api('/memory/export'),onSuccess:data=>downloadText('relay-memory.json',JSON.stringify(data,null,2))});
  const busy=save.isPending||update.isPending||remove.isPending;
  return <div className="memory-panel"><div className="section-intro"><p>Knowledge you choose to keep.</p><p className="muted">Save project facts or personal preferences for future tasks. Only your account can use these notes. They are context, never permission to act.</p></div>
    <form className="memory-form" onSubmit={event=>{event.preventDefault();if(approved)save.mutate();}}><h3>{editing?'Edit memory':'Add memory'}</h3>
      <label>Scope<select value={draft.workspaceId??''} disabled={busy||!!editing} onChange={event=>{setApproved(false);setDraft({...draft,workspaceId:event.target.value||null});}}><option value="">Personal preference</option>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      <label>Title<input maxLength={120} required value={draft.title} disabled={busy} onChange={event=>{setApproved(false);setDraft({...draft,title:event.target.value});}}/></label>
      <label>What should Relay remember?<textarea maxLength={4096} rows={5} required value={draft.content} disabled={busy} onChange={event=>{setApproved(false);setDraft({...draft,content:event.target.value});}}/></label>
      <p className="hint">Enabled notes may be sent to a cloud model when you separately allow cloud context for a task. Keep passwords and API keys out of memory.</p>
      <label className="check-label"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/>I approve saving this memory for my future tasks</label>
      <div className="button-row"><button className="button primary" disabled={!approved||busy||!draft.title.trim()||!draft.content.trim()}>{save.isPending?'Saving…':'Save approved memory'}</button>{editing&&<button className="button subtle" type="button" disabled={busy} onClick={()=>{setEditing(null);setDraft({...blank});setApproved(false);}}>Cancel edit</button>}</div>
    </form>
    {message&&<p role="status">{message}</p>}
    <div className="section-heading"><h3>Your saved memory</h3><button className="text-button" disabled={exportNotes.isPending||!notes.data?.length} onClick={()=>exportNotes.mutate()}>Export JSON</button></div>
    {notes.isPending?<Loading>Reading your memory…</Loading>:notes.data?.length?<div className="memory-list">{notes.data.map(note=><article className="memory-note" key={note.id}><h4>{note.title}</h4><p className="hint">{note.workspaceId?workspaces.find(workspace=>workspace.id===note.workspaceId)?.name??'Project':'Personal preference'}</p><p className="memory-content">{note.content}</p><div className="button-row"><label className="check-label"><input type="checkbox" aria-label={`Use ${note.title} in future tasks`} checked={note.enabled} disabled={busy||!!editing} onChange={()=>update.mutate(note)}/>Use in future tasks</label><button className="text-button" disabled={busy||!!editing} onClick={()=>{setEditing(note);setDraft({title:note.title,content:note.content,workspaceId:note.workspaceId,enabled:note.enabled});setApproved(false);}}>Edit</button>{deleting===note.id?<><button className="button danger-button" disabled={busy} onClick={()=>remove.mutate(note)}>Delete permanently</button><button className="text-button" onClick={()=>setDeleting(null)}>Keep memory</button></>:<button className="text-button" disabled={busy||!!editing} onClick={()=>setDeleting(note.id)}>Delete</button>}</div></article>)}</div>:!notes.isError&&<Empty title="No saved memory"><p>Add a verified project fact or a preference above. Nothing is remembered automatically.</p></Empty>}
    {(notes.isError||save.isError||update.isError||remove.isError||exportNotes.isError)&&<ErrorNotice error={notes.error??save.error??update.error??remove.error??exportNotes.error}/>}
  </div>;
}
