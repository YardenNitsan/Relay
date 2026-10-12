import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {ArrowLeft,ChevronRight,Plus,RefreshCw,Search,Plug} from 'lucide-react';
import {api} from '../../api';
import {Empty,ErrorNotice,Loading} from '../../components/ui';
import {useGuardedModalAction,useModalDraftGuard} from '../../components/modal-guard';
import {ConnectionDraft} from './ConnectionDraft';
import {ServerInspector} from './ServerInspector';
import type {McpConfiguration,McpServer} from './types';
import './mcp.css';

export default function McpStudio(){
  const client=useQueryClient(),request=useGuardedModalAction();
  const config=useQuery({queryKey:['mcp-servers'],queryFn:({signal})=>api<McpConfiguration>('/mcp/servers',{signal})});
  const [view,setView]=useState<'list'|'inspect'|'create'>('list'),[selected,setSelected]=useState<string|null>(null),[search,setSearch]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[notice,setNotice]=useState('');
  const [draftVersion,setDraftVersion]=useState(0);
  const lock=useRef(false),index=useRef<HTMLDivElement>(null),heading=useRef<HTMLHeadingElement>(null),searchInput=useRef<HTMLInputElement>(null),newButton=useRef<HTMLButtonElement>(null);
  const focus=useRef<'detail'|'index'|null>(null),returnTarget=useRef<HTMLElement|null>(null);
  useModalDraftGuard({dirty:false,busy,label:'MCP configuration'});
  useLayoutEffect(()=>{
    if(busy)return;
    if(focus.current==='detail')heading.current?.focus();
    else if(focus.current==='index'){
      const target=returnTarget.current;
      if(target?.isConnected&&target.getClientRects().length&&!(target as HTMLButtonElement).disabled)target.focus();else searchInput.current?.focus();
    }
    focus.current=null;
  },[view,selected,busy,draftVersion]);
  useEffect(()=>{
    const compact=matchMedia('(max-width: 799px)');
    const resize=()=>{if(compact.matches&&view!=='list'&&index.current?.contains(document.activeElement))heading.current?.focus();};
    compact.addEventListener('change',resize);return()=>compact.removeEventListener('change',resize);
  },[view]);
  const open=(next:'inspect'|'create',id:string|null,target:HTMLElement)=>request(()=>{returnTarget.current=target;setSelected(id);setView(next);if(next==='create')setDraftVersion(value=>value+1);setError(null);setNotice('');focus.current='detail';});
  const back=()=>request(()=>{setView('list');focus.current='index';});
  const save=async(servers:McpServer[],message:string):Promise<boolean>=>{
    if(lock.current)return false;lock.current=true;setBusy(true);setError(null);setNotice('');
    try{
      await client.cancelQueries({queryKey:['mcp-servers']});
      const acknowledged=await api<McpConfiguration>('/mcp/servers',{method:'PUT',body:{servers}});
      client.setQueryData(['mcp-servers'],acknowledged);setNotice(message);
      void client.invalidateQueries({queryKey:['mcp-available']}).catch(()=>undefined);
      void client.invalidateQueries({queryKey:['mcp-servers']}).catch(()=>undefined);
      return true;
    }catch(caught){setError(caught);return false;}finally{lock.current=false;setBusy(false);}
  };
  const server=config.data?.servers.find(item=>item.id===selected);
  const filtered=config.data?.servers.filter(item=>`${item.name} ${item.url}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))??[];
  return <div className="mcp-studio" data-view={view}>
    <header className="mcp-studio-intro"><span className="mcp-intro-icon" aria-hidden="true"><Plug size={24}/></span><div><h3>Tool connections</h3><p className="hint">Review the exact contracts your host may expose to authorized tasks.</p></div></header>
    <div className="mcp-feedback">{error!=null&&<ErrorNotice error={error}/>} {notice&&<p role="status">{notice}</p>}{config.isError&&<ErrorNotice error={config.error} retry={()=>{void config.refetch();}}/>}</div>
    <div className="mcp-workspace">
      <div ref={index} className="mcp-index">
        <div className="mcp-index-toolbar"><div className="mcp-document-heading"><h3>Saved servers</h3><button className="icon-button" aria-label="Refresh MCP servers" disabled={busy||config.isFetching} onClick={()=>{void config.refetch();}}><RefreshCw size={17} aria-hidden="true"/></button></div>
          <label className="mcp-search"><Search size={17} aria-hidden="true"/><input ref={searchInput} aria-label="Search MCP servers" type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Name or endpoint"/></label>
          <button ref={newButton} className="button primary" disabled={busy||!config.data||config.data.servers.length>=8} onClick={event=>open('create',null,event.currentTarget)}><Plus size={17} aria-hidden="true"/>Review a new server</button>
        </div>
        <div className="mcp-index-scroll" tabIndex={0} role="region" aria-label="Saved MCP connections">
          {config.isPending&&<Loading>Loading MCP configuration…</Loading>}
          {config.data&&(filtered.length?<ul>{filtered.map(item=><li key={item.id}><button aria-label={`Inspect ${item.name}`} aria-current={selected===item.id&&view==='inspect'?'true':undefined} disabled={busy} onClick={event=>open('inspect',item.id,event.currentTarget)}><span><strong dir="auto">{item.name}</strong><span>{item.enabled?'Enabled':'Disabled'} · {item.tools.length} pinned {item.tools.length===1?'tool':'tools'}</span><code>{item.url}</code></span><ChevronRight size={17} aria-hidden="true"/></button></li>)}</ul>:<Empty title={search?'No matching servers':'No MCP servers configured'}>{search?'Try a different name or endpoint.':'Review a server whose tools and operator you intend to trust.'}</Empty>)}
        </div>
        <p className="mcp-index-count">{config.data?`${config.data.servers.length} of 8 connections`:'Configuration not loaded'}</p>
      </div>
      <section className="mcp-document" tabIndex={0} aria-label="MCP connection inspector">
        {view==='list'?<div className="mcp-introduction"><h3>Public HTTPS servers</h3><p>Anonymous, modern MCP endpoints only. OAuth, authenticated servers and local stdio processes are not supported by this connection type.</p><p>No browser or provider credentials are forwarded.</p>{config.data&&<p className="hint">Protocol {config.data.protocol} · Transport {config.data.transport}</p>}<p className="hint">Choose a saved server to inspect its tools, or review a new connection. Inspection does not contact the server or grant tool access.</p></div>:<>
          <button className="text-button mcp-back" disabled={busy} onClick={back}><ArrowLeft size={17} aria-hidden="true"/>All servers</button>
          <h3 ref={heading} tabIndex={-1} dir="auto">{view==='create'?'Review a new server':server?.name??'Connection no longer saved'}</h3>
          {view==='create'?<ConnectionDraft key={draftVersion} saving={busy} full={!config.data||config.data.servers.length>=8} onSave={async item=>{
            if(!config.data)return false;
            const saved=await save([...config.data.servers,item],'Tool contracts saved. This server is disabled until you enable it.');
            if(saved){setSelected(item.id);setView('inspect');focus.current='detail';}return saved;
          }}/>:server?<ServerInspector server={server} busy={busy} onToggle={()=>{void save(config.data!.servers.map(item=>item.id===server.id?{...item,enabled:!item.enabled}:item),server.enabled?`${server.name} disabled.`:`${server.name} enabled. Tasks still need server and network grants.`);}} onRemove={()=>{void (async()=>{if(await save(config.data!.servers.filter(item=>item.id!==server.id),`${server.name} removed from the host allowlist.`)){setSelected(null);setView('list');returnTarget.current=newButton.current;focus.current='index';}})();}}/>:<p>The saved configuration has changed. Return to the connection list to review the current state.</p>}
        </>}
      </section>
    </div>
  </div>;
}
