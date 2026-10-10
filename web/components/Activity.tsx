import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, CircleAlert, Copy, Download, FileDiff, ListTree, Maximize2, Minimize2, Play, ShieldCheck, Square, Terminal, Undo2, X } from 'lucide-react';
import type { ActivityEvent, Approval, FileChange, TaskDetail, TaskRecord, Workspace } from '../../shared/types';
import { api, downloadText, mutation } from '../api';
import { approvalContext } from '../approval';
import { mergeEvents } from '../realtime-state';
import Markdown from './Markdown';
import ExecutionOverview from './ExecutionOverview';
import { Empty, ErrorNotice, humanize, isActive, Loading, Status, time } from './ui';

type Tab = 'activity' | 'files' | 'verification';
const tabs: { id: Tab; label: string }[] = [{ id: 'activity', label: 'Activity' }, { id: 'files', label: 'Changes' }, { id: 'verification', label: 'Verification' }];

function ApprovalCard({ approval, context, hostName, onDecision, busy }: { approval: Approval; context: ReturnType<typeof approvalContext>; hostName: string | undefined; onDecision: (id: string, decision: 'allow_once' | 'allow_task' | 'denied') => void; busy: boolean }) {
  const payload = JSON.stringify(approval.arguments, null, 2);
  return <section className="approval" aria-label="Pending approval"><div className="approval-heading"><ShieldCheck size={20} /><div><h3>Your approval is needed</h3><p>{approval.tool}</p></div></div>
    <dl className="approval-identity"><dt>Host</dt><dd>{hostName || 'Host not reported'}</dd><dt>Workspace</dt><dd>{context.workspace}</dd><dt>Agent</dt><dd>{context.agent}</dd><dt>Model</dt><dd>{context.model}</dd></dl>
    <p className="approval-action"><strong>{context.action}</strong></p><p>{context.risk}</p><p className="approval-reason">{context.reason}</p>
    <details className="approval-arguments"><summary>Inspect exact arguments</summary><pre className="bounded-output">{payload.slice(0, 12_000)}</pre>{payload.length > 12_000 && <button className="text-button" onClick={() => downloadText(`relay-approval-${approval.id}.json`, payload)}>Download complete arguments</button>}</details>
    <div className="approval-actions"><button className="button primary" disabled={busy} onClick={() => onDecision(approval.id, 'allow_once')}>Allow once</button><button className="button" disabled={busy} onClick={() => onDecision(approval.id, 'allow_task')}>Allow for this task</button><button className="button subtle" disabled={busy} onClick={() => onDecision(approval.id, 'denied')}>Deny</button></div><p className="hint">Task approval stays within this task’s permission policy.</p></section>;
}

function EventRow({ event }: { event: ActivityEvent }) {
  const summary = [event.data.summary, event.data.message, event.data.tool, event.data.name, event.data.title, event.data.modelId].find(value => typeof value === 'string');
  const important = /FAILED|DENIED|ERROR/.test(event.type);
  const Icon = important ? CircleAlert : /TOOL|COMMAND/.test(event.type) ? Terminal : /COMPLETED|RESULT/.test(event.type) ? Check : ListTree;
  const payload = JSON.stringify(event.data, null, 2);
  return <details className={`event-row ${important ? 'event-error' : ''}`}><summary><span className="event-node"><Icon size={13} /></span><span className="event-text"><strong>{humanize(event.type)}</strong>{summary && <span>{String(summary).slice(0, 160)}</span>}</span><time dateTime={event.createdAt}>{time(event.createdAt)}</time><ChevronDown size={13} className="disclosure-chevron" /></summary><div className="event-detail"><pre className="bounded-output">{payload.slice(0, 10_000)}</pre>{payload.length > 10_000 && <button className="text-button" onClick={() => downloadText(`relay-event-${event.id}.json`, payload)}>Download complete event</button>}<span className="small muted">Event {event.id}</span></div></details>;
}

