import {ShieldCheck} from 'lucide-react';
import type {Approval,TaskRecord} from '../../../shared/types';
import {approvalContext} from '../../approval';
import {downloadText} from '../../api';
import TaskDeadline from '../../components/TaskDeadline';

export default function ApprovalCard({ approval, task, context, hostName, onDecision, busy }: { approval: Approval; task:TaskRecord; context: ReturnType<typeof approvalContext>; hostName: string | undefined; onDecision: (id: string, decision: 'allow_once' | 'allow_task' | 'denied') => void; busy: boolean }) {
  const payload = JSON.stringify(approval.arguments, null, 2);
  return <section className="approval" aria-label="Pending approval"><div className="approval-heading"><ShieldCheck size={20} /><div><h3>Your approval is needed</h3><p>{approval.tool}</p></div></div>
    <dl className="approval-identity"><dt>Host</dt><dd>{hostName || 'Host not reported'}</dd><dt>Workspace</dt><dd>{context.workspace}</dd><dt>Agent</dt><dd>{context.agent}</dd><dt>Model</dt><dd>{context.model}</dd></dl>
    <p className="approval-action"><strong>{context.action}</strong></p><p>{context.risk}</p><p className="approval-reason">{context.reason}</p>
    <TaskDeadline task={task}/>
    <details className="approval-arguments"><summary>Inspect exact arguments</summary><pre className="bounded-output">{payload.slice(0, 12_000)}</pre>{payload.length > 12_000 && <button className="text-button" onClick={() => downloadText(`relay-approval-${approval.id}.json`, payload)}>Download complete arguments</button>}</details>
    <div className="approval-actions"><button className="button primary" disabled={busy} onClick={() => onDecision(approval.id, 'allow_once')}>Allow once</button><button className="button" disabled={busy} onClick={() => onDecision(approval.id, 'allow_task')}>Allow for this task</button><button className="button subtle" disabled={busy} onClick={() => onDecision(approval.id, 'denied')}>Deny</button></div><p className="hint">Task approval stays within this task’s permission policy.</p></section>;
}
