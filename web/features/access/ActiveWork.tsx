import {useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,mutation,type SessionUser} from '../../api';
import {ErrorNotice,Loading,Status} from '../../components/ui';
import {useAccessGuard} from './access-operation';
import type {ActiveTask} from './access-state';
export function ActiveWork({users}:{users:SessionUser[]}){
  const client=useQueryClient(),query=useQuery({queryKey:['admin-tasks'],queryFn:({signal})=>api<ActiveTask[]>('/admin/tasks',{signal}),refetchInterval:5000});
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[message,setMessage]=useState(''),lock=useRef(false);
  useAccessGuard({dirty:false,busy,label:'Stop invited users’ work'});
  const heading=useRef<HTMLHeadingElement>(null),focusAfterSuccess=useRef(false);
  useLayoutEffect(()=>{if(!busy&&focusAfterSuccess.current){focusAfterSuccess.current=false;heading.current?.focus({preventScroll:true});}},[busy]);
  const stop=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError(null);setMessage('');try{await client.cancelQueries({queryKey:['admin-tasks']});await mutation('/admin/remote/stop');focusAfterSuccess.current=true;client.setQueryData<ActiveTask[]>(['admin-tasks'],current=>current?.filter(task=>task.userId==='owner'));setMessage('Stop requested for all invited users’ work. Local owner work is unchanged.');void client.invalidateQueries({queryKey:['admin-tasks']});}catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}};
  return <div className="access-document"><h3 ref={heading} tabIndex={-1}>Active work on this host</h3><p>Review queued, running and paused tasks. Stopping invited users’ work does not stop the local owner’s tasks.</p><button className="button danger-button" disabled={busy||!query.data?.some(task=>task.userId!=='owner')} onClick={()=>{void stop();}}>{busy?'Stopping…':'Stop remote work'}</button>{error!=null&&<ErrorNotice error={error}/>} {message&&<p role="status" className="notice">{message}</p>}{query.isError&&<ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>}{query.isPending?<Loading>Reading active work…</Loading>:query.data?.length?<ul className="access-work-list">{query.data.map(task=><li key={task.id}><div><strong dir="auto">{users.find(user=>user.id===task.userId)?.name??task.userId}</strong><p className="hint">{task.callsUsed} calls · <code>{task.id}</code></p></div><Status status={task.status}/></li>)}</ul>:query.data&&<p className="muted small">No active tasks reported.</p>}</div>;
}
