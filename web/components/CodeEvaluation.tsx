import {useEffect,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../api';
import {ErrorNotice,humanize,Loading} from './ui';

interface Report {id:string;taskId:string;status:string;identity:{model:{modelId:string};sandbox:{imageId:string;toolchainVersion:string;harnessDigest:string}};result:null|{passed:number;total:number;executed:number;measuredAt:string};}
export default function CodeEvaluation({modelId,contextTokens}:{modelId:string;contextTokens:number}){
  const [open,setOpen]=useState(false),[consent,setConsent]=useState(false),[started,setStarted]=useState<string|null>(null),client=useQueryClient();
  const availability=useQuery({queryKey:['code-evaluation-sandbox'],enabled:open,queryFn:({signal})=>api<{available:boolean;reason:string}>('/models/code-evaluations/status',{signal}),retry:false,staleTime:30000});
  const history=useQuery({queryKey:['code-evaluations'],enabled:open,queryFn:({signal})=>api<Report[]>('/models/code-evaluations',{signal}),refetchInterval:query=>open&&query.state.data?.some(item=>item.status==='running')?2000:false});
  const task=useQuery({queryKey:['code-evaluation-task',started],enabled:open&&!!started,queryFn:({signal})=>api<{task:{status:string}}>(`/tasks/${started}`,{signal}),refetchInterval:query=>['created','analyzing','planning','executing','verifying'].includes(query.state.data?.task.status??'created')?2000:false});
  const running=!!started&&(!task.data||['created','analyzing','planning','executing','verifying'].includes(task.data.task.status));
  useEffect(()=>{if(started&&task.data&&!running){void client.invalidateQueries({queryKey:['code-evaluations']});setStarted(null);}},[started,task.data,running,client]);
  const start=useMutation({mutationFn:()=>api<{taskId:string}>('/models/code-evaluations',{method:'POST',body:{modelId,contextTokens:Math.min(32768,Math.max(8192,contextTokens)),maxOutputTokens:2048,maxSeconds:600,confirmed:true}}),onSuccess:result=>{setStarted(result.taskId);setConsent(false);void client.invalidateQueries({queryKey:['code-evaluations']});}});
  const stop=useMutation({mutationFn:()=>api(`/tasks/${started}/cancel`,{method:'POST'}),onSuccess:()=>{void client.invalidateQueries({queryKey:['code-evaluation-task',started]});void client.invalidateQueries({queryKey:['code-evaluations']});}});
  const latest=history.data?.find(item=>item.identity.model.modelId===modelId);
  return <details className="calibration" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Evaluate executable coding</summary>
    <p className="hint">Three synthetic JavaScript cases produce code that runs in the approved offline Node container. Actual outputs are compared with expected results outside the container. This is separate from the nine text and tool-proposal cases.</p>
    <p className="hint">Up to 3 local model calls, 2,048 output tokens per call and 10 minutes active time. Each container uses at most 512 MiB and one CPU, with a 15-second command deadline. No packages, network, host files or image downloads.</p>
    {availability.isPending&&open?<Loading>Checking the approved coding environment…</Loading>:availability.data&&!availability.data.available?<p className="notice">{availability.data.reason}</p>:availability.data&&<p className="hint">A configured environment is available. Runtime and isolation checks must pass before any model call.</p>}
    <label className="check-label"><input type="checkbox" checked={consent} disabled={running||start.isPending||!availability.data?.available} onChange={event=>setConsent(event.target.checked)}/>Approve local compute and isolated execution of generated code</label>
    <div className="button-row"><button className="button small-button" disabled={!consent||!availability.data?.available||running||start.isPending} onClick={()=>start.mutate()}>{start.isPending?'Checking sandbox and queuing…':running?'Coding evaluation running':'Run executable evaluation'}</button>{running&&<button className="button danger-button" disabled={stop.isPending} onClick={()=>stop.mutate()}>Stop coding evaluation</button>}</div>
    {latest?.result&&<p className="hint">{latest.result.passed}/{latest.result.total} coding cases passed; {latest.result.executed} programs executed on {new Date(latest.result.measuredAt).toLocaleString()}. These public synthetic cases do not prove production coding quality and do not change Auto ranking.</p>}
    {latest&&!latest.result&&<p className="hint">Latest coding attempt: {humanize(latest.status)}. No completed executable score is available.</p>}
    {latest&&<details><summary>Recorded coding environment</summary><dl className="calibration-results"><div><dt>Container image</dt><dd>{latest.identity.sandbox.imageId}</dd></div><div><dt>Node version</dt><dd>{latest.identity.sandbox.toolchainVersion}</dd></div><div><dt>Trusted harness digest</dt><dd>{latest.identity.sandbox.harnessDigest}</dd></div></dl></details>}
    {(availability.isError||history.isError||task.isError||start.isError||stop.isError)&&<ErrorNotice error={availability.error??history.error??task.error??start.error??stop.error}/>}
  </details>;
}
