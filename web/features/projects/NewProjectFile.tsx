import {useEffect,useRef,useState} from 'react';
import {FilePlus2} from 'lucide-react';
import {api} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import SourceContents from './SourceContents';

interface CreatedFile {path:string;content:string;sha256:string}
export default function NewProjectFile({id,prepare,onCreated,onCancel}:{id:string;prepare:()=>Promise<void>;onCreated:(file:CreatedFile)=>void;onCancel:()=>void}){
  const [path,setPath]=useState(''),[content,setContent]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
  const input=useRef<HTMLInputElement>(null),writing=useRef(false),request=useGuardedModalAction();
  useEffect(()=>{input.current?.focus();},[]);
  useModalDraftGuard({dirty:!!path||!!content,busy,label:'new project file'});
  const create=async()=>{
    if(!path.trim()||writing.current)return;
    writing.current=true;setBusy(true);setError(null);
    try{
      await prepare();
      const saved=await api<{path:string;sha256:string}>(`/workspaces/${id}/file`,{method:'PUT',body:{path,content,expectedHash:null}});
      onCreated({...saved,content});
    }catch(caught){setError(caught);}
    finally{writing.current=false;setBusy(false);}
  };
  return <section className="workspace-editor project-new-file" aria-label="Create project file">
    <div className="project-editor-body">
      <h4><FilePlus2 size={18}/>New file</h4>
      <p className="hint">Create a text file in this managed workspace. Use a relative path to include new folders. Existing files are never overwritten.</p>
      <label className="project-new-path">Relative file path<input ref={input} value={path} disabled={busy} maxLength={512} spellCheck={false} autoCapitalize="none" autoCorrect="off" placeholder="src/feature.ts" onChange={event=>setPath(event.target.value)}/></label>
      <SourceContents path={path} label="New file contents" content={content} readOnly={false} busy={busy} onChange={setContent}/>
      {error!=null&&<ErrorNotice error={error}/>}
    </div>
    <footer className="project-editor-actions"><button className="button primary" disabled={busy||!path.trim()} onClick={()=>{void create();}}>{busy?'Creating file...':'Create file'}</button><button className="button" disabled={busy} onClick={()=>request(onCancel)}>Cancel new file</button></footer>
  </section>;
}
