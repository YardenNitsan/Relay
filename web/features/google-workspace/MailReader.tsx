import {useEffect,useLayoutEffect,useRef} from 'react';
import {ArrowLeft,Mail} from 'lucide-react';
import {useRememberedFocus} from '../../layout/useRememberedFocus';
import type {MailBody,MailSearch} from './types';

interface Props {search:string;onSearch:(value:string)=>void;onFind:()=>void;onRead:(id:string)=>void;onBack:()=>void;busy:string;mail:MailSearch|null;body:MailBody|null}
export function MailReader({search,onSearch,onFind,onRead,onBack,busy,mail,body}:Props){
  const heading=useRef<HTMLHeadingElement>(null),input=useRef<HTMLInputElement>(null),index=useRef<HTMLDivElement>(null);
  const rows=useRef(new Map<string,HTMLButtonElement>()),previous=useRef<string|null>(null),lastFocus=useRememberedFocus();
  useLayoutEffect(()=>{
    if(body)heading.current?.focus({preventScroll:true});
    else if(previous.current)(rows.current.get(previous.current)??input.current)?.focus({preventScroll:true});
    previous.current=body?.id??null;
  },[body]);
  useEffect(()=>{
    const media=window.matchMedia('(max-width: 899px)');
    const changed=()=>{const active=document.activeElement===document.body?lastFocus.current:document.activeElement;if(media.matches&&body&&active&&index.current?.contains(active))heading.current?.focus({preventScroll:true});};
    media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);
  },[body,lastFocus]);
  return <section aria-label="Read Gmail" className={`google-studio-mail ${body?'has-message':''}`}>
    <div className="google-studio-mail-index google-studio-scroll" ref={index}>
      <header><h3>Your Gmail</h3><p>Search previews, then choose a message to read.</p></header>
      <form className="google-studio-form" onSubmit={event=>{event.preventDefault();onFind();}}>
        <label>Gmail search<input ref={input} value={search} onChange={event=>onSearch(event.target.value)} placeholder="For example: newer_than:7d" maxLength={1000} disabled={!!busy}/></label>
        <p className="hint">Returns up to 10 message previews. Open an individual message to read its plain text. Attachments and embedded content are excluded.</p>
        <button className="button primary" disabled={!!busy}>{busy==='search'?'Searching…':'Search mail'}</button>
      </form>
      {mail&&<div className="google-studio-mail-results" aria-label="Mail results"><p role="status">{mail.messages.length?`${mail.messages.length} message previews returned.`:'No messages matched this search.'}{mail.limited?' More matches exist; narrow your search.':''}</p>{mail.messages.map(item=><article key={item.id} className="google-studio-mail-row"><h4 dir="auto">{item.headers.subject||'No subject'}</h4><p className="hint" dir="auto">{item.headers.from||'Sender not supplied'}{item.headers.date?` · ${item.headers.date}`:''}</p><p dir="auto">{item.snippet}</p><button ref={node=>{if(node)rows.current.set(item.id,node);else rows.current.delete(item.id);}} className="text-button" disabled={!!busy} aria-current={body?.id===item.id?'true':undefined} onClick={()=>onRead(item.id)}>{busy===`read:${item.id}`?'Reading…':'Read message'}</button></article>)}</div>}
    </div>
    <div className="google-studio-message google-studio-scroll" tabIndex={0} role="region" aria-label="Selected mail message">
      {body?<><button className="text-button" disabled={!!busy} onClick={onBack}><ArrowLeft size={17} aria-hidden="true"/>Back to mail results</button><h3 ref={heading} tabIndex={-1} dir="auto">{body.headers.subject||'No subject'}</h3><dl className="google-studio-mail-meta">{body.headers.from&&<div><dt>From</dt><dd dir="auto">{body.headers.from}</dd></div>}{body.headers.to&&<div><dt>To</dt><dd dir="auto">{body.headers.to}</dd></div>}{body.headers.date&&<div><dt>Date</dt><dd>{body.headers.date}</dd></div>}</dl>{body.bodyUnavailable?<p>Plain-text content is unavailable. HTML and attachments are not displayed.</p>:<pre dir="auto">{body.text}</pre>}{body.truncated&&<p className="google-studio-warning">This message exceeded the read limit; only part is shown.</p>}</>:<div className="google-studio-reader-empty"><Mail size={30} aria-hidden="true"/><h3>Read a message here</h3><p>Message content appears only after you choose “Read message”.</p></div>}
    </div>
  </section>;
}
