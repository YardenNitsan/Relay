import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity as ActivityIcon, ChevronDown, Command as CommandIcon, Cpu, Layers, Menu, Moon, PanelRightClose, Plus, Radio, ShieldCheck, Square, Sun, X } from 'lucide-react';
import type { Conversation as ConversationRecord, ConversationDetail, SystemStatus, TaskOptions, TaskRecord, Workspace } from '../shared/types';
import { api, ApiError, errorMessage, initializeSession, mutation, onSessionInvalidated, refreshSession } from './api';
import { useRealtime } from './useRealtime';
import Composer from './components/Composer';
import Conversation from './components/Conversation';
import Activity from './components/Activity';
import Connection from './components/Connection';
import Navigation from './components/Navigation';
import History from './components/History';
import CommandPalette, { type Command } from './components/CommandPalette';
import { isActive, Loading, Modal } from './components/ui';
import type { ModelList } from './components/Models';

const Models = lazy(() => import('./components/Models'));
const Hardware = lazy(() => import('./components/Hardware'));
const Workspaces = lazy(() => import('./components/Workspaces'));
const Access = lazy(() => import('./components/Access'));
const Mcp = lazy(() => import('./components/Mcp'));
type Panel = 'history' | 'models' | 'hardware' | 'workspaces' | 'commands' | 'access' | 'navigation' | 'mcp' | null;
const defaults: TaskOptions = { depth: 'balanced', modelId: null, access: 'read_only', workspaceId: null, contextTokens: 8192, cloudPolicy: 'local_only', budget: { maxCalls: 12, maxSeconds: 600, maxIterations: 5, maxCostUsd: null, localOnly: true } };

