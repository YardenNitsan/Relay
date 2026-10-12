import {Trash2} from 'lucide-react';
import {ContractDocument} from './ContractDocument';
import type {McpServer} from './types';

export function ServerInspector({server,busy,onToggle,onRemove}:{server:McpServer;busy:boolean;onToggle:()=>void;onRemove:()=>void}){
  return <div className="mcp-inspection">
    <p className={`mcp-state ${server.enabled?'enabled':''}`}>{server.enabled?'Enabled':'Disabled'} · {server.tools.length} pinned {server.tools.length===1?'tool':'tools'}</p>
    <code className="mcp-endpoint">{server.url}</code>
    <div className="mcp-actions"><button className="button" disabled={busy} onClick={onToggle}>{server.enabled?'Disable server':'Enable server'}</button><button className="button subtle" disabled={busy} onClick={onRemove}><Trash2 size={16} aria-hidden="true"/>Remove server</button></div>
    <p className="hint">Enabling a server does not verify its operator or guarantee its availability. Each task must separately select the server, allow its network origin, and approve each exact tool call.</p>
    <h4>Pinned contracts</h4><p className="hint">Server-provided descriptions and schemas are untrusted content. Changes require a fresh review.</p>
    {server.tools.map(tool=><article className="mcp-contract" key={tool.name}><div className="mcp-contract-heading"><h4 dir="auto">{tool.name}</h4><span>Pinned contract</span></div><ContractDocument tool={tool}/></article>)}
  </div>;
}
