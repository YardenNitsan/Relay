import {useState} from 'react';
import type {Workspace} from '../../../shared/types';
import {mutation} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';

export default function CreateProject({owner,onCreated}:{owner:boolean;onCreated:(workspace:Workspace)=>Promise<void>}){
  const [name,setName]=useState(''),[sourcePath,setSourcePath]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  useModalDraftGuard({dirty:false,busy,label:'workspace creation'});
  const create=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy)return;setBusy(true);setError(null);
    try{
      const workspace=await mutation<Workspace>('/workspaces',{name:name.trim(),...(owner&&sourcePath.trim()?{sourcePath:sourcePath.trim()}:{personal:true})});
      await onCreated(workspace);setName('');setSourcePath('');
    }catch(caught){setError(caught);}finally{setBusy(false);}
  };
  return <form className="project-create" onSubmit={event=>{void create(event);}}>
    <p className="project-eyebrow">A place for your work</p><h3>{owner?'New workspace':'New personal workspace'}</h3>
    <p className="muted">{owner?'Start with an empty workspace for attachments, or import a managed copy of a project on the Relay Host.':'Start with an empty workspace, then attach files from your device in the conversation.'}</p>
    <label>Name<input value={name} onChange={event=>setName(event.target.value)} required maxLength={120} placeholder="Authentication investigation" disabled={busy}/></label>
    {owner&&<label>Source directory <span className="muted">(optional)</span><input value={sourcePath} onChange={event=>setSourcePath(event.target.value)} placeholder="Absolute path on this host" disabled={busy} spellCheck={false}/></label>}
    <p className="hint">{owner?'Importing copies permitted text files. The original project stays untouched until you explicitly review and publish changes.':'Your personal workspace is private to this account. It is stored on the host; the host owner controls that storage.'}</p>
    <button className="button primary" type="submit" disabled={busy||!name.trim()}>{busy?'Creating workspace...':sourcePath.trim()?'Import managed copy':'Create workspace'}</button>
    {error!=null&&<ErrorNotice error={error}/>}
  </form>;
}
