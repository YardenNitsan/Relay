import {useState} from 'react';
import {useMutation,useQuery} from '@tanstack/react-query';
import {api} from '../api';
import {useEvaluationTask} from '../features/models/useEvaluationTask';
import {useModelOperation} from '../features/models/model-operation';
import {ErrorNotice,humanize,Loading} from './ui';

interface Report {id:string;taskId:string;status:string;identity:{model:{modelId:string};sandbox:{imageId:string;toolchainVersion:string;harnessDigest:string}};result:null|{passed:number;total:number;executed:number;measuredAt:string};}
export default function CodeEvaluation({modelId,contextTokens}:{modelId:string;contextTokens:number}){
  const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[started,setStarted]=useState<string|null>(null);
  const availability=useQuery({queryKey:['code-evaluation-sandbox'],enabled:open,queryFn:({signal})=>api<{available:boolean;reason:string}>('/models/code-evaluations/status',{signal}),retry:false,staleTime:30000});
  const history=useQuery({queryKey:['code-evaluations'],enabled:open,queryFn:({signal})=>api<Report[]>('/models/code-evaluations',{signal}),refetchInterval:query=>open&&query.state.data?.some(item=>item.status==='running')?2000:false});
  const {taskId:activeTaskId,task,running,refresh,error:recoveryError,unresolved}=useEvaluationTask({modelId,protocol:'relay-code-eval-v1',open,started,setStarted,reportedTaskId:history.data?.find(item=>item.identity.model.modelId===modelId&&item.status==='running')?.taskId,historyKey:'code-evaluations'});
  const start=useMutation({mutationFn:()=>api<{taskId:string}>('/models/code-evaluations',{method:'POST',body:{modelId,contextTokens:Math.min(32768,Math.max(8192,contextTokens)),maxOutputTokens:2048,maxSeconds:600,confirmed:true}}),onSuccess:result=>{setStarted(result.taskId);setConsent(false);},onSettled:refresh});
  const stop=useMutation({mutationFn:()=>api(`/tasks/${activeTaskId}/cancel`,{method:'POST'}),onSuccess:()=>{refresh();}});
  const latest=history.data?.find(item=>item.identity.model.modelId===modelId);
  useModelOperation(start.isPending||stop.isPending,'evaluation admission or cancellation');
  return <details className="calibration" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Evaluate executable coding</summary>
    <p className="hint">Three synthetic JavaScript cases produce code that runs in the approved offline Node container. Actual outputs are compared with expected results outside the container. This is separate from the nine text and tool-proposal cases.</p>
    <p className="hint">Up to 3 local model calls, 2,048 output tokens per call and 10 minutes active time. Each container uses at most 512 MiB and one CPU, with a 15-second command deadline. No packages, network, host files or image downloads.</p>
    {availability.isPending&&open?<Loading>Checking the approved coding environment…</Loading>:availability.data&&!availability.data.available?<p className="notice">{availability.data.reason}</p>:availability.data&&<p className="hint">A configured environment is available. Runtime and isolation checks must pass before any model call.</p>}
    <label className="check-label"><input type="checkbox" checked={consent} disabled={running||start.isPending||!availability.data?.available} onChange={event=>setConsent(event.target.checked)}/>Approve local compute and isolated execution of generated code</label>
    <div className="button-row"><button className="button small-button" disabled={!consent||!availability.data?.available||running||start.isPending||history.isPending||history.isFetching||history.isError||unresolved} onClick={()=>start.mutate()}>{start.isPending?'Checking sandbox and queuing…':running?'Coding evaluation active':'Run executable evaluation'}</button>{running&&<button className="button danger-button" disabled={stop.isPending} onClick={()=>stop.mutate()}>Stop coding evaluation</button>}</div>
    {latest?.result&&<p className="hint">{latest.result.passed}/{latest.result.total} coding cases passed; {latest.result.executed} programs executed on {new Date(latest.result.measuredAt).toLocaleString()}. These public synthetic cases do not prove production coding quality and do not change Auto ranking.</p>}
    {latest&&!latest.result&&<p className="hint">Latest coding attempt: {humanize(latest.status)}. No completed executable score is available.</p>}
    {latest&&<details><summary>Recorded coding environment</summary><dl className="calibration-results"><div><dt>Container image</dt><dd>{latest.identity.sandbox.imageId}</dd></div><div><dt>Node version</dt><dd>{latest.identity.sandbox.toolchainVersion}</dd></div><div><dt>Trusted harness digest</dt><dd>{latest.identity.sandbox.harnessDigest}</dd></div></dl></details>}
    {(availability.isError||history.isError||task.isError||recoveryError!=null||start.isError||stop.isError)&&<ErrorNotice error={availability.error??history.error??recoveryError??start.error??stop.error}/>}
  </details>;
}
