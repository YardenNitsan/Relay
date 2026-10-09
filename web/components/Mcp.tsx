import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { api, mutation } from '../api';
import { Empty, ErrorNotice, Loading } from './ui';

interface ToolContract { name: string; description: string; inputSchema: Record<string, unknown>; outputSchema?: Record<string, unknown>; schemaHash: string }
interface McpServer { id: string; name: string; url: string; enabled: boolean; tools: ToolContract[] }
interface McpConfiguration { servers: McpServer[]; protocol: string; transport: string }
export default function Mcp() {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ['mcp-servers'], queryFn: ({ signal }) => api<McpConfiguration>('/mcp/servers', { signal }) });
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [catalog, setCatalog] = useState<{ url: string; tools: ToolContract[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<'discover' | 'save' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const save = async (servers: McpServer[], success: string): Promise<boolean> => {
    setBusy('save'); setError(null); setNotice('');
    try {
      await api('/mcp/servers', { method: 'PUT', body: { servers } });
      await Promise.all([client.invalidateQueries({ queryKey: ['mcp-servers'] }), client.invalidateQueries({ queryKey: ['mcp-available'] })]);
      setNotice(success); return true;
    } catch (caught) { setError(caught); return false; }
    finally { setBusy(null); }
  };
  const discover = async () => {
    setBusy('discover'); setError(null); setNotice(''); setCatalog(null); setSelected([]);
    const endpoint = url.trim();
    try {
      const response = await mutation<{ tools: ToolContract[] }>('/mcp/discover', { url: endpoint });
      setCatalog({ url: endpoint, tools: response.tools });
      if (!name.trim()) setName(new URL(endpoint).hostname);
    } catch (caught) { setError(caught); }
    finally { setBusy(null); }
  };
  const pin = async () => {
    if (!catalog || !config.data || !selected.length) return;
    const server: McpServer = { id: crypto.randomUUID(), name: name.trim(), url: catalog.url, enabled: false, tools: catalog.tools.filter(tool => selected.includes(tool.name)) };
    if (await save([...config.data.servers, server], 'Tool contracts saved. This server is disabled until you enable it.')) { setCatalog(null); setSelected([]); setUrl(''); setName(''); }
  };
  return <><div className="section-intro"><p>Connect tools with a defined scope.</p><p className="muted">Review a server's tool catalog, pin only the contracts you trust, then decide which tasks and people may use it.</p></div>
    <div className="mcp-boundary"><Plug size={18} /><div><strong>Public HTTPS servers</strong><p>Anonymous, modern MCP endpoints only. OAuth, authenticated servers and local stdio processes are not supported by this connection type.</p>{config.data && <small>Protocol {config.data.protocol} · No browser or provider credentials are forwarded.</small>}</div></div>
    {error != null && <ErrorNotice error={error} />}{notice && <p className="notice" role="status">{notice}</p>}
    <div className="section-heading"><h3>Saved servers</h3><button className="icon-button" aria-label="Refresh MCP servers" disabled={Boolean(busy)} onClick={() => { void config.refetch(); }}><RefreshCw size={16} /></button></div>
    {config.isPending ? <Loading>Loading MCP configuration…</Loading> : config.isError ? <ErrorNotice error={config.error} retry={() => { void config.refetch(); }} /> : config.data.servers.length ? <div className="mcp-servers">{config.data.servers.map(server => <article className="mcp-server" key={server.id}><div className="split"><div><h3>{server.name}</h3><span className={`mcp-state ${server.enabled ? 'enabled' : ''}`}>{server.enabled ? 'Enabled' : 'Disabled'} · {server.tools.length} pinned {server.tools.length === 1 ? 'tool' : 'tools'}</span></div><button className="button" disabled={Boolean(busy)} onClick={() => { void save(config.data.servers.map(item => item.id === server.id ? { ...item, enabled: !item.enabled } : item), server.enabled ? `${server.name} disabled.` : `${server.name} enabled. Tasks still need server and network grants.`); }}>{server.enabled ? 'Disable server' : 'Enable server'}</button></div><code className="mcp-endpoint">{server.url}</code><details><summary>Inspect pinned contracts</summary>{server.tools.map(tool => <div className="mcp-pin" key={tool.name}><strong>{tool.name}</strong><code>{tool.schemaHash}</code></div>)}</details><button className="text-button" disabled={Boolean(busy)} onClick={() => { void save(config.data.servers.filter(item => item.id !== server.id), `${server.name} removed from the host allowlist.`); }}><Trash2 size={14} />Remove server</button></article>)}</div> : <Empty title="No MCP servers configured" icon={<Plug size={25} />}><p>Connect only a server whose tools and operator you intend to trust.</p></Empty>}
    <section className="mcp-connect"><h3><Link2 size={17} />Review a new server</h3><form onSubmit={event => { event.preventDefault(); void discover(); }}><label>Server endpoint<input type="url" value={url} placeholder="https://tools.example.com/mcp" maxLength={2000} required disabled={Boolean(busy)} onChange={event => { setUrl(event.target.value); setCatalog(null); setSelected([]); }} /></label><p className="hint">Discover contacts this exact public HTTPS endpoint. It does not enable the server or grant permission to call its tools. Do not put credentials in the URL.</p><button className="button" type="submit" disabled={Boolean(busy) || !config.data || config.data.servers.length >= 8}>{busy === 'discover' ? 'Discovering tools…' : 'Discover tools'}</button>{config.data && config.data.servers.length >= 8 && <p className="hint">Eight servers are configured. Remove one before connecting another.</p>}</form>
      {catalog && <form className="mcp-catalog" onSubmit={event => { event.preventDefault(); void pin(); }}><label>Connection name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label><div className="section-heading"><h3>Review tool contracts</h3><span className="small muted">{selected.length} / 20 selected</span></div><p className="hint">Names, descriptions and schemas below come from the server. They are untrusted data. Pins cover the complete contract; changed contracts require a fresh review.</p>{catalog.tools.length ? catalog.tools.map(tool => <article className="mcp-contract" key={tool.name}><label className="check-label"><input type="checkbox" checked={selected.includes(tool.name)} disabled={!selected.includes(tool.name) && selected.length >= 20} onChange={event => setSelected(value => event.target.checked ? [...value, tool.name] : value.filter(item => item !== tool.name))} /><strong>{tool.name}</strong></label><p>{tool.description || 'No description supplied by this server.'}</p><details><summary>Inspect schema and fingerprint</summary><pre className="bounded-output">{JSON.stringify({ input: tool.inputSchema, ...(tool.outputSchema ? { output: tool.outputSchema } : {}) }, null, 2)}</pre><code>{tool.schemaHash}</code></details></article>) : <p className="notice">This server advertises no tools.</p>}<button className="button primary" disabled={Boolean(busy) || !selected.length || !name.trim()} type="submit"><Check size={16} />{busy === 'save' ? 'Saving contracts…' : 'Save selected tools as disabled'}</button></form>}
    </section><p className="hint">Enabling a server does not verify its operator or guarantee its availability. Each task must separately select the server, allow its network origin, and approve each exact tool call.</p>
  </>;
}
