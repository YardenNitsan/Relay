import {useRef,useState,type RefObject} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {mutation,type SessionUser} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useAccessGuard} from './access-operation';
export function AddUser({onCreated,onCancel,headingRef}:{onCreated:(user:SessionUser)=>void;onCancel:()=>void;headingRef:RefObject<HTMLHeadingElement|null>}){
  const client=useQueryClient();
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[role,setRole]=useState<'chat'|'trusted'>('chat'),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),lock=useRef(false);
  useAccessGuard({dirty:Boolean(name||email||role!=='chat'),busy,label:'New allowed user'});
  const create=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError(null);try{await client.cancelQueries({queryKey:['admin-users']});const user=await mutation<SessionUser>('/admin/users',{name:name.trim(),email:email.trim(),role});onCreated(user);}catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}};
  return <form className="access-create" onSubmit={event=>{event.preventDefault();void create();}}><h3 tabIndex={-1} ref={headingRef}>Add an allowed user</h3><p>New users start with local models, personal file workspaces, no shared-workspace grants and no cloud spending.</p><fieldset disabled={busy}><label>Name<input dir="auto" value={name} onChange={event=>setName(event.target.value)} maxLength={100} required/></label><label>Identity-provider email<input type="email" value={email} onChange={event=>setEmail(event.target.value)} maxLength={254} autoCapitalize="none" required/></label><label>Account role<select value={role} onChange={event=>setRole(event.target.value as typeof role)}><option value="chat">Chat user</option><option value="trusted">Trusted user</option></select></label><p className="hint">This adds an allow-list entry; it does not send an invitation email. Review the account’s policy before sharing the configured gateway address.</p><div className="access-actions"><button className="button primary" disabled={busy||!name.trim()||!email.trim()} type="submit">{busy?'Adding user…':'Add allowed user'}</button><button className="text-button" type="button" onClick={onCancel}>Cancel new user</button></div></fieldset>{error!=null&&<ErrorNotice error={error}/>}</form>;
}
