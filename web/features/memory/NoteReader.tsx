import {useEffect,useRef,type RefObject} from 'react';
import type {Workspace} from '../../../shared/types';
import {ErrorNotice} from '../../components/ui';
import {scopeName,type Note} from './types';

export function NoteReader({note,workspaces,busy,deleting,removing,error,headingRef,onEdit,onToggle,onDelete,onKeep,onConfirmDelete}:{
  note:Note;workspaces:Workspace[];busy:boolean;deleting:boolean;removing:boolean;error:unknown;headingRef:RefObject<HTMLHeadingElement|null>;
  onEdit:()=>void;onToggle:()=>void;onDelete:()=>void;onKeep:()=>void;onConfirmDelete:()=>void;
}){
  const keep=useRef<HTMLButtonElement>(null),remove=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(deleting)keep.current?.focus();},[deleting]);
  return <article className="memory-reader memory-document-scroll" aria-labelledby={`memory-title-${note.id}`}>
    <header className="memory-reading-heading"><p className="memory-scope" dir="auto">{scopeName(note,workspaces)}</p>
    <h3 id={`memory-title-${note.id}`} ref={headingRef} tabIndex={-1} dir="auto">{note.title}</h3>
    <div className="memory-document-meta"><span data-enabled={note.enabled}>{note.enabled?'Enabled for future tasks':'Disabled for future tasks'}</span><span>Revision {note.revision}</span></div></header>
    <div className="memory-note-prose" dir="auto">{note.content}</div>
    <div className="memory-note-controls">
      <h4>How this note is used</h4>
      <label className="check-label memory-check"><input type="checkbox" aria-label={`Use ${note.title} in future tasks`} checked={note.enabled} disabled={busy} onChange={onToggle}/>Use in future tasks</label>
      <p className="hint">Only your account can use this note. Enabled notes provide context, never permission to act.</p>
      <div className="memory-note-actions"><button className="button" disabled={busy} onClick={onEdit}>Edit</button><button ref={remove} className="text-button" disabled={busy} onClick={onDelete}>Delete</button></div>
    </div>
    {deleting&&<div className="memory-delete-confirm" role="group" aria-label="Confirm memory deletion"><h4>Delete this memory?</h4><p>This removes the saved note. Earlier task records and backups are unchanged.</p><div className="memory-note-actions"><button ref={keep} className="button" disabled={busy} onClick={()=>{onKeep();remove.current?.focus();}}>Keep memory</button><button className="button danger-button" disabled={busy} onClick={onConfirmDelete}>{removing?'Deleting…':'Delete permanently'}</button></div></div>}
    {error!=null&&<ErrorNotice error={error}/>}
  </article>;
}
