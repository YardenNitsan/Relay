import {Cloud,Cpu} from 'lucide-react';
import type {UsageReport} from '../../../shared/usage';

const limitNames={tokens:'Tokens',input_tokens:'Input tokens',output_tokens:'Output tokens',requests:'Requests'};

export function ModelUsage({model}:{model:UsageReport['models'][number]}){
  return <article className="usage-studio-model" aria-label={`${model.name} usage`}>
    <header><div className="usage-studio-model-name">{model.local?<Cpu size={19} aria-hidden="true"/>:<Cloud size={19} aria-hidden="true"/>}<div><h4 dir="auto">{model.name}</h4><p>{model.local?'Local · host computer':`Cloud · ${model.provider}`}</p></div></div><p className="usage-studio-requests">{model.requests.toLocaleString()} {model.requests===1?'request':'requests'}</p></header>
    <dl className="usage-studio-tokens"><div><dt>Input tokens</dt><dd>{model.inputTokens.toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{model.outputTokens.toLocaleString()}</dd></div></dl>
    {model.unreportedCalls>0&&<p className="usage-studio-incomplete">Incomplete token reporting for {model.unreportedCalls.toLocaleString()} {model.unreportedCalls===1?'request':'requests'}.</p>}
    {model.local?<p className="usage-studio-remaining">No prepaid token limit</p>:<>
      {!model.limits?.limits.some(limit=>limit.kind!=='requests')&&<p className="usage-studio-remaining">Remaining tokens not reported by provider</p>}
      {model.limits&&model.limits.limits.length>0&&<section className="usage-studio-limits" aria-label={`${model.name} rate limits`}><h5>Last observed rate limits</h5><dl>{model.limits.limits.map(limit=><div key={limit.kind}><dt>{limitNames[limit.kind]}</dt><dd><strong>{limit.remaining.toLocaleString()}</strong> remaining{limit.limit!==null&&<span> / {limit.limit.toLocaleString()}</span>}{limit.reset&&<small>Reset reported: {limit.reset}</small>}</dd></div>)}</dl><p>Observed <time dateTime={model.limits.observedAt}>{new Date(model.limits.observedAt).toLocaleString()}</time>. Provider rate windows can be shared across models and apps; these values are not a credit balance or a daily token allowance.</p></section>}
    </>}
  </article>;
}
