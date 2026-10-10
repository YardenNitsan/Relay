import {useState} from 'react';
import {Maximize2,ShieldCheck} from 'lucide-react';
import type {Approval,TaskRecord} from '../../../shared/types';
import {approvalContext} from '../../approval';
import {downloadText} from '../../api';
import TaskDeadline from '../../components/TaskDeadline';
import {ErrorNotice,Loading,Modal} from '../../components/ui';
import './approval.css';

interface Props {
  approval:Approval;task:TaskRecord;context:ReturnType<typeof approvalContext>;hostName:string|undefined;
  onDecision:(id:string,decision:'allow_once'|'allow_task'|'denied')=>void;
  busy:boolean;working?:boolean;error?:unknown;
}

function ApprovalDetails({approval,task,context,hostName}:Props) {
  const payload=JSON.stringify(approval.arguments,null,2);
  const proposed=approval.tool==='file_write'&&typeof approval.arguments.content==='string'?approval.arguments.content:null;
  return <>
    <p className="approval-consequence">{context.risk}</p>
    <dl className="approval-identity"><dt>Host</dt><dd>{hostName||'Host not reported'}</dd><dt>Workspace</dt><dd dir="auto">{context.workspace}</dd><dt>Agent</dt><dd>{context.agent}</dd><dt>Model</dt><dd>{context.model}</dd></dl>
    <p className="approval-reason">{context.reason}</p>
    <TaskDeadline task={task}/>
    {proposed!==null&&<details className="approval-proposal"><summary>Proposed file contents</summary><p>Requested contents, before execution.</p><pre className="bounded-output" tabIndex={0} aria-label="Proposed file contents" dir="ltr">{proposed.slice(0,12_000)}</pre>{proposed.length>12_000&&<p className="approval-scope">Showing the first 12,000 characters.</p>}{proposed.length>12_000&&<button className="text-button" onClick={()=>downloadText(`relay-proposed-${approval.id}.txt`,proposed)}>Download complete proposed contents</button>}</details>}
    <details className="approval-arguments"><summary>Inspect exact arguments</summary><p>Tool: <code>{approval.tool}</code></p><pre className="bounded-output" tabIndex={0} aria-label="Exact approval arguments" dir="ltr">{payload.slice(0,12_000)}</pre>{payload.length>12_000&&<p className="approval-scope">Showing the first 12,000 characters.</p>}{payload.length>12_000&&<button className="text-button" onClick={()=>downloadText(`relay-approval-${approval.id}.json`,payload)}>Download complete arguments</button>}</details>
  </>;
}

function DecisionActions({approval,onDecision,busy}:Props) {
  const cloud=approval.tool==='cloud_egress';
  return <><div className="approval-actions">
    <button className="button primary" disabled={busy} onClick={()=>onDecision(approval.id,'allow_once')}>Allow once</button>
    {!cloud&&<button className="button" disabled={busy} onClick={()=>onDecision(approval.id,'allow_task')}>Allow for this task</button>}
    <button className="button subtle" disabled={busy} onClick={()=>onDecision(approval.id,'denied')}>Deny</button>
  </div><p className="approval-scope">{cloud?'Consent covers this exact context request.':'Task approval covers this exact action and arguments. Existing permissions still apply.'}</p></>;
}

export default function ApprovalCard(props:Props) {
  const [reviewOpen,setReviewOpen]=useState(false);
  return <>
    <section className="approval" aria-label="Pending approval">
      <div className="approval-heading"><div><span className="approval-eyebrow"><ShieldCheck size={16} aria-hidden="true"/>Approval requested</span><h3 dir="auto">{props.context.action}</h3></div><button className="button approval-review-trigger" onClick={()=>setReviewOpen(true)}><Maximize2 size={15} aria-hidden="true"/>Review action</button></div>
      <ApprovalDetails {...props}/><DecisionActions {...props}/>
    </section>
    {reviewOpen&&<Modal title="Review requested action" onClose={()=>setReviewOpen(false)} className="approval-review" fallbackFocusId="workbench">
      <div className="approval-review-body"><h3 dir="auto">{props.context.action}</h3><ApprovalDetails {...props}/></div>
      <footer className="approval-review-actions">{props.error!=null&&<ErrorNotice error={props.error}/>}{props.working&&<Loading>Applying your decision…</Loading>}<DecisionActions {...props}/></footer>
    </Modal>}
  </>;
}
