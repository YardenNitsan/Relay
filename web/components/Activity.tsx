import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListTree, Maximize2, Minimize2, Play, ShieldCheck, Square, X } from 'lucide-react';
import type { ActivityEvent, TaskDetail, TaskRecord, Workspace } from '../../shared/types';
import { api, mutation } from '../api';
import { approvalContext } from '../approval';
import { mergeEvents } from '../realtime-state';
import ExecutionOverview from './ExecutionOverview';
import { Empty, ErrorNotice, humanize, isActive, Loading, Status, time } from './ui';
import ApprovalCard from '../features/workbench/ApprovalCard';
import Changes from '../features/workbench/Changes';
import EventRow from '../features/workbench/EventRow';
import '../features/workbench/workbench.css';
import {useRememberedFocus} from '../layout/useRememberedFocus';

type Tab = 'activity' | 'files' | 'verification' | 'log';
const tabs: { id: Tab; label: string }[] = [{ id: 'activity', label: 'Workflow' }, { id: 'files', label: 'Changes' }, { id: 'verification', label: 'Verification' }, {id:'log',label:'Work log'}];

export default function Activity({ taskId, tasks, events, workspaces, hostName, onSelect, onClose, stopped, onAdmitted }: { taskId: string | null; tasks: TaskRecord[]; events: ActivityEvent[]; workspaces: Workspace[]; hostName: string | undefined; onSelect: (id: string) => void; onClose: () => void; stopped: boolean; onAdmitted?: (id: string) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['task', taskId], queryFn: ({ signal }) => api<TaskDetail>(`/tasks/${taskId}`, { signal }), enabled: Boolean(taskId) });
  const [tab, setTab] = useState<Tab>('activity');
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const lastFocused=useRememberedFocus();
  const data = query.data;
  const task = data?.task;
  const combined = mergeEvents(data?.events ?? [], events.filter(event => event.taskId === taskId), 1000).filter(event => event.type !== 'MODEL_TEXT');
  useEffect(() => { setError(null); setLimit(80); }, [taskId]);
  useEffect(() => {
    const compact=window.matchMedia('(max-width: 999px)');
    const focusClose=()=>document.querySelector<HTMLButtonElement>('.activity-panel button[aria-label="Close activity"]')?.focus();
    const resized=()=>{
      const active=document.activeElement===document.body?lastFocused.current:document.activeElement;
      if(compact.matches&&active?.closest('.conversation-main, .inspector-expand'))focusClose();
    };
    if(compact.matches)focusClose();
    compact.addEventListener('change',resized);
    return ()=>compact.removeEventListener('change',resized);
  }, [lastFocused]);
  const run = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { await mutation(path, body); if (taskId && path.endsWith('/resume')) onAdmitted?.(taskId); await Promise.all([client.invalidateQueries({ queryKey: ['task', taskId] }), client.invalidateQueries({ queryKey: ['conversation'] }), client.invalidateQueries({ queryKey: ['status'] })]); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <aside id="workbench" tabIndex={-1} className={`activity-panel studio-workbench ${expanded ? 'activity-expanded' : ''}`} aria-label="Task activity"><header className="inspector-heading"><div><span className="inspector-overline">Execution on {hostName??'unreported host'}</span><h2>Execution Workbench</h2></div><div className="button-row"><button className="icon-button inspector-expand" aria-label={expanded ? 'Show conversation alongside' : 'Focus workbench'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button className="icon-button" aria-label="Close activity" onClick={onClose}><X size={18} /></button></div></header>
    {tasks.length > 1 && <label className="task-select">Task<select value={taskId ?? ''} onChange={event => onSelect(event.target.value)}>{tasks.map(item => <option key={item.id} value={item.id}>{item.objective.slice(0, 65)}</option>)}</select></label>}
    {task && <div className="task-summary"><Status status={task.status} /><span className="small muted">{task.callsUsed} model calls</span><div className="task-controls">{isActive(task.status) && <button className="text-button" disabled={busy} onClick={() => { void run(`/tasks/${task.id}/cancel`); }}><Square size={12} />Cancel task</button>}{['paused', 'waiting_for_user'].includes(task.status) && <button className="text-button" disabled={busy || stopped} title={stopped ? 'Resume the service before resuming a task' : undefined} onClick={() => { void run(`/tasks/${task.id}/resume`); }}><Play size={13} />Resume task</button>}</div></div>}
    <div className="inspector-tabs" role="tablist" aria-label="Execution detail">{tabs.map((item, index) => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const nextTab = tabs[next]!; setTab(nextTab.id); document.getElementById(`tab-${nextTab.id}`)?.focus();
    }}>{item.label}{item.id === 'files' && Boolean(data?.changes.length) && <span>{data?.changes.length}</span>}</button>)}</div>
    <div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
    {task&&<details className="workbench-objective"><summary><span>Objective</span><strong>{task.objective}</strong></summary><p>{task.objective}</p><dl><dt>Workspace</dt><dd>{workspaces.find(item=>item.id===task.options.workspaceId)?.name??(task.options.workspaceId?'Workspace unavailable':'No workspace selected')}</dd><dt>Task permissions</dt><dd>{humanize(task.options.access)}</dd></dl></details>}
      {error != null && <ErrorNotice error={error} />}{busy && <Loading>Applying your decision…</Loading>}
      {!taskId ? <Empty title="Your work will appear here" icon={<ListTree size={29} />}><p>Send an objective to inspect its models, tools, decisions and evidence.</p></Empty> : query.isPending ? <Loading>Opening execution record…</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : data && <>
        {data.approvals.filter(approval => approval.status === 'pending').map(approval => <ApprovalCard key={approval.id} approval={approval} task={data.task} context={approvalContext(approval, data.task.options.workspaceId, workspaces, [...data.events, ...events])} hostName={hostName} busy={busy || stopped} working={busy} error={error} onDecision={(id, decision) => { void run(`/approvals/${id}`, { decision }); }} />)}
        {task?.error && <div className="notice warning"><strong>{task.status === 'failed' ? 'Task could not complete' : 'Task needs attention'}</strong><p>{task.error}</p></div>}
        {tab === 'activity' && <ExecutionOverview data={data} />}
        {tab === 'log' && <><div className="section-heading"><h3>Work log</h3><span className="small muted">Factual activity</span></div>{combined.length ? <>{combined.length > limit && <button className="text-button older-events" onClick={() => setLimit(value => Math.min(1000, value + 100))}>Show earlier events ({combined.length - limit})</button>}<div className="event-thread">{combined.slice(-limit).map(event => <EventRow key={event.id} event={event} />)}</div></> : <p className="muted">No execution events recorded yet.</p>}</>}
        {tab === 'files' && <Changes changes={data.changes} busy={busy} onRevert={id => { void run(`/tasks/${taskId}/revert`, { checkpointId: id }); }} />}
        {tab === 'verification' && <>{data.verification.length ? <div className="verification-list">{data.verification.map(item => <article key={item.id} className="verification"><div className="split"><h3>{humanize(item.kind)}</h3><Status status={item.passed ? 'passed' : 'failed'} /></div><p>{item.summary}</p><span className="small muted">Recorded {time(item.createdAt)}</span>{Object.keys(item.details).length > 0 && <details><summary>Inspect evidence</summary><pre className="bounded-output">{JSON.stringify(item.details, null, 2).slice(0, 12_000)}</pre></details>}</article>)}</div> : <Empty title="No verification evidence yet" icon={<ShieldCheck size={29} />}><p>Model confidence and agreement are not verification. Tool checks and their results appear here.</p></Empty>}<p className="hint">Evidence is scoped to the checks that actually ran. Task completion does not imply every possible behavior was tested.</p></>}
      </>}
    </div>
  </aside>;
}
