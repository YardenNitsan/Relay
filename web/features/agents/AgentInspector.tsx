import type {RefObject} from 'react';
import {ArrowLeft,Check,ChevronRight} from 'lucide-react';
import {getAssistantDefinition,type AssistantAvailability} from '../../../shared/assistants';
import {ErrorNotice} from '../../components/ui';
import {agentIcons,capabilityLabel,toolLabels} from './presentation';
interface Props {agent:AssistantAvailability;selected:boolean;busy:boolean;preparing:boolean;error:unknown;workspaceSelected:boolean;onSelect:()=>void;onWorkspace?:()=>void;onBack:()=>void;headingRef:RefObject<HTMLHeadingElement|null>}
export function AgentInspector({agent,selected,busy,preparing,error,workspaceSelected,onSelect,onWorkspace,onBack,headingRef}:Props){
  const Icon=agentIcons[agent.id];
  const fileCapable=getAssistantDefinition(agent.id)?.allowedTools.some(tool=>tool.startsWith('file_'));
  return <>
    <div className="agent-detail-navigation"><button className="text-button" onClick={onBack} disabled={busy}><ArrowLeft size={17}/>All specialists</button></div>
    <article className="agent-inspector-scroll" aria-label={`${agent.name} agent`}>
      <header className="agent-inspector-heading"><Icon size={26} aria-hidden="true"/><div><h3 tabIndex={-1} ref={headingRef}>{agent.name}</h3>{selected&&<span className="agent-current"><Check size={14}/>Selected for your next objective</span>}</div></header>
      <p className="agent-role-description">{agent.description}</p>
      <p className="agent-runtime-state">{capabilityLabel(agent)}</p>
      <section className="agent-inspector-section" aria-label="Scope and limits"><h4>Scope and limits</h4>
        {agent.limitations.length>0&&<ul>{agent.limitations.map(limit=><li key={limit}>{limit}</li>)}</ul>}
        {agent.requiredIntegration&&<p className="agent-integration-note">{agent.integrationState==='not_implemented'?'Live actions are not implemented in this release: ':agent.integrationState==='connected'?'Connected integration: ':'Integration not configured: '}{agent.requiredIntegration}</p>}
        <p className="hint">Selecting a specialist does not connect an account or expand computer access. Integrations, actions and verification appear in Activity when they actually run.</p>
      </section>
      <details className="agent-tools"><summary>{agent.tools.length?`Tools this role can request (${agent.tools.length})`:'Tools and setup'}</summary>
        {agent.tools.length?<><ul>{agent.tools.map(tool=><li key={tool}>{toolLabels[tool]??tool}</li>)}</ul><p className="hint">Each task checks permissions and runtime availability before enabling these tools. File tools use the selected workspace; read-only mode blocks agent edits. Website access, MCP servers and isolated commands require their own grants and available connections.</p></>:<p className="hint">This role can answer and plan now. {agent.id==='browser'?'Live public-page reading requires an allowed website origin from the host owner and a task network policy. Interactive browsing is not implemented in this release; selecting this role does not enable clicks or form submissions.':'Any additional tools are enabled only when their connections and permissions are available.'}</p>}
      </details>
      {!workspaceSelected&&fileCapable&&<section className="agent-inspector-section" aria-label="Private files"><h4>Your file scope</h4><p>Using this specialist prepares a private, empty workspace for your account. Your chosen agent permissions remain in effect.</p>{onWorkspace&&<button className="text-button" disabled={busy} onClick={onWorkspace}>Choose existing files</button>}</section>}
      <div className="agent-selection-action">
        {error!=null&&<ErrorNotice error={error}/>}
        <button className="button" disabled={!agent.available||busy} onClick={onSelect} aria-label={`Use ${agent.name} agent`}>{preparing?'Preparing…':selected?'Keep selected':'Use agent'}<ChevronRight size={16}/></button>
      </div>
    </article>
  </>;
}