function Changes({ changes, onRevert, busy }: { changes: FileChange[]; onRevert: (id: string) => void; busy: boolean }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const selected = changes.find(change => `${change.checkpointId}:${change.path}` === selectedPath) ?? changes[0];
  if (!selected) return <Empty title="No recorded file changes" icon={<FileDiff size={27} />}><p>Changes made through Relay’s tools will appear here with their checkpoint.</p></Empty>;
  const copy = async () => {
    setCopyError(null);
    try { await navigator.clipboard.writeText(selected.patch); setCopied(true); }
    catch (caught) { setCopyError(caught); }
  };
  return <div className="changes"><label className="field-label">Changed file<select value={`${selected.checkpointId}:${selected.path}`} onChange={event => { setSelectedPath(event.target.value); setCopied(false); setConfirm(null); }}>{changes.map(change => <option key={`${change.checkpointId}:${change.path}`} value={`${change.checkpointId}:${change.path}`}>{change.path}</option>)}</select></label><div className="diff-heading"><code>{selected.path}</code><div className="button-row"><button className="icon-button" aria-label={copied ? 'Patch copied' : 'Copy patch'} onClick={() => { void copy(); }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button><button className="icon-button" aria-label="Download patch" onClick={() => downloadText(`${selected.path.split(/[\\/]/).pop() ?? 'change'}.patch`, selected.patch)}><Download size={15} /></button></div></div><pre className="diff-view" tabIndex={0} aria-label={`Unified diff for ${selected.path}`}><code>{selected.patch.split('\n').slice(0, 1200).map((line, index) => <span key={index} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-added' : line.startsWith('-') && !line.startsWith('---') ? 'diff-removed' : line.startsWith('@@') ? 'diff-hunk' : ''}>{line || ' '}{'\n'}</span>)}</code></pre>{selected.patch.split('\n').length > 1200 && <p className="hint">Showing the first 1,200 lines. Download the patch to inspect the entire change.</p>}<p className="hint">Checkpoint <code>{selected.checkpointId}</code>. Original source files are unchanged.</p>{confirm === selected.checkpointId ? <div className="notice warning"><p>Restore this checkpoint in the managed workspace? The service checks the current content before reverting and rejects conflicting external changes.</p><div className="button-row"><button className="button danger-button" disabled={busy} onClick={() => { onRevert(selected.checkpointId); setConfirm(null); }}>Restore checkpoint</button><button className="button subtle" onClick={() => setConfirm(null)}>Keep changes</button></div></div> : <button className="text-button" disabled={busy} onClick={() => setConfirm(selected.checkpointId)}><Undo2 size={14} />Revert checkpoint</button>}{copyError != null && <ErrorNotice error={copyError} />}</div>;
}

export default function Activity({ taskId, tasks, events, workspaces, hostName, onSelect, onClose, stopped, onAdmitted }: { taskId: string | null; tasks: TaskRecord[]; events: ActivityEvent[]; workspaces: Workspace[]; hostName: string | undefined; onSelect: (id: string) => void; onClose: () => void; stopped: boolean; onAdmitted?: (id: string) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['task', taskId], queryFn: ({ signal }) => api<TaskDetail>(`/tasks/${taskId}`, { signal }), enabled: Boolean(taskId) });
  const [tab, setTab] = useState<Tab>('activity');
  const [expanded, setExpanded] = useState(false);
  const [limit, setLimit] = useState(80);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const data = query.data;
  const task = data?.task;
  const combined = mergeEvents(data?.events ?? [], events.filter(event => event.taskId === taskId), 1000).filter(event => event.type !== 'MODEL_TEXT');
  useEffect(() => { setError(null); setLimit(80); }, [taskId]);
  useEffect(() => { if (window.matchMedia('(max-width: 700px)').matches) document.querySelector<HTMLButtonElement>('.activity-panel button[aria-label="Close activity"]')?.focus(); }, []);
  const run = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try { await mutation(path, body); if (taskId && path.endsWith('/resume')) onAdmitted?.(taskId); await Promise.all([client.invalidateQueries({ queryKey: ['task', taskId] }), client.invalidateQueries({ queryKey: ['conversation'] }), client.invalidateQueries({ queryKey: ['status'] })]); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  };
  return <aside className={`activity-panel ${expanded ? 'activity-expanded' : ''}`} aria-label="Task activity"><header className="inspector-heading"><div><span className="inspector-overline">Execution record</span><h2>Behind the work</h2></div><div className="button-row"><button className="icon-button inspector-expand" aria-label={expanded ? 'Narrow activity panel' : 'Expand activity panel'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button><button className="icon-button" aria-label="Close activity" onClick={onClose}><X size={18} /></button></div></header>
    {tasks.length > 1 && <label className="task-select">Task<select value={taskId ?? ''} onChange={event => onSelect(event.target.value)}>{tasks.map(item => <option key={item.id} value={item.id}>{item.objective.slice(0, 65)}</option>)}</select></label>}
    {task && <div className="task-summary"><Status status={task.status} /><span className="small muted">{task.callsUsed} model calls</span><div className="task-controls">{isActive(task.status) && <button className="text-button" disabled={busy} onClick={() => { void run(`/tasks/${task.id}/cancel`); }}><Square size={12} />Cancel task</button>}{['paused', 'waiting_for_user'].includes(task.status) && <button className="text-button" disabled={busy || stopped} title={stopped ? 'Resume the service before resuming a task' : undefined} onClick={() => { void run(`/tasks/${task.id}/resume`); }}><Play size={13} />Resume task</button>}</div></div>}
    <div className="inspector-tabs" role="tablist" aria-label="Execution detail">{tabs.map((item, index) => <button key={item.id} role="tab" id={`tab-${item.id}`} aria-selected={tab === item.id} aria-controls={`panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      const nextTab = tabs[next]!; setTab(nextTab.id); document.getElementById(`tab-${nextTab.id}`)?.focus();
    }}>{item.label}{item.id === 'files' && Boolean(data?.changes.length) && <span>{data?.changes.length}</span>}</button>)}</div>
    <div className="inspector-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0}>
      {error != null && <ErrorNotice error={error} />}{busy && <Loading>Applying your decision…</Loading>}
      {!taskId ? <Empty title="Your work will appear here" icon={<ListTree size={29} />}><p>Send an objective to inspect its models, tools, decisions and evidence.</p></Empty> : query.isPending ? <Loading>Opening execution record…</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : data && <>
        {data.approvals.filter(approval => approval.status === 'pending').map(approval => <ApprovalCard key={approval.id} approval={approval} context={approvalContext(approval, data.task.options.workspaceId, workspaces, [...data.events, ...events])} hostName={hostName} busy={busy || stopped} onDecision={(id, decision) => { void run(`/approvals/${id}`, { decision }); }} />)}
        {task?.error && <div className="notice warning"><strong>{task.status === 'failed' ? 'Task could not complete' : 'Task needs attention'}</strong><p>{task.error}</p></div>}
        {tab === 'activity' && <ExecutionOverview data={data} />}
        {tab === 'activity' && <>{data.steps.length > 0 && <section className="steps"><h3>Work plan</h3>{data.steps.map(step => <details key={step.id} className="step"><summary><Status status={step.status} /><span>{step.title}</span><ChevronDown size={13} /></summary><div><p className="small muted">{humanize(step.role)}{step.modelId ? ` / ${step.modelId}` : ' / model not yet assigned'}</p>{step.output ? <Markdown content={step.output.slice(0, 24_000)} /> : <p className="muted small">{step.status === 'pending' ? 'Planned. This agent has not executed.' : 'No final output recorded.'}</p>}{step.output && step.output.length > 24_000 && <button className="text-button" onClick={() => downloadText(`relay-${step.role}-${step.id}.md`, step.output!)}>Download full agent output</button>}</div></details>)}</section>}<div className="section-heading"><h3>Work log</h3><span className="small muted">Factual activity</span></div>{combined.length ? <>{combined.length > limit && <button className="text-button older-events" onClick={() => setLimit(value => Math.min(1000, value + 100))}>Show earlier events ({combined.length - limit})</button>}<div className="event-thread">{combined.slice(-limit).map(event => <EventRow key={event.id} event={event} />)}</div></> : <p className="muted">No execution events recorded yet.</p>}</>}
        {tab === 'files' && <Changes changes={data.changes} busy={busy} onRevert={id => { void run(`/tasks/${taskId}/revert`, { checkpointId: id }); }} />}
        {tab === 'verification' && <>{data.verification.length ? <div className="verification-list">{data.verification.map(item => <article key={item.id} className="verification"><div className="split"><h3>{humanize(item.kind)}</h3><Status status={item.passed ? 'passed' : 'failed'} /></div><p>{item.summary}</p><span className="small muted">Recorded {time(item.createdAt)}</span>{Object.keys(item.details).length > 0 && <details><summary>Inspect evidence</summary><pre className="bounded-output">{JSON.stringify(item.details, null, 2).slice(0, 12_000)}</pre></details>}</article>)}</div> : <Empty title="No verification evidence yet" icon={<ShieldCheck size={29} />}><p>Model confidence and agreement are not verification. Tool checks and their results appear here.</p></Empty>}<p className="hint">Evidence is scoped to the checks that actually ran. Task completion does not imply every possible behavior was tested.</p></>}
      </>}
    </div>
  </aside>;
}
