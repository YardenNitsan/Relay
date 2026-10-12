import type {RefObject} from 'react';
import type {Conversation} from '../../../shared/types';
import {ErrorNotice} from '../../components/ui';

export function DeleteConversation({conversation,busy,error,cancelRef,onCancel,onDelete}:{conversation:Pick<Conversation,'id'|'title'>;busy:boolean;error:unknown;cancelRef:RefObject<HTMLButtonElement|null>;onCancel:()=>void;onDelete:()=>void}){
  return <section className="history-delete-confirmation" aria-label="Confirm conversation deletion" aria-busy={busy}>
    <div className="history-deletion-document"><p className="history-deletion-context">Conversation history</p><h3>Delete this conversation?</h3><p className="history-delete-title" dir="auto">{conversation.title}</p>
      <p>This removes the conversation from history and search. The host retains execution records for audit and usage accounting. Workspace files remain unchanged.</p>
      <p>Unfinished tasks must be stopped or cancelled before the conversation can be deleted.</p>
      {error!=null&&<ErrorNotice error={error}/>}
      <div className="history-deletion-actions"><button ref={cancelRef} className="button" disabled={busy} onClick={onCancel}>Cancel</button><button className="button danger-button" disabled={busy} onClick={onDelete}>{busy?'Deleting…':'Delete conversation'}</button></div>
    </div>
  </section>;
}
