import { Check, Circle, CircleAlert, LoaderCircle } from 'lucide-react';
import type { TaskDetail } from '../../shared/types';
import { humanize } from './ui';
import TaskTiming from './TaskTiming';
import TaskDeadline from './TaskDeadline';

/** Recorded state only. Agent completion is never presented as a passed check. */
export default function ExecutionOverview({ data }: { data: TaskDetail }) {
  const completed = data.steps.filter(step => step.status === 'completed').length;
  const checks = data.verification.filter(check => check.kind !== 'response' && check.details.objectiveVerification !== false);
  const passed = checks.filter(check => check.passed).length;
  const failed = checks.length - passed;
  const pending = data.approvals.filter(approval => approval.status === 'pending').length;
  return <section className="execution-overview" aria-label="Execution overview">
    <div className="section-heading"><h3>At a glance</h3><span className="small muted">{completed} / {data.steps.length} steps complete</span></div>
    {pending > 0 && <p className="execution-next">Review {pending === 1 ? 'the action' : `${pending} actions`} awaiting your approval.</p>}
    {data.steps.length > 0 && <ol className="agent-track" aria-label="Agent steps">
      {data.steps.map(step => {
        const routing = [...data.events].reverse().find(event => ['MODEL_SELECTED','MODEL_REROUTED'].includes(event.type) && event.data.stepId === step.id);
        const call = [...data.events].reverse().find(event => event.type === 'CALL_BUDGET' && event.data.stepId === step.id);
        const reasons = Array.isArray(routing?.data.reasons) ? routing.data.reasons.filter((reason): reason is string => typeof reason === 'string') : [];
        const adjustment = [...data.events].reverse().find(event => event.type === 'REASONING_ADJUSTED' && event.data.stepId === step.id);
        if (typeof adjustment?.data.reason === 'string') reasons.push(adjustment.data.reason);
        const Icon = step.status === 'completed' ? Check : step.status === 'failed' ? CircleAlert : step.status === 'running' ? LoaderCircle : Circle;
        return <li key={step.id} data-state={step.status}><span className="agent-track-node"><Icon size={14} aria-hidden="true" /></span><div><div className="agent-track-title"><strong>{humanize(step.role)}</strong><span>{humanize(step.status)}</span></div><p>{step.title}</p><small>{step.modelId ?? 'Model not yet assigned'}{call && ` / Reasoning: ${typeof call.data.reasoning === 'string' ? humanize(call.data.reasoning) : 'Provider default'}`}</small>{reasons.length > 0 && <details className="routing-explanation"><summary>Why this model</summary><ul>{reasons.map((reason,index) => <li key={index}>{reason}</li>)}</ul></details>}</div></li>;
      })}
    </ol>}
    <div className="evidence-summary"><span>Recorded checks</span><strong>{checks.length ? `${passed} passed · ${failed} failed` : 'No independent checks recorded'}</strong><p>Completion describes the workflow. Evidence describes what was actually checked.</p></div>
    <TaskTiming taskId={data.task.id} running={!['completed','failed','cancelled','paused','waiting_for_user'].includes(data.task.status)}/>
    <TaskDeadline task={data.task}/>
  </section>;
}
