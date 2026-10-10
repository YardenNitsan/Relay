import {useState} from 'react';
import type {Workspace} from '../../../shared/types';
import {mutation} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';

export default function ForkProject({parent,onCreated}:{parent:Workspace;onCreated:(workspace:Workspace)=>Promise<void>}){
  const [name,setName]=useState(`${parent.name} / branch`.slice(0,120));
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  useModalDraftGuard({dirty:false,busy,label:'branch creation'});
  const submit=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy||!name.trim())return;setBusy(true);setError(null);
    try{await onCreated(await mutation<Workspace>(`/workspaces/${parent.id}/fork`,{name:name.trim()}));}
    catch(caught){setError(caught);}finally{setBusy(false);}
  };
  return <form className="project-create" onSubmit={event=>{void submit(event);}}>
    <p className="project-eyebrow">Separate space. Same starting point.</p><h3>Work in an isolated branch</h3>
    <p className="muted">Create a Git branch from the current managed files in <strong>{parent.name}</strong>. Edits stay in a separate workspace on Relay Host.</p>
    <label>Branch workspace name<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} disabled={busy}/></label>
    <p className="hint">The new workspace keeps the same owner. Shared access grants are assigned separately. Merging into the parent and publishing to the original source are not available for these branches yet.</p>
    <button type="submit" className="button primary" disabled={busy||!name.trim()}>{busy?'Creating isolated branch...':'Create branch workspace'}</button>
    {error!=null&&<ErrorNotice error={error}/>}
  </form>;
}
