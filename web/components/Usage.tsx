import { useQuery } from '@tanstack/react-query';
import { BarChart3, Cloud, Cpu, RefreshCw } from 'lucide-react';
import type { UsageReport } from '../../shared/usage';
import { api } from '../api';
import { Empty, ErrorNotice, Loading } from './ui';

const number = (value: number) => value.toLocaleString();
const limitNames = { tokens: 'Tokens', input_tokens: 'Input tokens', output_tokens: 'Output tokens', requests: 'Requests' };

/** Mounted only while the drawer is open; no background usage polling. */
export default function Usage() {
  const query = useQuery({ queryKey: ['usage'], queryFn: ({ signal }) => api<UsageReport>('/usage', { signal }), refetchInterval: 15_000 });
  const report = query.data;
  const totals = report?.models.reduce((sum, model) => ({ tokens: sum.tokens + model.inputTokens + model.outputTokens, requests: sum.requests + model.requests, missing: sum.missing + model.unreportedCalls }), { tokens: 0, requests: 0, missing: 0 });
  return <div className="usage-view"><div className="usage-intro"><div><p className="eyebrow">Your account · today UTC</p><p className="muted">Measured usage recorded by this Relay host. Other accounts and activity outside Relay are not included.</p></div><button className="icon-button" aria-label="Refresh usage" disabled={query.isFetching} onClick={() => { void query.refetch(); }}><RefreshCw size={17} className={query.isFetching ? 'spin' : ''} /></button></div>
    {query.isPending ? <Loading>Loading your usage…</Loading> : query.isError ? <ErrorNotice error={query.error} retry={() => { void query.refetch(); }} /> : report && totals && <>
      <dl className="usage-summary"><div><dt>Reported tokens</dt><dd>{number(totals.tokens)}</dd></div><div><dt>Requests</dt><dd>{number(totals.requests)}</dd></div></dl>
      <p className="hint usage-period">{new Date(report.periodStart).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })} · resets at 00:00 UTC</p>
      {totals.missing > 0 && <p className="notice">{number(totals.missing)} {totals.missing === 1 ? 'request has' : 'requests have'} no complete token report. Reported totals are partial.</p>}
      {report.truncated && <p className="notice">Showing the first 1,000 model records. Totals shown are partial.</p>}
      {!report.models.length ? <Empty title="No model usage today" icon={<BarChart3 size={26} />}><p>Your model activity will appear here after a request is recorded.</p></Empty> : <div className="usage-models">{report.models.map(model => <article className="usage-model" key={model.modelId} aria-label={`${model.name} usage`}>
        <div className="usage-model-heading">{model.local ? <Cpu size={18} /> : <Cloud size={18} />}<div><h3>{model.name}</h3><p className="small muted">{model.local ? 'Local · host computer' : `Cloud · ${model.provider}`}</p></div><span className="small muted">{number(model.requests)} {model.requests === 1 ? 'request' : 'requests'}</span></div>
        <dl className="usage-token-counts"><div><dt>Input tokens</dt><dd>{number(model.inputTokens)}</dd></div><div><dt>Output tokens</dt><dd>{number(model.outputTokens)}</dd></div></dl>
        {model.unreportedCalls > 0 && <p className="hint">Incomplete token reporting for {number(model.unreportedCalls)} {model.unreportedCalls === 1 ? 'request' : 'requests'}.</p>}
        {model.local ? <p className="usage-remaining">No prepaid token limit</p> : <>
          {!model.limits?.limits.some(limit => limit.kind !== 'requests') && <p className="usage-remaining">Remaining tokens not reported by provider</p>}
          {model.limits && model.limits.limits.length > 0 && <div className="usage-limits"><h4>Last observed rate limits</h4><dl>{model.limits.limits.map(limit => <div key={limit.kind}><dt>{limitNames[limit.kind]}</dt><dd><strong>{number(limit.remaining)}</strong> remaining{limit.limit !== null && <span> / {number(limit.limit)}</span>}{limit.reset && <small>Reset reported: {limit.reset}</small>}</dd></div>)}</dl><p className="hint">Observed {new Date(model.limits.observedAt).toLocaleString()}. Provider rate windows can be shared across models and apps; these values are not a credit balance or a daily token allowance.</p></div>}
        </>}
      </article>)}</div>}
      <p className="hint usage-footer">Local models use your host’s resources. Cloud limits and billing are controlled by each provider. Relay never estimates a remaining token balance.</p>
    </>}
  </div>;
}
