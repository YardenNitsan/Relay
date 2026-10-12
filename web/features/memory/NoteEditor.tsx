import type {RefObject} from 'react';
import type {Workspace} from '../../../shared/types';
import {ErrorNotice} from '../../components/ui';
import type {Note,NoteDraft} from './types';

export function NoteEditor({draft,baseline,workspaces,approved,busy,saving,changedElsewhere,error,headingRef,onChange,onApprove,onSave,onCancel}:{
  draft:NoteDraft;baseline:Note|null;workspaces:Workspace[];approved:boolean;busy:boolean;saving:boolean;changedElsewhere:boolean;error:unknown;
  headingRef:RefObject<HTMLHeadingElement|null>;onChange:(value:NoteDraft)=>void;onApprove:(value:boolean)=>void;onSave:()=>void;onCancel:()=>void;
}){
  return <form className="memory-editor" onSubmit={event=>{event.preventDefault();if(approved&&!busy&&draft.title.trim()&&draft.content.trim())onSave();}}>
    <div className="memory-document-scroll">
      <header className="memory-editing-heading"><h3 ref={headingRef} tabIndex={-1}>{baseline?'Edit memory':'Add memory'}</h3>
      <p className="memory-document-intro">Write the context you want to carry into future tasks.</p></header>
      {changedElsewhere&&<p className="notice">This saved note changed while you were editing. Your draft is kept. Cancel edit and reopen the note to use its latest revision.</p>}
      <label>Scope<select value={draft.workspaceId??''} disabled={busy||baseline!=null} onChange={event=>onChange({...draft,workspaceId:event.target.value||null})}>
        <option value="">Personal preference</option>{workspaces.map(workspace=><option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        {draft.workspaceId&&!workspaces.some(workspace=>workspace.id===draft.workspaceId)&&<option value={draft.workspaceId}>Workspace note</option>}
      </select></label>
      {baseline&&<p className="hint">Editing revision {baseline.revision}. The saved scope stays the same.</p>}
      <label>Title<input dir="auto" maxLength={120} required value={draft.title} disabled={busy} onChange={event=>onChange({...draft,title:event.target.value})}/></label>
      <label>What should Relay remember?<textarea dir="auto" maxLength={4096} rows={8} required value={draft.content} disabled={busy} onChange={event=>onChange({...draft,content:event.target.value})}/></label>
      <div className="memory-save-review"><h4>Review its use</h4><label className="check-label memory-check"><input type="checkbox" checked={draft.enabled} disabled={busy} onChange={event=>onChange({...draft,enabled:event.target.checked})}/>Use this memory in future tasks</label>
      <p className="hint">Enabled notes may be sent to a cloud model when you separately allow cloud context for a task. Keep passwords and API keys out of memory.</p>
      <label className="check-label memory-check memory-approval"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>onApprove(event.target.checked)}/>I approve saving this memory for my future tasks</label></div>
      {error!=null&&<ErrorNotice error={error}/>}
      <div className="memory-editor-actions"><button className="button primary" disabled={!approved||busy||!draft.title.trim()||!draft.content.trim()}>{saving?'Saving…':'Save approved memory'}</button><button type="button" className="button" disabled={busy} onClick={onCancel}>{baseline?'Cancel edit':'Cancel new memory'}</button></div>
    </div>
  </form>;
}
