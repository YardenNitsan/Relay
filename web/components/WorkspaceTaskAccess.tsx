import {useQuery} from '@tanstack/react-query';
import type {TaskOptions} from '../../shared/types';
import {api} from '../api';

export default function WorkspaceTaskAccess({options,onChange,userId}:{options:TaskOptions;onChange:(options:TaskOptions)=>void;userId:string}){
 const connection=useQuery({queryKey:['google-workspace',userId],queryFn:({signal})=>api<{configured:boolean;connected:boolean}>('/integrations/google-workspace',{signal}),retry:false,staleTime:0});
 const compatible=options.cloudPolicy==='local_only'&&options.budget.localOnly&&options.access==='read_only'&&(!options.modelId||/^(ollama|lmstudio)[/:]/.test(options.modelId))&&(!options.network||options.network.mode==='deny')&&!options.mcpServerIds?.length;
 const selected=options.googleWorkspace??{mail:false,calendar:false};
 return <fieldset className="mcp-task-selection"><legend>Google Workspace reads for this task</legend>
  <p className="hint">Opt in to let local agents read your connected account. Results enter this conversation and its local task records. This conversation and later tasks stay local-only, read-only, with website and MCP tools disabled. Start a separate conversation for cloud use.</p>
  <p className="hint">{connection.isPending?'Checking connection…':connection.isError?'Connection status unavailable. Open Google Workspace to review setup.':connection.data.connected?'Your read-only Google Workspace account is connected.':'Connect your account in the Google Workspace panel first. Gemini consent does not grant mail or calendar access.'}</p>
  {(['mail','calendar'] as const).map(scope=><label className="check-label" key={scope}><input type="checkbox" checked={selected[scope]} disabled={!selected[scope]&&(!compatible||connection.data?.connected!==true)} onChange={event=>onChange({...options,googleWorkspace:{...selected,[scope]:event.target.checked}})}/><span>{scope==='mail'?'Allow Gmail search and message reads':'Allow primary-calendar events and availability reads'}</span></label>)}
  {!compatible&&<p className="hint">Choose a local model or Auto, Local only sharing, Read only access, disabled website access and no MCP servers before opting in. Settings are not changed automatically.</p>}
  <p className="hint">General agents can use either selection; Email and Calendar profiles use only their matching reads. Other profiles keep their existing tool limits. Sending, attachments, event changes and invitations are unavailable.</p>
 </fieldset>;
}
