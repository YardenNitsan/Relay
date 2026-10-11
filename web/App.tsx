import ModelPicker from './components/ModelPicker';
import StudioFrame from './layout/StudioFrame';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity as ActivityIcon, PanelRightClose, Radio, X } from 'lucide-react';
import type { ConversationDetail, SystemStatus, TaskOptions, TaskRecord, Workspace } from '../shared/types';
import { getAssistantDefinition, type AssistantId } from '../shared/assistants';
import { api, ApiError, errorMessage, initializeSession, mutation, onSessionInvalidated, refreshSession } from './api';
import { useRealtime } from './useRealtime';
import Composer from './components/Composer';
import Conversation from './components/Conversation';
import Activity from './components/Activity';
import Connection from './components/Connection';
import Navigation from './components/Navigation';
import History from './components/History';
import GoogleReturn from './components/GoogleReturn';
import GoogleWorkspaceReturn from './components/GoogleWorkspaceReturn';
import TaskModels from './components/TaskModels';
import TaskNotifications from './components/TaskNotifications';
import { useTaskNotifications } from './useTaskNotifications';
import CommandPalette, { type Command } from './components/CommandPalette';
import { isActive, Loading, Modal } from './components/ui';
import type { ModelList } from './components/Models';

const Memory = lazy(() => import('./components/Memory'));
const Schedules = lazy(() => import('./components/Schedules'));
const GoogleWorkspace = lazy(() => import('./components/GoogleWorkspace'));
const Models = lazy(() => import('./components/Models'));
const Hardware = lazy(() => import('./components/Hardware'));
const Workspaces = lazy(() => import('./components/Workspaces'));
const Access = lazy(() => import('./components/Access'));
const Mcp = lazy(() => import('./components/Mcp'));
const Agents = lazy(() => import('./components/Agents'));
const Clients = lazy(() => import('./components/Clients'));
const Usage = lazy(() => import('./components/Usage'));
type Panel = 'history' | 'models' | 'hardware' | 'workspaces' | 'commands' | 'access' | 'navigation' | 'mcp' | 'agents' | 'clients' | 'usage' | 'notifications' | 'memory' | 'schedules' | 'google-workspace' | null;
interface PendingStart { requestId: string; content: string; options: TaskOptions }
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
  const [pickModel, setPickModel] = useState<string | null>(null);
  const [activity, setActivity] = useState(false);
  const [theme, setTheme] = useState(preferredTheme);
  const [draftRequest, setDraftRequest] = useState<string | null>(null);
  const draftApplied = useCallback(() => setDraftRequest(null), []);
  const [options, setOptions] = useState<TaskOptions>(defaults);
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [stopBusy, setStopBusy] = useState(false);
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [sessionFailure, setSessionFailure] = useState<ApiError | null>(null);
  const sending = useRef(false);
  const startRequest = useRef<PendingStart | null>(null);
  const navigationVersion = useRef(0);
  useEffect(() => onSessionInvalidated(error => {
    startRequest.current = null;
    setSessionFailure(error); setPanel(null); setPickModel(null); setActivity(false); setTaskId(null); setHistoricalTask(null);
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
  const notifications = useTaskNotifications({ userId: session.data?.user?.id, enabled: ready, events: realtime.events, tasks });
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
  useEffect(() => {
    if (owner || !permissions || !workspaces.isSuccess) return;
    const personal = workspaces.data.some(workspace => workspace.id === options.workspaceId && workspace.ownerUserId === session.data?.user?.id);
    const modes = ['read_only', 'supervised', 'workspace'];
    const maximum = personal ? 'workspace' : permissions.maxAccess;
    if (options.access === 'unrestricted' || modes.indexOf(options.access) > modes.indexOf(maximum)) {
      setOptions(value => ({ ...value, access: maximum, hostAccessConfirmed: false }));
    }
  }, [owner, permissions, workspaces.isSuccess, workspaces.data, options.workspaceId, options.access, session.data?.user?.id]);

  const selectConversation = useCallback((id: string | null, anchor?: string) => {
    navigationVersion.current++;
    setDraftRequest(null);
    if (!id && !sending.current) {
      startRequest.current = null;
      try { sessionStorage.removeItem(`relay:start:v1:${session.data?.user?.id}`); } catch { /* Storage is optional. */ }
    }
    setConversationId(id); setMessageId(anchor ?? null); setHistoricalTask(null); setTaskId(null); setActivity(false); setPanel(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('conversation', id); else url.searchParams.delete('conversation');
    if (anchor) url.searchParams.set('message', anchor); else url.searchParams.delete('message');
    window.history.pushState({}, '', url);
  }, [session.data?.user?.id]);
  useEffect(() => {
    const listener = () => { navigationVersion.current++; setConversationId(currentConversation()); setMessageId(currentMessage()); setHistoricalTask(null); setTaskId(null); setActivity(false); };
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
        event.preventDefault();
        // Global shortcuts must not replace an active modal or its draft guard.
        const dialog=document.querySelector('dialog[open]');
        if (!dialog) setPanel('commands');
        else if(dialog.classList.contains('command-modal'))setPanel(null);
      }
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setActivity(false);
    };
    window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener);
  }, []);
  const send = async (content: string) => {
    if (sending.current) throw new Error('Another objective is still being sent. Your draft is saved; try again when it finishes.');
    sending.current = true;
    const navigationAtSend = navigationVersion.current;
    const requestKey = `relay:start:v1:${session.data?.user?.id}`;
    try {
      if (!conversationId && !startRequest.current) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(requestKey) ?? 'null') as PendingStart | null;
          if (saved && typeof saved.requestId === 'string' && typeof saved.content === 'string' && saved.options) startRequest.current = saved;
        } catch { /* Retry protection still works in memory. */ }
        startRequest.current ??= { requestId: crypto.randomUUID(), content, options: structuredClone(options) };
        try { sessionStorage.setItem(requestKey, JSON.stringify(startRequest.current)); } catch { /* Storage is optional. */ }
      }
      if (!conversationId && startRequest.current?.content !== content) throw new Error('A previous first objective is awaiting confirmation. Retry its original text or choose New conversation.');
      const response = conversationId
        ? await mutation<{ task: TaskRecord }>(`/conversations/${conversationId}/messages`, { content, options })
        : await mutation<{ task: TaskRecord }>('/conversations/start', startRequest.current);
      const id = response.task.conversationId;
      notifications.track(response.task.id);
      startRequest.current = null;
      try { sessionStorage.removeItem(requestKey); } catch { /* Storage is optional. */ }
      if (navigationAtSend === navigationVersion.current) {
        if (conversationId !== id || messageId) selectConversation(id);
        setReaderVersion(value => value + 1);
        setTaskId(response.task.id);
      }
      await Promise.all([client.invalidateQueries({ queryKey: ['conversation', id] }), client.invalidateQueries({ queryKey: ['history'] })]);
    } finally { sending.current = false; }
  };
  const conversationDeleted = (id: string) => {
    void client.cancelQueries({ queryKey: ['conversation', id] });
    client.removeQueries({ queryKey: ['conversation', id] });
    client.removeQueries({ queryKey: ['history-messages', id] });
    try { localStorage.removeItem(`relay:draft:v1:${session.data?.user?.id}:${id}`); } catch { /* Storage is optional. */ }
    if (conversationId === id) selectConversation(null);
    setNotice({ message: 'Conversation deleted from history.', error: false });
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
  const selectAgent = async (id: AssistantId | undefined) => {
    const definition = getAssistantDefinition(id);
    let workspaceId = options.workspaceId;
    if (definition?.allowedTools.some(tool => tool.startsWith('file_')) && !workspaceId) {
      const workspace = await mutation<Workspace>('/workspaces', { name: `${definition.name} files`, personal: true });
      client.setQueryData<Workspace[]>(['workspaces'], current => [...(current ?? []).filter(item => item.id !== workspace.id), workspace]);
      workspaceId = workspace.id;
      void client.invalidateQueries({ queryKey: ['assistants'] });
    }
    setOptions(value => {
      const next = { ...value, workspaceId };
      if (id) next.assistantId = id; else delete next.assistantId;
      return next;
    });
    setPanel(null);
  };
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
    { id: 'notifications', label: 'Task notifications', description: 'Private completion alerts for this browser', action: () => setPanel('notifications') },
    { id: 'new', label: 'New conversation', description: 'Start a new objective', action: () => selectConversation(null) },
    { id: 'history', label: 'Open conversation history', description: 'Return to previous work', action: () => setPanel('history') },
    { id: 'clients', label: 'Connect an external client', description: 'Account-scoped model API tokens', action: () => setPanel('clients') },
    { id: 'agents', label: 'Choose an agent', description: 'Specialist roles and current capabilities', action: () => setPanel('agents') },
    { id: 'models', label: 'Choose a model', description: 'Models and provider connections', action: () => setPanel('models') },
    { id: 'memory', label: 'Manage memory', description: 'Inspect approved project notes and personal preferences', action: () => setPanel('memory') },
    { id: 'google-workspace', label: 'Google Workspace', description: 'Connect your account for approved mail and calendar reads', action: () => setPanel('google-workspace') },
    ...(owner ? [{ id: 'schedules', label: 'Manage schedules', description: 'Approve bounded local tasks and inspect scheduled runs', action: () => setPanel('schedules') }] : []),
    { id: 'usage', label: 'Usage', description: 'Your token usage and reported provider rate limits', action: () => setPanel('usage') },
    ...(owner ? [{ id: 'mcp', label: 'Manage MCP tools', description: 'Review tool contracts and control server access', action: () => setPanel('mcp') }] : []),
    { id: 'workspace', label: 'Manage workspaces', description: 'Import a project or inspect managed files', action: () => setPanel('workspaces') },
    ...(owner ? [{ id: 'hardware', label: 'Inspect this machine', description: 'Measured resource and execution boundary information', action: () => setPanel('hardware') }, { id: 'access', label: 'Manage access', description: 'Remote gateway, allowed users and session revocation', action: () => setPanel('access') }] : []),
    { id: 'activity', label: 'Open activity', description: 'Work log, approvals, changes and verification', action: () => setActivity(true) },
    { id: 'theme', label: `Switch to ${theme === 'light' ? 'dark' : 'light'} theme`, description: 'Change the reading surface', action: () => setTheme(value => value === 'light' ? 'dark' : 'light') },
    ...(owner ? [{ id: 'stop', label: 'Stop all agents', description: 'Immediately block new work and cancel managed execution', action: () => { void emergencyStop(); }, disabled: !ready || stopped || stopBusy }] : []),
    ...(owner && stopped ? [{ id: 'resume', label: 'Resume Relay service', description: 'Allow new work; existing tasks remain stopped', action: () => { void resumeService(); } }] : []),
  ];

  if (!ready) return <Connection pending={!sessionFailure && session.isPending} error={sessionFailure ?? session.error} onPaired={data => { client.setQueryData(['session'], data); setSessionFailure(null); setNotice(null); }} onRetry={() => { void reconnect(); }} />;

  return <StudioFrame workbenchOpen={activity} title={conversation.data?.conversation.title ?? 'New conversation'} hostName={session.data?.hostName} owner={owner} theme={theme} stopped={stopped} stopBusy={stopBusy} onDestination={setPanel} onNew={() => selectConversation(null)} onConversation={() => { setPanel(null); setActivity(false); }} onWorkbench={() => setActivity(true)} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')} onStop={() => { void emergencyStop(); }}>
    {backendUnavailable && <div className="service-banner error" role="alert"><span>The service is unavailable or this session has expired. Your draft stays in this browser.</span><button onClick={() => { void reconnect(); }}>Reconnect</button></div>}
    {!backendUnavailable && realtime.connection === 'reconnecting' && <div className="service-banner"><span>Live activity is reconnecting. Persisted work remains available.</span><button onClick={() => { void reconnect(); }}>Reconnect activity</button></div>}
    {stopped && <div className="service-banner warning" role="status"><span><strong>All work is stopped.</strong> {owner ? 'Resume the service to allow new objectives.' : 'The host owner can resume the service.'}</span>{owner && <button disabled={stopBusy} onClick={() => { void resumeService(); }}>Resume Relay</button>}</div>}
    {notice && <div className={`service-banner ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {notifications.notice && <div className="service-banner" role="status" aria-label="Task completion notification"><span>{notifications.notice}</span><button className="icon-button" aria-label="Dismiss task notification" onClick={notifications.dismiss}><X size={16} /></button></div>}
    <div className={`workspace-layout ${activity ? 'has-inspector' : ''}`}><main id="main" className="conversation-main"><div className="conversation-toolbar"><div className="connection-status"><span className={`connection-dot ${ready && realtime.connection === 'live' && !backendUnavailable ? 'connected' : ''}`} /><span>{backendUnavailable ? 'Service disconnected' : !ready ? 'Connecting to Relay' : realtime.connection === 'live' ? remote ? `Connected to ${session.data?.hostName ?? 'shared host'}` : 'Local service connected' : realtime.connection === 'reconnecting' ? 'Reconnecting to activity…' : 'Connecting activity…'}</span></div>{remote && <button className="account-indicator" aria-label="Account and host" onClick={() => setPanel('navigation')}>{session.data?.user?.name ?? 'Your account'}</button>}<button id="activity-toggle" className={`activity-toggle ${activity ? 'active' : ''}`} onClick={() => setActivity(value => !value)} aria-expanded={activity}>{activity ? <PanelRightClose size={16} /> : <ActivityIcon size={16} />}<span>Activity</span>{running && <span className="activity-dot" />}</button></div>
      <GoogleReturn onModels={() => setPanel('models')} />
      <GoogleWorkspaceReturn onOpen={() => setPanel('google-workspace')} />
      <Conversation onDraft={setDraftRequest} key={`${conversationId ?? 'new'}:${readerVersion}`} focusMessageId={messageId} onReturnLatest={returnLatest} detail={conversation.data} loading={Boolean(conversationId) && conversation.isPending} error={conversation.isError ? conversation.error : null} onRetry={() => { void conversation.refetch(); }} streams={realtime.text} events={realtime.events} models={modelList} onInspect={inspect} onModels={() => setPanel('models')} onWorkspace={() => setPanel('workspaces')} />
      <TaskModels task={latestTask} events={realtime.events} models={modelList} onInspect={id => inspect(id)} />
      <Composer draftRequest={draftRequest} onDraftApplied={draftApplied} key={`${session.data?.user?.id ?? 'pending'}:${conversationId ?? 'new'}`} conversationId={conversationId} options={options} onOptions={setOptions} onAgents={() => setPanel('agents')} models={modelList} providers={models.data?.providers ?? []} onModels={() => setPanel('models')} workspaces={workspaces.data ?? []} onWorkspace={() => setPanel('workspaces')} onSend={send} disabled={!ready || backendUnavailable} stopped={stopped} running={running} status={status.data} owner={owner} permissions={permissions} userId={session.data?.user?.id ?? 'pending'} />
    </main>{activity && <Activity onAdmitted={notifications.track} taskId={selectedTaskId} tasks={tasks} events={realtime.events} workspaces={workspaces.data ?? []} hostName={session.data?.hostName} onSelect={setTaskId} onClose={() => { setActivity(false); requestAnimationFrame(() => document.getElementById('activity-toggle')?.focus()); }} stopped={stopped} />}</div>
    <footer className="app-footer"><span><Radio size={12} />Your work stays accountable.</span><span>{status.data ? `Relay ${status.data.version}` : 'Relay'}<span className="footer-separator" />{options.cloudPolicy === 'local_only' ? 'Local inference only' : 'Cloud access controlled'}</span></footer>
    {panel === 'history' && <Modal title="Conversations" onClose={() => setPanel(null)}><History onDeleted={conversationDeleted} selected={conversationId} onSelect={selectConversation} onNew={() => selectConversation(null)} /></Modal>}
    {panel === 'notifications' && <Modal title="Task notifications" onClose={() => setPanel(null)}><TaskNotifications controls={notifications} /></Modal>}
    {panel === 'usage' && <Modal title="Usage" className="usage-drawer" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening usage…</Loading>}><Usage /></Suspense></Modal>}
    {panel === 'clients' && <Modal title="External clients" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening client access…</Loading>}><Clients permitted={owner || permissions?.externalModelAccess === true} /></Suspense></Modal>}
    {panel === 'agents' && <Modal title="Agents" onClose={() => setPanel(null)} wide className="agent-studio-modal"><Suspense fallback={<Loading>Opening agents…</Loading>}><Agents selected={options.assistantId} workspaceSelected={Boolean(options.workspaceId)} onWorkspace={() => setPanel('workspaces')} onSelect={selectAgent} /></Suspense></Modal>}
    {pickModel && <ModelPicker open initialModelId={pickModel} onClose={() => setPickModel(null)} models={modelList} providers={models.data?.providers ?? []} options={options} onOptions={setOptions} onConnections={() => setPanel('models')} canUseCloud={owner || Boolean((permissions?.dailyCloudBudgetUsd || permissions?.allowUnpricedCloud) && permissions.providers.some(provider => !['ollama', 'lmstudio'].includes(provider)))} />}
    {panel === 'models' && <Modal title="Models & connections" onClose={() => setPanel(null)} wide className="model-studio-modal"><Suspense fallback={<Loading>Opening models…</Loading>}><Models owner={owner} hostName={session.data?.hostName} accountName={session.data?.user?.name} contextTokens={options.contextTokens} onSelect={id => { setPickModel(id); setPanel(null); }} /></Suspense></Modal>}
    {panel === 'mcp' && owner && <Modal title="MCP tools" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening tool connections…</Loading>}><Mcp /></Suspense></Modal>}
    {panel === 'memory' && <Modal title="Your memory" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening memory...</Loading>}><Memory workspaces={workspaces.data ?? []} /></Suspense></Modal>}
    {panel === 'google-workspace' && <Modal title="Google Workspace" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening Google Workspace...</Loading>}><GoogleWorkspace owner={owner} /></Suspense></Modal>}
    {panel === 'schedules' && <Modal title="Scheduled tasks" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening schedules...</Loading>}><Schedules workspaces={workspaces.data ?? []} onOpenTask={id => { void api<{task:TaskRecord}>(`/tasks/${encodeURIComponent(id)}`).then(({task}) => selectConversation(task.conversationId)).catch(error => setNotice({message:errorMessage(error),error:true})); }} /></Suspense></Modal>}
    {panel === 'hardware' && owner && <Modal title="This machine" onClose={() => setPanel(null)}><Suspense fallback={<Loading>Opening resource view…</Loading>}><Hardware status={status.data} /></Suspense></Modal>}
    {panel === 'workspaces' && <Modal title="Workspaces" onClose={() => setPanel(null)} wide className="projects-dialog"><Suspense fallback={<Loading>Opening workspaces…</Loading>}><Workspaces owner={owner} userId={session.data?.user?.id} canWriteShared={permissions?.maxAccess !== undefined && permissions.maxAccess !== 'read_only'} selected={options.workspaceId} onSelect={id => setOptions(value => ({ ...value, workspaceId: id }))} /></Suspense></Modal>}
    {panel === 'access' && owner && <Modal title="Access & remote connections" onClose={() => setPanel(null)} wide><Suspense fallback={<Loading>Opening access controls…</Loading>}><Access /></Suspense></Modal>}
    {panel === 'commands' && <CommandPalette commands={commands} onClose={() => setPanel(null)} />}
    {panel === 'navigation' && <Navigation owner={owner} theme={theme} hostName={session.data?.hostName} session={session.data} onDestination={setPanel} onNew={() => selectConversation(null)} onActivity={() => { setPanel(null); setActivity(true); }} onTheme={() => setTheme(value => value === 'light' ? 'dark' : 'light')} onClose={() => setPanel(null)} />}
  </StudioFrame>;
}
