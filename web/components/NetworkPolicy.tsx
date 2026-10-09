import { useEffect, useState } from 'react';
import type { NetworkPolicy } from '../../shared/types';

const origins=(text:string)=>text.split(/[\n,]/).map(value=>value.trim()).filter(Boolean);

/** Network grants are independent from model selection and workspace access. */
export default function NetworkPolicyEditor({value,onChange,owner,maxAccess='deny',grantedOrigins=[]}:{value:NetworkPolicy|undefined;onChange:(value:NetworkPolicy)=>void;owner:boolean;maxAccess?:NetworkPolicy['mode'];grantedOrigins?:string[]}) {
  const policy=value??{mode:'deny',allowedOrigins:[]};
  const [text,setText]=useState(policy.allowedOrigins.join('\n'));
  const serialized=JSON.stringify(policy.allowedOrigins);
  useEffect(()=>{setText(current=>JSON.stringify(origins(current))===serialized?current:(JSON.parse(serialized) as string[]).join('\n'));},[serialized]);
  const levels=['deny','ask','allow'];
  return <fieldset className="network-policy"><legend>Research network access</legend><label>Public web requests<select value={policy.mode} onChange={event=>onChange({...policy,mode:event.target.value as NetworkPolicy['mode']})}>
    <option value="deny">Disabled</option><option value="ask" disabled={!owner&&levels.indexOf(maxAccess)<1}>Approve each request</option><option value="allow" disabled={!owner&&maxAccess!=='allow'}>Allow listed origins</option>
  </select></label>{policy.mode!=='deny'&&(owner?<label>Allowed HTTPS origins<textarea rows={3} value={text} maxLength={16000} placeholder={'https://nodejs.org\nhttps://www.postgresql.org'} onChange={event=>{setText(event.target.value);onChange({...policy,allowedOrigins:origins(event.target.value)});}} /><span className="hint">One exact origin per line, without paths. Redirects must remain within this list.</span></label>:<div className="policy-checkboxes">{grantedOrigins.map(origin=><label className="check-label" key={origin}><input type="checkbox" checked={policy.allowedOrigins.includes(origin)} onChange={event=>onChange({...policy,allowedOrigins:event.target.checked?[...policy.allowedOrigins,origin]:policy.allowedOrigins.filter(item=>item!==origin)})}/>{origin}</label>)}</div>)}<p className="hint">Requests send their URL to the selected websites, even with local-only AI. No cookies, credentials or private network access.</p></fieldset>;
}
