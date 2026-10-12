import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,KeyRound,Plus,RefreshCw,Unplug} from 'lucide-react';
import {api,mutation} from '../../api';
import {Empty,ErrorNotice,Loading,shortDate} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {ClientReference} from './ClientReference';
import {TokenReceipt} from './TokenReceipt';
import type {ClientAccess,ClientToken,IssuedToken} from './types';
import './clients.css';

export default function ClientsStudio({permitted}:{permitted:boolean}){
  const client=useQueryClient(),request=useGuardedModalAction();
  const access=useQuery({queryKey:['inference-tokens'],queryFn:({signal})=>api<ClientAccess>('/inference/tokens',{signal}),enabled:permitted});
  const [view,setView]=useState<'list'|'create'|'receipt'>('list'),[label,setLabel]=useState(''),[days,setDays]=useState('30');
  const [issued,setIssued]=useState<IssuedToken|null>(null),[copied,setCopied]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState<unknown>(null),[message,setMessage]=useState('');
  const lock=useRef(false),labelRef=useRef<HTMLInputElement>(null),newRef=useRef<HTMLButtonElement>(null),receiptHeading=useRef<HTMLHeadingElement>(null);
  const listHeading=useRef<HTMLHeadingElement>(null);
  const focus=useRef<'create'|'receipt'|'list'|null>(null);
  useModalDraftGuard({dirty:view==='create'&&(label!==''||days!=='30'),busy,label:'Client token draft'});
  useLayoutEffect(()=>{
    if(busy)return;
    if(focus.current==='create')labelRef.current?.focus();else if(focus.current==='receipt')receiptHeading.current?.focus();else if(focus.current==='list')(newRef.current&&!newRef.current.disabled?newRef.current:listHeading.current)?.focus();focus.current=null;
  },[view,busy]);
  useEffect(()=>{if(!permitted){setIssued(null);setLabel('');setDays('30');setView('list');}},[permitted]);
  const refresh=()=>{void client.invalidateQueries({queryKey:['inference-tokens']}).catch(()=>undefined);};
  const returnToList=()=>{setLabel('');setDays('30');setIssued(null);setCopied(false);setError(null);focus.current='list';setView('list');};
  const create=async()=>{
    const expiresInDays=Number(days),name=label.trim();
    if(lock.current||!access.data?.enabled||!name||!Number.isInteger(expiresInDays)||expiresInDays<1||expiresInDays>90)return;
    lock.current=true;setBusy(true);setError(null);setMessage('');
    try{
      await client.cancelQueries({queryKey:['inference-tokens']});
      const token=await mutation<IssuedToken>('/inference/tokens',{label:name,expiresInDays});
      // The secret belongs only to this mounted receipt. Cache acknowledged
      // metadata only; the API does not return a creation timestamp.
      const metadata:ClientToken={id:token.id,label:name,expiresAt:token.expiresAt,createdAt:null,lastUsedAt:null};
      client.setQueryData<ClientAccess>(['inference-tokens'],current=>current?{...current,tokens:[metadata,...current.tokens.filter(item=>item.id!==token.id)]}:current);
      setIssued(token);setCopied(false);setLabel('');setDays('30');focus.current='receipt';setView('receipt');refresh();
    }catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}
  };
  const revoke=async(id:string)=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError(null);setMessage('');
    try{
      await client.cancelQueries({queryKey:['inference-tokens']});
      await api(`/inference/tokens/${encodeURIComponent(id)}`,{method:'DELETE'});
      client.setQueryData<ClientAccess>(['inference-tokens'],current=>current?{...current,tokens:current.tokens.filter(token=>token.id!==id)}:current);
      setMessage('Client token revoked.');focus.current='list';refresh();
    }catch(caught){setError(caught);}finally{lock.current=false;setBusy(false);}
  };
  const copy=async()=>{
    if(!issued||lock.current)return;
    if(!navigator.clipboard){setError(new Error('Clipboard access is unavailable. Choose Show token, then select the token field and copy it manually.'));return;}
    lock.current=true;setBusy(true);setError(null);
    try{await navigator.clipboard.writeText(issued.token);setCopied(true);}catch{setError(new Error('The token could not be copied. Choose Show token, then select the token field and copy it manually.'));}finally{lock.current=false;setBusy(false);}
  };
  if(!permitted)return <Empty title="External client access needs a grant">The host owner must enable external model access for your account. A browser session does not grant API access to other applications.</Empty>;
  return <div className="clients-studio">
    <header className="clients-studio-intro"><span className="clients-intro-icon" aria-hidden="true"><KeyRound size={24}/></span><div><h3>Application access</h3><p className="hint">Each token is a separate grant to your account’s model gateway.</p></div></header>
    <div className="clients-studio-workspace"><div className="clients-primary">
      {error!=null&&<ErrorNotice error={error}/>}{message&&<p className="clients-feedback" role="status">{message}</p>}
      {access.isError&&<ErrorNotice error={access.error} retry={()=>{void access.refetch();}}/>}
      {view==='receipt'&&issued?<TokenReceipt issued={issued} busy={busy} copied={copied} headingRef={receiptHeading} onCopy={()=>{void copy();}} onHide={returnToList}/>:
        view==='create'?<form className="clients-create" aria-label="Create client token" onSubmit={event=>{event.preventDefault();void create();}}>
          <button type="button" className="text-button" disabled={busy} onClick={()=>request(returnToList)}><ArrowLeft size={17} aria-hidden="true"/>All client grants</button>
          <h3>Create a client token</h3><p className="hint">Choose a recognizable application name and the shortest useful lifetime. The token uses your existing account permissions.</p>
          <label>Application label<input ref={labelRef} value={label} onChange={event=>setLabel(event.target.value)} placeholder="My coding client" maxLength={80} required disabled={busy||!access.data?.enabled}/></label>
          <label>Expires in days<input type="number" min={1} max={90} step={1} value={days} onChange={event=>setDays(event.target.value)} required disabled={busy||!access.data?.enabled}/></label>
          <p className="hint">Between 1 and 90 days. You can revoke access sooner.</p>
          {!access.data?.enabled&&<p className="notice warning">External inference is disabled for this account.</p>}
          <div className="clients-actions"><button className="button primary" type="submit" disabled={busy||!label.trim()||!access.data?.enabled}>{busy?'Creating token…':'Create token'}</button><button className="button" type="button" disabled={busy} onClick={()=>request(returnToList)}>Cancel creation</button></div>
        </form>:
        <section aria-label="Your client grants"><div className="clients-list-heading"><div><h3 ref={listHeading} tabIndex={-1}>Your client grants</h3><p>{access.data?`${access.data.tokens.length} current tokens`:'Account-scoped credentials'}</p></div><button ref={newRef} className="button primary" disabled={busy||!access.data?.enabled} onClick={()=>{setError(null);setMessage('');focus.current='create';setView('create');}}><Plus size={17} aria-hidden="true"/>New client token</button></div>
          {access.isPending&&<Loading>Checking client access…</Loading>}
          {access.data&&!access.data.enabled&&<p className="notice warning">External inference is disabled for this account. Existing tokens can be revoked below.</p>}
          {access.data&&(access.data.tokens.length?<div className="clients-grant-list">{access.data.tokens.map(token=><article key={token.id} aria-label={`${token.label} token`}><KeyRound size={19} aria-hidden="true"/><div><strong dir="auto">{token.label}</strong><dl><div><dt>Expires</dt><dd><time dateTime={token.expiresAt}>{shortDate(token.expiresAt)}</time></dd></div><div><dt>Last used</dt><dd>{token.lastUsedAt?<time dateTime={token.lastUsedAt}>{shortDate(token.lastUsedAt)}</time>:'Not used yet'}</dd></div><div><dt>Created</dt><dd>{token.createdAt?<time dateTime={token.createdAt}>{shortDate(token.createdAt)}</time>:'Awaiting metadata refresh'}</dd></div></dl></div><button className="button subtle" disabled={busy} aria-label={`Revoke ${token.label} token`} onClick={()=>{void revoke(token.id);}}><Unplug size={16} aria-hidden="true"/>Revoke</button></article>)}</div>:<Empty title="No client tokens">Create a separate token for each application so you can revoke it independently.</Empty>)}
          {access.data&&<button className="text-button clients-refresh" disabled={busy||access.isFetching} onClick={()=>{void access.refetch();}}><RefreshCw size={16} aria-hidden="true"/>Refresh client grants</button>}
        </section>}
    </div>{access.data&&<ClientReference endpoints={access.data.endpoints}/>}</div>
  </div>;
}
