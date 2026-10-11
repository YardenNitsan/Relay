import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {api} from '../api';
import {useEvaluationTask} from '../features/models/useEvaluationTask';
import {useModelOperation} from '../features/models/model-operation';
import {ErrorNotice,humanize,Status} from './ui';
import CodeEvaluation from './CodeEvaluation';

interface Evaluation {id:string;taskId:string;status:string;identity:{modelId:string;digest?:string;runtime?:string;runtimeVersion?:string;quantization?:string;contextTokens?:number;gpuOffload?:number|string;executionSettings?:{maxOutputTokens?:number;reasoning?:string}};result:null|{passed:number;total:number;measuredAt:string;categories:Record<string,{passed:number;total:number}>};}
const recorded=(value:unknown)=>typeof value==='string'?value.slice(0,512):typeof value==='number'&&Number.isFinite(value)?String(value):'Not recorded';
export default function ModelEvaluation({modelId,contextTokens}:{modelId:string;contextTokens:number}){
  const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[started,setStarted]=useState<string|null>(null);
  const history=useQuery({queryKey:['model-evaluations'],enabled:open,queryFn:({signal})=>api<Evaluation[]>('/models/evaluations',{signal}),refetchInterval:query=>open&&query.state.data?.some(item=>item.status==='running')?2000:false});
  const latest=history.data?.find(item=>item.identity.modelId===modelId);
  const {taskId:activeTaskId,task,running,refresh,error:recoveryError,unresolved}=useEvaluationTask({modelId,protocol:'relay-capability-eval-v2',open,started,setStarted,reportedTaskId:history.data?.find(item=>item.identity.modelId===modelId&&item.status==='running')?.taskId,historyKey:'model-evaluations'});
  const start=useMutation({mutationFn:()=>api<{taskId:string}>('/models/evaluations',{method:'POST',body:{modelId,contextTokens:Math.min(32768,Math.max(8192,contextTokens)),maxOutputTokens:2048,maxSeconds:600}}),onSuccess:value=>{setStarted(value.taskId);setConsent(false);},onSettled:refresh});
  const stop=useMutation({mutationFn:()=>api(`/tasks/${activeTaskId}/cancel`,{method:'POST'}),onSuccess:()=>{refresh();}});
  useModelOperation(start.isPending||stop.isPending,'evaluation admission or cancellation');
  return <><details className="calibration" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Evaluate model capabilities</summary>
    <p className="hint">Nine synthetic cases test reasoning, debugging, structured answers, tool proposals, extraction, instruction following, context, multilingual input and recovery. Proposed tools and code are never executed.</p>
    <p className="hint">Runs locally, one case at a time, through the normal memory checks. Uses up to 9 calls, 2,048 output tokens per call and 10 minutes of active time. These small tests do not prove general task quality.</p>
    <label className="check-label"><input type="checkbox" checked={consent} disabled={running||start.isPending} onChange={event=>setConsent(event.target.checked)}/>Use local compute for this evaluation</label>
    <div className="button-row"><button className="button small-button" disabled={!consent||running||start.isPending||history.isPending||history.isFetching||history.isError||unresolved} onClick={()=>start.mutate()}>{start.isPending?'Queuing evaluation…':running?'Evaluation active':'Run capability evaluation'}</button>{running&&<button className="button danger-button" disabled={stop.isPending} onClick={()=>stop.mutate()}>Stop evaluation</button>}{task.data&&<Status status={task.data.task.status}/>}</div>
    {latest?.result&&<><p className="hint">{latest.result.passed}/{latest.result.total} cases passed on {new Date(latest.result.measuredAt).toLocaleString()}. Results apply to the recorded configuration only.</p><dl className="calibration-results">{Object.entries(latest.result.categories).map(([name,score])=><div key={name}><dt>{humanize(name)}</dt><dd>{score.passed}/{score.total}</dd></div>)}</dl></>}
    {latest&&<details><summary>Recorded evaluation configuration</summary><dl className="calibration-results">{[
      ['Model',latest.identity.modelId],['Artifact digest',latest.identity.digest],['Runtime',latest.identity.runtime],['Runtime version',latest.identity.runtimeVersion],['Quantization',latest.identity.quantization],['Context tokens',latest.identity.contextTokens],['Output tokens per case',latest.identity.executionSettings?.maxOutputTokens],['GPU offload',latest.identity.gpuOffload],['Reasoning',latest.identity.executionSettings?.reasoning],
    ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{recorded(value)}</dd></div>)}</dl>{latest.identity.gpuOffload==='runtime-auto'&&<p className="hint">Actual GPU placement was not verified. This automatic-placement report is inspectable but cannot influence Auto model ranking.</p>}<p className="hint">Scores cannot transfer to a different artifact, runtime, hardware, context, output limit or reasoning setting. Matching configuration is required; a small synthetic suite is not proof of production quality.</p></details>}
    {latest&&!latest.result&&<p className="hint">Latest recorded attempt: {humanize(latest.status)}. No completed score is available.</p>}
    {(start.isError||stop.isError||history.isError||task.isError||recoveryError!=null)&&<ErrorNotice error={start.error??stop.error??history.error??recoveryError}/>}
  </details><CodeEvaluation modelId={modelId} contextTokens={contextTokens}/></>;
}
