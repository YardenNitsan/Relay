import { useEffect, useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { api,mutation } from '../api';
import { ErrorNotice,humanize,Status } from './ui';
import {useModelOperation} from '../features/models/model-operation';

interface Sample {taskId:string;modelId:string;status:string;contextTokens:number;createdAt:string;error:string|null;protocol?:string;taskFit?:Record<string,{passed:number;total:number}>|null;invalidProbeFormat?:boolean;measurement:Record<string,number>|null;}
const finished=new Set(['completed','cancelled','failed']);
export default function Calibration({modelId,contextTokens}:{modelId:string;contextTokens:number}) {
  const client=useQueryClient();const [error,setError]=useState<unknown>(null);const [busy,setBusy]=useState(false);
  const [expanded,setExpanded]=useState(false);
  useModelOperation(busy,'model calibration');
  const samples=useQuery({queryKey:['calibrations'],enabled:expanded,queryFn:({signal})=>api<Sample[]>('/models/calibrations',{signal}),refetchInterval:query=>expanded&&query.state.data?.some(sample=>!finished.has(sample.status))?2000:false});
  const latest=samples.data?.find(sample=>sample.modelId===modelId);const running=latest&&!finished.has(latest.status);
  useEffect(()=>{if(latest?.status==='completed')void client.invalidateQueries({queryKey:['models']});},[client,latest?.taskId,latest?.status]);
  const perform=async(stop=false,protocol='relay-text-v1')=>{setBusy(true);setError(null);try{if(stop&&latest)await mutation(`/tasks/${latest.taskId}/cancel`);else await mutation('/models/calibrations',{modelId,contextTokens:Math.min(contextTokens,32768),protocol});}catch(caught){setError(caught);}finally{void client.invalidateQueries({queryKey:['calibrations']});setBusy(false);}};
  const measurement=latest?.measurement;
  return <details className="calibration" onToggle={event=>setExpanded(event.currentTarget.open)}><summary>Measure local performance</summary><p className="hint">One fixed public prompt, no tools or cloud. Uses the host’s normal queue and safety policy, with a 120-second limit. A sample measures this run; it is not an accuracy score or a peak-memory stress test.</p>
    <div className="button-row"><button type="button" className="button small-button" disabled={busy||!!running||samples.isPending||samples.isFetching||samples.isError} onClick={()=>{void perform();}}>{busy?'Updating…':running?'Calibration running':'Run calibration'}</button>{running&&<button className="button danger-button" disabled={busy} onClick={()=>{void perform(true);}}>Stop calibration</button>}{latest&&<Status status={latest.status}/>}</div>
    <p className="hint">Task-fit probes check six fixed coding, arithmetic and extraction answers. They help compare basic behavior on the exact installed model; they are not a comprehensive intelligence benchmark. Auto routing uses matching results without another classifier call.</p>
    <button type="button" className="button small-button" disabled={busy||!!running||samples.isPending||samples.isFetching||samples.isError} onClick={()=>{void perform(false,'relay-task-fit-v1');}}>Run task-fit probes</button>
    {latest?.taskFit&&<dl className="calibration-results">{Object.entries(latest.taskFit).map(([category,value])=><div key={category}><dt>{humanize(category)} probes</dt><dd>{value.passed}/{value.total} passed</dd></div>)}</dl>}
    {latest?.invalidProbeFormat&&<p className="notice">The model did not return the required probe format. No passing probe result was recorded.</p>}
    {latest&&<p className="hint">{new Date(latest.createdAt).toLocaleString()} · {latest.contextTokens.toLocaleString()} context budget · {humanize(latest.status)}</p>}
    {measurement&&<dl className="calibration-results">{[['generationTokensPerSecond','Generation',' tok/s'],['promptTokensPerSecond','Uncached prompt',' tok/s'],['loadDurationMs','Model load',' ms'],['durationMs','Runtime duration',' ms'],['outputTokens','Generated tokens',''],['cachedInputTokens','Cached input tokens','']].map(([key,label,unit])=>measurement[key]!==undefined&&<div key={key}><dt>{label}</dt><dd>{measurement[key].toLocaleString(undefined,{maximumFractionDigits:1})}{unit}</dd></div>)}</dl>}
    {latest?.status==='completed'&&!measurement&&<p className="hint">Generation completed. This runtime did not provide counters; no measurement is claimed.</p>}{latest?.error&&<p className="notice">{latest.error}</p>}{(error!=null||samples.isError)&&<ErrorNotice error={error??samples.error}/>}
  </details>;
}
