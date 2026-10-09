import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { ErrorNotice, Loading } from './ui';

export interface AvailableMcpServer { id: string; name: string; url: string }

export function useAvailableMcpServers() {
  return useQuery({ queryKey: ['mcp-available'], queryFn: ({ signal }) => api<{ servers: AvailableMcpServer[] }>('/mcp/available', { signal }), staleTime: 30_000 });
}

export function McpTaskSelection({ value, onChange, networkOrigins, networkMode }: { value: string[]; onChange: (value: string[]) => void; networkOrigins: string[]; networkMode: string }) {
  const catalog = useAvailableMcpServers();
  const unavailable = value.filter(id => !catalog.data?.servers.some(server => server.id === id));
  return <fieldset className="mcp-task-selection"><legend>MCP tools for this objective</legend>
    <p className="hint">Select enabled servers this task may request. Every tool call requires approval; server access does not grant network access.</p>
    {catalog.isPending ? <Loading>Loading permitted servers…</Loading> : catalog.isError ? <ErrorNotice error={catalog.error} retry={() => { void catalog.refetch(); }} /> : catalog.data.servers.length ? <div className="mcp-grant-list">{catalog.data.servers.map(server => {
      const selected = value.includes(server.id), origin = new URL(server.url).origin;
      const networkGranted = networkMode !== 'deny' && networkOrigins.includes(origin);
      return <div key={server.id}><label className="check-label"><input type="checkbox" checked={selected} onChange={event => onChange(event.target.checked ? [...value, server.id] : value.filter(id => id !== server.id))} /><span><strong>{server.name}</strong><small>{origin}</small></span></label>{selected && !networkGranted && <p className="hint mcp-scope-gap">Also allow <code>{origin}</code> in this task's network policy before sending.</p>}</div>;
    })}</div> : <p className="hint">No enabled MCP servers are available to this account. The local owner manages connections and grants.</p>}
    {catalog.isSuccess && unavailable.length > 0 && <div className="notice warning"><p>A selected server is no longer available. Remove unavailable selections before sending.</p><button className="text-button" type="button" onClick={() => onChange(value.filter(id => !unavailable.includes(id)))}>Remove unavailable selections</button></div>}
  </fieldset>;
}
