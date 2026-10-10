import {Check,ChevronDown,Circle,CircleAlert,LoaderCircle} from 'lucide-react';
import type {ActivityEvent,TaskStep} from '../../../shared/types';
import Markdown from '../../components/Markdown';
import {downloadText} from '../../api';
import {humanize} from '../../components/ui';
import {workflowLayout} from './workflow-layout';
import './workflow.css';

function AgentStep({step,steps,events}:{step:TaskStep;steps:TaskStep[];events:ActivityEvent[]}) {
  const recorded=events.filter(event=>event.data.stepId===step.id);
  const routing=recorded.findLast(event=>['MODEL_SELECTED','MODEL_REROUTED'].includes(event.type));
  const adjustment=recorded.findLast(event=>event.type==='REASONING_ADJUSTED');
  const call=recorded.findLast(event=>event.type==='CALL_BUDGET');
  const handoff=recorded.findLast(event=>event.type==='HANDOFF_PREPARED');
  const reasons=Array.isArray(routing?.data.reasons)?routing.data.reasons.filter((reason):reason is string=>typeof reason==='string'):[];
  if(typeof adjustment?.data.reason==='string')reasons.push(adjustment.data.reason);
  const Icon=step.status==='completed'?Check:step.status==='failed'?CircleAlert:step.status==='running'?LoaderCircle:Circle;
  return <li className="workflow-agent" data-state={step.status}>
    <details>
      <summary><span className="workflow-node"><Icon size={16} aria-hidden="true"/></span><span className="workflow-agent-label"><strong>{humanize(step.role)}</strong><span>{step.title}</span></span><span className="workflow-state">{humanize(step.status)}</span><ChevronDown size={15} aria-hidden="true"/></summary>
      <div className="workflow-agent-content">
        <dl className="workflow-facts"><div><dt>Model</dt><dd>{step.modelId??'Not yet assigned'}</dd></div><div><dt>Depends on</dt><dd>{step.dependencies.length?step.dependencies.map(id=>steps.find(item=>item.id===id)?.title??`Unavailable step (${id})`).join('; '):'No preceding step'}</dd></div>{call&&<div><dt>Reasoning</dt><dd>{typeof call.data.reasoning==='string'?humanize(call.data.reasoning):'Provider default'}</dd></div>}</dl>
        {reasons.length>0&&<details className="routing-explanation"><summary>Why this model</summary><ul>{reasons.map((reason,index)=><li key={index}>{reason}</li>)}</ul></details>}
        {handoff&&<details className="workflow-handoff"><summary>Recorded handoff metadata</summary><p>Preparation was recorded for this step. This receipt does not establish that every dependency was verified.</p><pre className="bounded-output">{JSON.stringify(handoff.data,null,2).slice(0,12_000)}</pre></details>}
        <h4>Agent output</h4>{step.output?<><Markdown content={step.output.slice(0,24_000)}/>{step.output.length>24_000&&<button className="text-button" onClick={()=>downloadText(`relay-${step.role}-${step.id}.md`,step.output!)}>Download full agent output</button>}</>:<p>{step.status==='pending'?'Planned. This agent has not executed.':'No final output recorded.'}</p>}
        <p className="workflow-output-note">Agent output is a model response. Recorded tool checks are listed separately under Verification.</p>
      </div>
    </details>
    <span className="workflow-model">{step.modelId??'Model not yet assigned'}</span>
  </li>;
}

export default function Workflow({steps,events}:{steps:TaskStep[];events:ActivityEvent[]}) {
  const {levels,unresolved}=workflowLayout(steps);
  if(!steps.length)return <p className="muted">No agent plan has been recorded.</p>;
  return <div className="workflow" aria-label="Recorded dependency graph">
    <p className="workflow-intro">Dependencies define the order. Agents in the same level can still execute one at a time.</p>
    <ol className="workflow-levels" aria-label="Agent steps">
      {levels.map((level,index)=><li className="workflow-level" key={index}><h4>Level {index+1}<span>{level.length===1?'1 agent':`${level.length} agents`}</span></h4><ol aria-label={`Dependency level ${index+1}`}>{level.map(step=><AgentStep key={step.id} step={step} steps={steps} events={events}/>)}</ol></li>)}
      {unresolved.length>0&&<li className="workflow-level workflow-unresolved"><h4>Unresolved dependencies</h4><p>The recorded plan has missing, cyclic or ambiguous references. These steps are shown without inferring an execution order.</p><ol aria-label="Unresolved agent steps">{unresolved.map((step,index)=><AgentStep key={`${step.id}:${index}`} step={step} steps={steps} events={events}/>)}</ol></li>}
    </ol>
  </div>;
}
