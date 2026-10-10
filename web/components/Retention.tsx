import {useEffect,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {api} from '../api';
import {ErrorNotice} from './ui';

type Counts=Record<'sessions'|'lanInvitations'|'inferenceTokens'|'stepContexts'|'callContexts'|'modelTextEvents',number>;
interface Preview {token:string;expiresAt:string;counts:Counts;protectedTasks:number;limited:boolean;}
const labels:Record<keyof Counts,string>={sessions:'Expired browser sessions',lanInvitations:'Expired invitations',inferenceTokens:'Expired unused client tokens',stepContexts:'Agent contexts',callContexts:'Model call contexts',modelTextEvents:'Streamed text records'};

export default function Retention(){
  const client=useQueryClient();
  const restoration=useQuery({queryKey:['restoration'],queryFn:({signal})=>api<{pending:boolean}>('/admin/restoration',{signal})});
  const [reviewed,setReviewed]=useState(false);
  const acknowledge=useMutation({mutationFn:()=>api('/admin/restoration/review',{method:'POST',body:{confirm:true}}),onSuccess:()=>{void client.invalidateQueries({queryKey:['restoration']});}});
  const [expiredCredentials,setExpired]=useState(false),[terminalPayloads,setPayloads]=useState(false),[days,setDays]=useState(90);
  const [preview,setPreview]=useState<Preview|null>(null),[confirmed,setConfirmed]=useState(false),[result,setResult]=useState<Counts|null>(null);
  const summary=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(preview)summary.current?.focus();},[preview]);
  const reset=()=>{setPreview(null);setConfirmed(false);setResult(null);};
  const inspect=useMutation({mutationFn:()=>api<Preview>('/admin/retention/preview',{method:'POST',body:{expiredCredentials,terminalPayloads,olderThanDays:days,batchSize:100}}),onSuccess:value=>{setPreview(value);setConfirmed(false);setResult(null);}});
  const apply=useMutation({mutationFn:(token:string)=>api<{counts:Counts}>('/admin/retention/apply',{method:'POST',body:{token,confirm:true}}),onSuccess:value=>{setResult(value.counts);setPreview(null);setConfirmed(false);},onError:()=>{setPreview(null);setConfirmed(false);}});
  const busy=inspect.isPending||apply.isPending;
  return <>{restoration.data?.pending&&<section className="notice warning" aria-label="Restored data review"><h3>Review your restored data</h3><p>Tasks are stopped, old login sessions are invalid, and cloud providers are disabled. Check your conversations, workspace locations and recorded file changes before continuing. Reconnect providers separately.</p><p className="small">Remote, LAN and external-client listeners stay off until a restart after this review. Resume execution separately when ready.</p><label className="retention-choice"><input type="checkbox" checked={reviewed} onChange={event=>setReviewed(event.target.checked)}/><span>I have checked this restored copy and its workspace paths.</span></label><button className="secondary" disabled={!reviewed||acknowledge.isPending} onClick={()=>acknowledge.mutate()}>Record restoration review</button>{acknowledge.isError&&<ErrorNotice error={acknowledge.error}/>}</section>}
    {restoration.isError&&<ErrorNotice error={restoration.error}/>}
    <details className="retention-settings"><summary>Data retention</summary><div className="retention-body">
    <p>Review old data before removing it. Cleanup runs only when you confirm a preview.</p>
    <p className="muted small">Conversations, results, audit records and tool receipts stay. Workspaces, recovery state and unfinished tasks are protected. Back up valuable data before cleanup.</p>
    <fieldset disabled={busy}><legend>Choose what to review</legend>
      <label className="retention-choice"><input type="checkbox" checked={expiredCredentials} onChange={event=>{reset();setExpired(event.target.checked);}}/><span>Expired sessions, invitations and unused client tokens</span></label>
      <label className="retention-choice"><input type="checkbox" checked={terminalPayloads} onChange={event=>{reset();setPayloads(event.target.checked);}}/><span>Old agent contexts and streamed text from eligible finished tasks</span></label>
      <label className="retention-age">Older than (days)<input type="number" min={1} max={3650} value={Number.isNaN(days)?'':days} onChange={event=>{reset();setDays(event.target.valueAsNumber);}}/></label>
    </fieldset>
    <button className="secondary" disabled={busy||(!expiredCredentials&&!terminalPayloads)||!Number.isInteger(days)||days<1||days>3650} onClick={()=>{reset();apply.reset();inspect.mutate();}}>{inspect.isPending?'Preparing preview…':'Preview cleanup'}</button>
    {preview&&<div className="retention-preview" ref={summary} tabIndex={-1} role="region" aria-label="Cleanup preview">
      <h4>Review this cleanup</h4><dl>{Object.entries(preview.counts).map(([key,count])=><div key={key}><dt>{labels[key as keyof Counts]}</dt><dd>{count}</dd></div>)}</dl>
      <p className="muted small">{preview.protectedTasks} older tasks protected. Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}.{preview.limited?' This batch is limited; review again after cleanup for remaining data.':''}</p>
      <label className="retention-choice"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)}/><span>I understand these selected records cannot be recovered without a backup.</span></label>
      <button className="danger" disabled={!confirmed||busy||Object.values(preview.counts).every(count=>count===0)} onClick={()=>apply.mutate(preview.token)}>{apply.isPending?'Applying cleanup…':'Apply reviewed cleanup'}</button>
    </div>}
    {result&&<p role="status">Cleanup applied to {Object.values(result).reduce((sum,count)=>sum+count,0)} records. Protected data was preserved.</p>}
    {inspect.isError&&<ErrorNotice error={inspect.error}/>} {apply.isError&&<ErrorNotice error={apply.error}/>}
  </div></details></>;
}
