import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api} from '../api';
import {ErrorNotice,Loading,humanize} from './ui';

interface Timing {elapsedMs:number|null;queueMs:number|null;executionAccountedMs:number|null;approvalWaitMs:number|null;resourceWaitMs:number|null;modelCallWallMs:number|null;toolWallMs:number|null;activeWaitKind:string|null;activeWaitElapsedMs:number|null;truncated:Record<string,boolean>;calls:Array<{id:string;durationMs:number|null;loadDurationMs:number|null;firstContentMs:number|null;loadWallMs:number|null;cleanupWallMs:number|null;streamWallMs:number|null;firstTextEventMs:number|null;generationTokensPerSecond:number|null}>;}
const duration=(ms:number|null)=>ms===null?'Not measured':ms<1000?`${Math.round(ms)} ms`:ms<60000?`${(ms/1000).toFixed(1)} s`:`${(ms/60000).toFixed(1)} min`;
export default function TaskTiming({taskId,running}:{taskId:string;running:boolean}){
  const [open,setOpen]=useState(false);
  const query=useQuery({queryKey:['task-timing',taskId],enabled:open,queryFn:({signal})=>api<Timing>(`/tasks/${taskId}/timing`,{signal}),refetchInterval:open&&running?5000:false});
  const data=query.data;
  const rows:Array<[string,number|null]>=data?[['Elapsed',data.elapsedMs],['Initial queue',data.queueMs],['Active execution charged',data.executionAccountedMs],['Model calls',data.modelCallWallMs],['Tools',data.toolWallMs],['Approval waiting',data.approvalWaitMs],['Resource waiting',data.resourceWaitMs]]:[];
  return <details className="task-timing" onToggle={event=>setOpen(event.currentTarget.open)}><summary>Where the time went</summary>{query.isPending&&open?<Loading>Reading recorded timings…</Loading>:data&&<>
    <dl className="timing-facts">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{duration(value)}</dd></div>)}</dl>
    {data.activeWaitKind&&<p className="hint">Currently waiting for {humanize(data.activeWaitKind).toLowerCase()}: {duration(data.activeWaitElapsedMs)} so far.</p>}
    <p className="hint">Intervals can overlap; these totals should not be added together. Active time is budget accounting, not CPU usage.</p>
    {Object.values(data.truncated).some(Boolean)&&<p className="hint">This view reached its record limit. Incomplete totals are left unmeasured.</p>}
    {data.calls.length>0&&<details><summary>Model call measurements</summary><ol className="timing-calls">{data.calls.map((call,index)=><li key={call.id}><strong>Call {index+1}</strong><dl><div><dt>Elapsed</dt><dd>{duration(call.durationMs)}</dd></div><div><dt>Runtime-reported load</dt><dd>{duration(call.loadDurationMs)}</dd></div><div><dt>Managed model load</dt><dd>{duration(call.loadWallMs)}</dd></div><div><dt>First streamed content</dt><dd>{duration(call.firstContentMs)}</dd></div><div><dt>Request and streaming</dt><dd>{duration(call.streamWallMs)}</dd></div><div><dt>Verified model cleanup</dt><dd>{duration(call.cleanupWallMs)}</dd></div><div><dt>First persisted text</dt><dd>{duration(call.firstTextEventMs)}</dd></div><div><dt>Generation</dt><dd>{call.generationTokensPerSecond===null?'Not measured':`${call.generationTokensPerSecond.toFixed(1)} tokens/s`}</dd></div></dl></li>)}</ol><p className="hint">First streamed content is observed before saving text events; it includes loading and transport, not an exact internal first token. Streaming includes consumer processing. Cleanup is recorded only after Relay verifies its private instance was unloaded.</p></details>}
  </>}{query.isError&&<ErrorNotice error={query.error}/>}</details>;
}
