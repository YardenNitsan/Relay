import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Check, ChevronRight, Code2, Compass, Files, Globe, Landmark, ListTodo, Mail, Monitor, Workflow, type LucideIcon } from 'lucide-react';
import { getAssistantDefinition, type AssistantCatalog, type AssistantId } from '../../shared/assistants';
import { api } from '../api';
import { ErrorNotice, Loading } from './ui';

const icons: Record<AssistantId, LucideIcon> = { email: Mail, calendar: CalendarDays, research: Compass, coding: Code2, files: Files, personal: ListTodo, browser: Globe, finance: Landmark, learning: BookOpen, computer: Monitor };
const statusLabels = { ready: 'Tools available to request', limited: 'Available with limits', connection_required: 'Requires connection' } as const;
const toolLabels: Record<string, string> = { file_list: 'List managed files', file_read: 'Read managed files', file_search: 'Search managed files', file_write: 'Write managed files', file_delete: 'Delete managed files', host_list: 'List host files', host_read: 'Read host text files', host_write: 'Write host text files', host_delete: 'Delete host text files', git_status: 'Inspect changes', git_diff: 'Compare changes', terminal: 'Isolated terminal', http_get: 'Read public web pages', mcp_call: 'Approved MCP tools', personal_tasks: 'Personal task lists' };

export default function Agents({ selected, onSelect, onWorkspace, workspaceSelected = false }: { selected?: AssistantId; onSelect: (id: AssistantId | undefined) => Promise<void>; onWorkspace?: () => void; workspaceSelected?: boolean }) {
  const catalog = useQuery({ queryKey: ['assistants'], queryFn: ({ signal }) => api<AssistantCatalog>('/assistants', { signal }), staleTime: 15_000 });
  const [preparing, setPreparing] = useState<AssistantId | 'general' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [failedSelection, setFailedSelection] = useState<AssistantId | 'general' | null>(null);
  const selectionLock = useRef(false);
  const select = async (id: AssistantId | undefined) => {
    if (selectionLock.current) return;
    selectionLock.current = true; setPreparing(id ?? 'general'); setError(null); setFailedSelection(null);
    try { await onSelect(id); }
    catch (caught) { setError(caught); setFailedSelection(id ?? 'general'); }
    finally { selectionLock.current = false; setPreparing(null); }
  };
  return <div className="agents-panel">
    <p className="panel-intro">Choose a specialist for your next objective. The agent defines its approach; your model, compute depth and access controls remain separate.</p>
    {!workspaceSelected && <p className="hint">Selecting a file-capable specialist prepares a private workspace for your account. Agent access stays at your chosen permission level; a new workspace starts empty.</p>}
    {error != null && failedSelection === 'general' && <ErrorNotice error={error} />}
    {preparing && <p className="hint" role="status">Preparing your agent and file scope...</p>}
    <button className={`agent-general ${selected ? '' : 'agent-selected'}`} disabled={preparing != null} onClick={() => { void select(undefined); }} aria-pressed={!selected}><Workflow size={21} /><span><strong>General orchestration</strong><small>Let Relay work across the available capabilities.</small></span>{!selected ? <Check size={19} /> : <ChevronRight size={18} />}</button>
    <div className="section-heading"><h3>Specialists</h3><span>10 focused roles</span></div>
    {catalog.isPending ? <Loading>Checking available agent capabilities…</Loading> : catalog.isError ? <><ErrorNotice error={catalog.error} /><button className="button" onClick={() => { void catalog.refetch(); }}>Retry agent capabilities</button></> : <div className="agent-catalog">{catalog.data.assistants.map(agent => {
      const Icon = icons[agent.id] ?? Workflow;
      return <article className={`agent-profile ${selected === agent.id ? 'agent-selected' : ''}`} key={agent.id} aria-label={`${agent.name} agent`}>
        <div className="agent-profile-heading"><Icon size={22} /><h3>{agent.name}</h3>{selected === agent.id && <span className="agent-selection-mark"><Check size={14} />Selected</span>}</div>
        <p className="agent-description">{agent.description}</p>
        <span className={`agent-capability-state ${agent.status}`}><span aria-hidden="true" />{agent.available ? agent.status==='connection_required'||agent.tools.length ? statusLabels[agent.status] : 'Conversation ready' : 'Unavailable'}</span>
        {agent.limitations.length > 0 && <ul className="agent-limitations">{agent.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>}
        {agent.requiredIntegration && <p className="hint agent-integration">{agent.integrationState === 'not_implemented' ? 'Live actions are not implemented in this release: ' : agent.integrationState === 'connected' ? 'Connected integration: ' : 'Integration not configured: '}{agent.requiredIntegration}</p>}
        <details className="agent-tool-details"><summary>{agent.tools.length ? `Tools this role can request (${agent.tools.length})` : 'Tools and setup'}</summary>{agent.tools.length ? <><ul>{agent.tools.map(tool => <li key={tool}>{toolLabels[tool] ?? tool}</li>)}</ul><p className="hint">Each task checks permissions and runtime availability before enabling these tools. File tools use the selected workspace; read-only mode blocks agent edits. Website access, MCP servers and isolated commands require their own grants and available connections.</p>{!workspaceSelected && agent.tools.some(tool => tool.startsWith('file_')) && <p className="hint">Use this agent to prepare your private workspace, or choose an existing workspace first.</p>}</> : <p className="hint">This role can answer and plan now. {agent.id === 'browser' ? 'Live public-page reading requires an allowed website origin from the host owner and a task network policy. Interactive browsing is not implemented in this release; selecting this role does not enable clicks or form submissions.' : getAssistantDefinition(agent.id)?.allowedTools.some(tool => tool.startsWith('file_')) ? 'Choose this agent to prepare your private files, or select an existing workspace. Your chosen agent permissions remain in effect.' : 'Any additional tools are enabled only when their connections and permissions are available.'}</p>}</details>
        <button className="button agent-use" disabled={!agent.available || preparing != null} onClick={() => { void select(agent.id); }} aria-label={`Use ${agent.name} agent`}>{preparing === agent.id ? 'Preparing...' : selected === agent.id ? 'Keep selected' : 'Use agent'}<ChevronRight size={15} /></button>
        {error != null && failedSelection === agent.id && <ErrorNotice error={error} />}
        {!workspaceSelected && agent.tools.some(tool => tool.startsWith('file_')) && onWorkspace && <button className="text-button" disabled={preparing != null} onClick={onWorkspace}>Choose existing files</button>}
      </article>;
    })}</div>}
    <p className="hint agent-policy-note">Selecting a specialist does not connect an account or expand computer access. Integrations, actions and verification appear in Activity when they actually run.</p>
  </div>;
}
