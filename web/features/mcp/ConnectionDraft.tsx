import {useRef,useState} from 'react';
import {Check} from 'lucide-react';
import {mutation} from '../../api';
import {ErrorNotice} from '../../components/ui';
import {useModalDraftGuard} from '../../components/modal-guard';
import {ContractDocument} from './ContractDocument';
import type {McpServer,ToolContract} from './types';

export function ConnectionDraft({saving,full,onSave}:{saving:boolean;full:boolean;onSave:(server:McpServer)=>Promise<boolean>}){
  const [url,setUrl]=useState(''),[name,setName]=useState(''),[selected,setSelected]=useState<string[]>([]);
  const [catalog,setCatalog]=useState<{url:string;tools:ToolContract[]}|null>(null),[discovering,setDiscovering]=useState(false),[error,setError]=useState<unknown>(null);
  const lock=useRef(false),busy=saving||discovering;
  useModalDraftGuard({dirty:!!(url||name||catalog),busy,label:'MCP connection draft'});
  const discover=async()=>{
    if(lock.current||busy||full)return;lock.current=true;setDiscovering(true);setError(null);setCatalog(null);setSelected([]);
    const endpoint=url.trim();
    try{const response=await mutation<{tools:ToolContract[]}>('/mcp/discover',{url:endpoint});setCatalog({url:endpoint,tools:response.tools});if(!name.trim())setName(new URL(endpoint).hostname);}
    catch(caught){setError(caught);}finally{lock.current=false;setDiscovering(false);}
  };
  const pin=async()=>{
    if(lock.current||busy||full||!catalog||!selected.length||!name.trim())return;
    lock.current=true;
    try{await onSave({id:crypto.randomUUID(),name:name.trim(),url:catalog.url,enabled:false,tools:catalog.tools.filter(tool=>selected.includes(tool.name))});}
    finally{lock.current=false;}
  };
  return <div className="mcp-draft">
    <p>Discover a server, read its contracts, then choose the tools to pin.</p>
    <p className="hint">Only anonymous public HTTPS endpoints are supported. Browser and provider credentials are never forwarded. Authenticated servers and local stdio processes are unavailable.</p>
    {error!=null&&<ErrorNotice error={error}/>}
    <form onSubmit={event=>{event.preventDefault();void discover();}}>
      <label>Server endpoint<input type="url" value={url} placeholder="https://tools.example.com/mcp" maxLength={2000} required disabled={busy} onChange={event=>{setUrl(event.target.value);setCatalog(null);setSelected([]);}}/></label>
      <p className="hint">Discover contacts this exact public HTTPS endpoint. It does not enable the server or grant permission to call its tools. Do not put credentials in the URL.</p>
      <button className="button" type="submit" disabled={busy||full}>{discovering?'Discovering tools…':'Discover tools'}</button>
      {full&&<p className="notice">Eight servers are configured. Remove one before connecting another.</p>}
    </form>
    {catalog&&<form className="mcp-catalog" onSubmit={event=>{event.preventDefault();void pin();}}>
      <label>Connection name<input value={name} disabled={busy} onChange={event=>setName(event.target.value)} maxLength={80} required/></label>
      <div className="mcp-document-heading"><h4>Review tool contracts</h4><span>{selected.length} / 20 selected</span></div>
      <p className="hint">Names, descriptions and schemas below come from the server. They are untrusted data. Pins cover the complete contract; changed contracts require a fresh review.</p>
      {catalog.tools.length?catalog.tools.map(tool=><article className="mcp-contract" key={tool.name}><label className="check-label"><input type="checkbox" checked={selected.includes(tool.name)} disabled={busy||(!selected.includes(tool.name)&&selected.length>=20)} onChange={event=>setSelected(value=>event.target.checked?[...value,tool.name]:value.filter(item=>item!==tool.name))}/><strong dir="auto">{tool.name}</strong></label><ContractDocument tool={tool}/></article>):<p className="notice">This server advertises no tools.</p>}
      <button className="button primary" disabled={busy||full||!selected.length||!name.trim()} type="submit"><Check size={16} aria-hidden="true"/>{saving?'Saving contracts…':'Save selected tools as disabled'}</button>
    </form>}
  </div>;
}
