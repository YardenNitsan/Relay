import type { TaskDetail } from '../../shared/types';
import Workflow from '../features/workbench/Workflow';
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
    <Workflow steps={data.steps} events={data.events}/>
    <div className="evidence-summary"><span>Recorded checks</span><strong>{checks.length ? `${passed} passed · ${failed} failed` : 'No independent checks recorded'}</strong><p>Completion describes the workflow. Evidence describes what was actually checked.</p></div>
    <TaskTiming taskId={data.task.id} running={!['completed','failed','cancelled','paused','waiting_for_user'].includes(data.task.status)}/>
    <TaskDeadline task={data.task}/>
  </section>;
}
