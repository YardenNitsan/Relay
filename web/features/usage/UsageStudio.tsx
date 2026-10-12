import {useQuery} from '@tanstack/react-query';
import {BarChart3,RefreshCw} from 'lucide-react';
import type {UsageReport} from '../../../shared/usage';
import {api} from '../../api';
import {Empty,ErrorNotice,Loading} from '../../components/ui';
import {ModelUsage} from './ModelUsage';
import './usage.css';

/** Mounted only while Usage is open; account-scoped, read-only reporting. */
export default function UsageStudio(){
  const query=useQuery({queryKey:['usage'],queryFn:({signal})=>api<UsageReport>('/usage',{signal}),refetchInterval:15_000});
  const report=query.data;
  const totals=report?.models.reduce((sum,model)=>({tokens:sum.tokens+model.inputTokens+model.outputTokens,requests:sum.requests+model.requests,missing:sum.missing+model.unreportedCalls}),{tokens:0,requests:0,missing:0});
  return <div className="usage-studio">
    <header className="usage-studio-intro"><div><span className="usage-report-label">RELAY / USAGE REPORT</span><h3>Your account, today</h3><p>Usage recorded by this Relay host. Other accounts and activity outside Relay are not included.</p></div><button className="icon-button" aria-label="Refresh usage" disabled={query.isFetching} onClick={()=>{void query.refetch();}}><RefreshCw size={18} aria-hidden="true"/></button></header>
    {query.isError&&<div className="usage-studio-error"><ErrorNotice error={query.error} retry={()=>{void query.refetch();}}/>{report&&<p>Showing the last loaded report.</p>}</div>}
    {query.isPending&&<Loading>Loading your usage…</Loading>}
    {report&&totals&&<>
      <section className="usage-studio-overview" aria-label="Reported account usage">
        <p className="usage-studio-period"><time dateTime={report.periodStart}>{new Date(report.periodStart).toLocaleDateString(undefined,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric'})}</time> · resets at 00:00 UTC</p>
        <dl className="usage-studio-totals"><div><dt>Reported tokens</dt><dd>{totals.tokens.toLocaleString()}</dd></div><div><dt>Requests</dt><dd>{totals.requests.toLocaleString()}</dd></div></dl>
        <p className="usage-studio-asof">Report through <time dateTime={report.periodEnd}>{new Date(report.periodEnd).toLocaleString(undefined,{timeZone:'UTC',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})} UTC</time>. Refreshes every 15 seconds while open.</p>
        {totals.missing>0&&<p className="usage-studio-caveat">{totals.missing.toLocaleString()} {totals.missing===1?'request has':'requests have'} no complete token report. Reported totals are partial.</p>}
        {report.truncated&&<p className="usage-studio-caveat">Showing the first 1,000 model records. Totals shown are partial.</p>}
      </section>
      <section className="usage-studio-ledger" aria-label="Usage by model"><h3>By model</h3>
        {!report.models.length?<Empty title="No model usage today" icon={<BarChart3 size={26} aria-hidden="true"/>}><p>Your model activity will appear here after a request is recorded.</p></Empty>:report.models.map(model=><ModelUsage key={model.modelId} model={model}/>)}
      </section>
      <footer className="usage-studio-footer"><p>Local models use your host’s resources. Cloud limits and billing are controlled by each provider. Relay never estimates a remaining token balance.</p></footer>
    </>}
  </div>;
}