function currentConversation() { return new URLSearchParams(window.location.search).get('conversation'); }
function currentMessage() { return new URLSearchParams(window.location.search).get('message'); }
function preferredTheme(): 'dark' | 'light' {
  try { const stored = localStorage.getItem('relay:theme:v1'); if (stored === 'dark' || stored === 'light') return stored; } catch { /* Follow system preference. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function App() {
  const client = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(currentConversation);
  const [messageId, setMessageId] = useState<string | null>(currentMessage);
  const [historicalTask, setHistoricalTask] = useState<TaskRecord | null>(null);
  const [readerVersion, setReaderVersion] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [activity, setActivity] = useState(false);
  const [theme, setTheme] = useState(preferredTheme);
  const [options, setOptions] = useState<TaskOptions>(defaults);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [sessionFailure, setSessionFailure] = useState<ApiError | null>(null);
  useEffect(() => onSessionInvalidated(error => {
    setSessionFailure(error); setPanel(null); setActivity(false); setTaskId(null); setHistoricalTask(null);
    setOptions(defaults); setNotice(null);
    void client.cancelQueries();
    client.clear();
  }), [client]);
  const session = useQuery({ queryKey: ['session'], queryFn: initializeSession, enabled: !sessionFailure, retry: (count, error) => !(error instanceof ApiError && [401, 403].includes(error.status)) && count < 1, staleTime: Infinity });
  const ready = session.isSuccess && sessionFailure === null;
  const owner = session.data?.user?.role === 'owner' && session.data.remote === false;
  const permissions = session.data?.user?.permissions;
  const remote = session.data?.remote === true;
  const status = useQuery({ queryKey: ['status'], queryFn: ({ signal }) => api<SystemStatus>('/status', { signal }), enabled: ready, refetchInterval: 10_000 });
  const conversation = useQuery({ queryKey: ['conversation', conversationId], queryFn: ({ signal }) => api<ConversationDetail>(`/conversations/${conversationId}`, { signal }), enabled: ready && Boolean(conversationId) });
  const models = useQuery({ queryKey: ['models'], queryFn: ({ signal }) => api<ModelList>('/models', { signal }), enabled: ready, staleTime: 30_000 });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: ({ signal }) => api<Workspace[]>('/workspaces', { signal }), enabled: ready });
  const realtime = useRealtime(ready, streamGeneration);
  const recentTasks = conversation.data?.tasks ?? [];
  const tasks = historicalTask && !recentTasks.some(task => task.id === historicalTask.id) ? [...recentTasks, historicalTask] : recentTasks;
  const latestTask = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const selectedTaskId = taskId && tasks.some(task => task.id === taskId) ? taskId : latestTask?.id ?? null;
  const running = tasks.some(task => isActive(task.status));
  const stopped = status.data?.stopped ?? false;
  const backendUnavailable = session.isError || status.isError;
  const modelList = models.data?.models ?? [];
  useEffect(() => {
    if (!permissions) return;
    setOptions(value => ({ ...value, budget: { ...value.budget, maxCalls: Math.min(value.budget.maxCalls, permissions.maxCallsPerTask), maxSeconds: Math.min(value.budget.maxSeconds, permissions.maxSecondsPerTask) } }));
  }, [permissions]);

  const selectConversation = useCallback((id: string | null, anchor?: string) => {
    setConversationId(id); setMessageId(anchor ?? null); setHistoricalTask(null); setTaskId(null); setActivity(false); setPanel(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('conversation', id); else url.searchParams.delete('conversation');
    if (anchor) url.searchParams.set('message', anchor); else url.searchParams.delete('message');
    window.history.pushState({}, '', url);
  }, []);
  useEffect(() => {
    const listener = () => { setConversationId(currentConversation()); setMessageId(currentMessage()); setHistoricalTask(null); setTaskId(null); setActivity(false); };
    window.addEventListener('popstate', listener); return () => window.removeEventListener('popstate', listener);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('relay:theme:v1', theme); } catch { /* Theme still applies for the current view. */ }
  }, [theme]);
  useEffect(() => {
    document.title = conversation.data ? `${conversation.data.conversation.title} — Relay` : 'Relay — Your work, in motion';
  }, [conversation.data?.conversation.title]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setPanel(value => value === 'commands' ? null : 'commands');
      }
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setActivity(false);
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  const send = async (content: string) => {
    let id = conversationId;
    if (!id) {
      const created = await mutation<ConversationRecord>('/conversations', { title: content.slice(0, 80) });
      id = created.id;
    }
    const response = await mutation<{ task: TaskRecord }>(`/conversations/${id}/messages`, { content, options });
    if (conversationId !== id || messageId) selectConversation(id);
    setReaderVersion(value => value + 1);
    setTaskId(response.task.id);
    await Promise.all([client.invalidateQueries({ queryKey: ['conversation', id] }), client.invalidateQueries({ queryKey: ['history'] })]);
  };
  const emergencyStop = async () => {
    setStopBusy(true);
    try { const next = await mutation<SystemStatus>('/stop'); client.setQueryData(['status'], next); setNotice({ message: 'Stop requested. New work is blocked; managed work is being cancelled.', error: false }); await client.invalidateQueries({ queryKey: ['conversation'] }); }
    catch (error) { setNotice({ message: `Stop could not be confirmed: ${errorMessage(error)}`, error: true }); }
    finally { setStopBusy(false); }
  };
  const resumeService = async () => {
    setStopBusy(true);
    try { await mutation('/resume'); await client.invalidateQueries({ queryKey: ['status'] }); setNotice({ message: 'Relay can accept new work. Paused tasks require their own resume action.', error: false }); }
    catch (error) { setNotice({ message: errorMessage(error), error: true }); }
    finally { setStopBusy(false); }
  };
  const inspect = (id: string, task?: TaskRecord) => { if (task) setHistoricalTask(task); setTaskId(id); setActivity(true); };
  const returnLatest = () => { setMessageId(null); const url = new URL(window.location.href); url.searchParams.delete('message'); window.history.replaceState({}, '', url); };
  const reconnect = async () => {
    try {
      const renewed = await refreshSession(); client.setQueryData(['session'], renewed);
      setSessionFailure(null);
      setStreamGeneration(value => value + 1);
      await Promise.all(['status', 'conversation', 'task', 'models'].map(key => client.invalidateQueries({ queryKey: [key] })));
    } catch (error) { setNotice({ message: errorMessage(error), error: true }); await client.resetQueries({ queryKey: ['session'], exact: true }); }
  };
  const commands: Command[] = [
    { id: 'new', label: 'New conversation', description: 'Start a new objective', action: () => selectConversation(null) },
    { id: 'history', label: 'Open conversation history', description: 'Return to previous work', action: () => setPanel('history') },
    { id: 'models', label: 'Choose a model', description: 'Models and provider connections', action: () => setPanel('models') },
    ...(owner ? [{ id: 'mcp', label: 'Manage MCP tools', description: 'Review tool contracts and control server access', action: () => setPanel('mcp') }] : []),
    { id: 'workspace', label: 'Manage workspaces', description: 'Import a project or inspect managed files', action: () => setPanel('workspaces') },
    ...(owner ? [{ id: 'hardware', label: 'Inspect this machine', description: 'Measured resource and execution boundary information', action: () => setPanel('hardware') }, { id: 'access', label: 'Manage access', description: 'Remote gateway, allowed users and session revocation', action: () => setPanel('access') }] : []),
    { id: 'activity', label: 'Open activity', description: 'Work log, approvals, changes and verification', action: () => setActivity(true) },
    { id: 'theme', label: `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`, description: 'Change the reading surface', action: () => setTheme(value => value === 'light' ? 'dark' : 'light') },
    ...(owner ? [{ id: 'stop', label: 'Stop all agents', description: 'Immediately block new work and cancel managed execution', action: () => { void emergencyStop(); }, disabled: !ready || stopped || stopBusy }] : []),
    ...(owner && stopped ? [{ id: 'resume', label: 'Resume Relay service', description: 'Allow new work; existing tasks remain stopped', action: () => { void resumeService(); } }] : []),
  ];

  if (!ready) return <Connection pending={!sessionFailure && session.isPending} error={sessionFailure ?? session.error} onPaired={data => { client.setQueryData(['session'], data); setSessionFailure(null); setNotice(null); }} onRetry={() => { void reconnect(); }} />;

  return <div className="app"><a className="skip-link" href="#main">Skip to conversation</a><header className="app-header"><button className="brand" onClick={() => selectConversation(null)} aria-label="Relay home"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>relay</span></button><span className="header-divider" /><button className="conversation-switcher" aria-label="Open conversation history" onClick={() => setPanel('history')}><span>{conversation.data?.conversation.title ?? 'New conversation'}</span><ChevronDown size={14} /></button><button className="icon-button new-conversation" aria-label="New conversation" onClick={() => selectConversation(null)}><Plus size={18} /></button><nav className="main-nav" aria-label="Workspace navigation"><button onClick={() => setPanel('models')} aria-label="Models"><Layers size={16} /><span>Models</span></button>{owner && <><button onClick={() => setPanel('hardware')} aria-label="Machine"><Cpu size={16} /><span>Machine</span></button><button onClick={() => setPanel('access')} aria-label="Access"><ShieldCheck size={16} /><span>Access</span></button></>}<button className="command-trigger" onClick={() => setPanel('commands')} aria-label="Open command palette"><CommandIcon size={16} /><span>Commands</span><kbd>Ctrl K</kbd></button></nav><button className="mobile-navigation" onClick={() => setPanel('navigation')} aria-label="Open navigation"><Menu size={19} /><span>Menu</span></button><button className="icon-button theme-button" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>{owner && <button className="stop-all" onClick={() => { void emergencyStop(); }} disabled={!ready || stopped || stopBusy}><Square size={12} fill="currentColor" /><span>{stopBusy ? 'Stopping…' : stopped ? 'Stopped' : 'Stop all'}</span></button>}</header>
    {backendUnavailable && <div className="service-banner error" role="alert"><span>The service is unavailable or this session has expired. Your draft stays in this browser.</span><button onClick={() => { void reconnect(); }}>Reconnect</button></div>}
    {!backendUnavailable && realtime.connection === 'reconnecting' && <div className="service-banner"><span>Live activity is reconnecting. Persisted work remains available.</span><button onClick={() => { void reconnect(); }}>Reconnect activity</button></div>}
    {stopped && <div className="service-banner warning" role="status"><span><strong>All work is stopped.</strong> {owner ? 'Resume the service to allow new objectives.' : 'The host owner can resume the service.'}</span>{owner && <button disabled={stopBusy} onClick={() => { void resumeService(); }}>Resume Relay</button>}</div>}
    {notice && <div className={`service-banner ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    <div className={`workspace-layout ${activity ? 'has-inspector' : ''}`}><main id="main" className="conversation-main"><div className="conversation-toolbar"><div className="connection-status"><span className={`connection-dot ${ready && realtime.connection === 'live' && !backendUnavailable ? 'connected' : ''}`} /><span>{backendUnavailable ? 'Service disconnected' : !ready ? 'Connecting to Relay' : realtime.connection === 'live' ? remote ? `Connected to ${session.data?.hostName ?? 'shared host'}` : 'Local service connected' : realtime.connection === 'reconnecting' ? 'Reconnecting to activity…' : 'Connecting activity…'}</span></div><button id="activity-toggle" className={`activity-toggle ${activity ? 'active' : ''}`} onClick={() => setActivity(value => !value)} aria-expanded={activity}>{activity ? <PanelRightClose size={16} /> : <ActivityIcon size={16} />}<span>Activity</span>{running && <span className="activity-dot" />}</button></div>
      <Conversation key={`${conversationId ?? 'new'}:${readerVersion}`} focusMessageId={messageId} onReturnLatest={returnLatest} detail={conversation.data} loading={Boolean(conversationId) && conversation.isPending} error={conversation.isError ? conversation.error : null} onRetry={() => { void conversation.refetch(); }} streams={realtime.text} events={realtime.events} models={modelList} onInspect={inspect} onModels={() => setPanel('models')} onWorkspace={() => setPanel('workspaces')} />
      <Composer key={`${session.data?.user?.id ?? 'pending'}:${conversationId ?? 'new'}`} conversationId={conversationId} options={options} onOptions={setOptions} models={modelList} workspaces={workspaces.data ?? []} onWorkspace={() => setPanel('workspaces')} onSend={send} disabled={!ready || backendUnavailable} stopped={stopped} running={running} status={status.data} owner={owner} permissions={permissions} userId={session.data?.user?.id ?? 'pending'} />
    </main>{activity && <Activity taskId={selectedTaskId} tasks={tasks} events={realtime.events} workspaces={workspaces.data ?? []} hostName={session.data?.hostName} onSelect={setTaskId} onClose={() => { setActivity(false); requestAnimationFrame(() => document.getElementById('activity-toggle')?.focus()); }} stopped={stopped} />}</div>
    <footer className="app-footer"><span><Radio size={12} />Your work stays accountable.</span><span>{status.data ? `Relay ${status.data.version}` : 'Relay'}<span className="footer-separator" />{options.cloudPolicy === 'local_only' ? 'Local inference only' : 'Cloud access controlled'}</span></footer>
    {panel === 'history' && <Modal title="Conversations" onClose={() => setPanel(null)}><History selected={conversationId} onSelect={selectConversation} onNew={() => selectConversation(null)} /></Modal>}
    {panel === 'models' && <Modal title="Models & connections" onClose={() => setPanel(null)} wide><Suspense fallback={<Loading>Opening models…</Loading>}><Models owner={owner} contextTokens={options.contextTokens} onSelect={id => { setOptions(value => ({ ...value, modelId: id })); setPanel(null); }} /></Suspense></Modal>}
    {panel === 'mcp' && owner && <Modal title="MCP tools" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening tool connections…</Loading>}><Mcp /></Suspense></Modal>}
    {panel === 'hardware' && owner && <Modal title="This machine" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening resource view…</Loading>}><Hardware status={status.data} /></Suspense></Modal>}
    {panel === 'workspaces' && <Modal title="Workspaces" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening workspaces…</Loading>}><Workspaces owner={owner} selected={options.workspaceId} onSelect={id => setOptions(value => ({ ...value, workspaceId: id }))} /></Suspense></Modal>}
    {panel === 'access' && owner && <Modal title="Access & remote connections" onClose={() => setPanel(null)} wide><Suspense fallback={<Loading>Opening access controls…</Loading>}><Access /></Suspense></Modal>}
    {panel === 'commands' && <CommandPalette commands={commands} onClose={() => setPanel(null)} />}
    {panel === 'navigation' && <Navigation owner={owner} theme={theme} hostName={session.data?.hostName} onDestination={setPanel} onNew={() => selectConversation(null)} onActivity={() => { setPanel(null); setActivity(true); }} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')} onClose={() => setPanel(null)} />}
  </div>;
}
