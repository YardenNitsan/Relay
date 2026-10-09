import type {ProviderId} from '../../shared/types.js';
import type {ProviderLimitSnapshot} from '../../shared/usage.js';
function integer(value:string|null):number|null {
  if(value===null||!/^\d{1,15}$/.test(value))return null;
  const parsed=Number(value);return Number.isSafeInteger(parsed)?parsed:null;
}
/** Rate-window observations are not a prepaid balance or subscription allowance.
 * Only documented header families are read; no extra provider requests are made. */
export function parseRateLimits(provider:ProviderId,headers:Headers):ProviderLimitSnapshot['limits'] {
  const definitions:Array<[ProviderLimitSnapshot['limits'][number]['kind'],string,string,string]>=provider==='openai'
    ? ['tokens','requests'].map(kind=>[kind as 'tokens'|'requests',`x-ratelimit-remaining-${kind}`,`x-ratelimit-limit-${kind}`,`x-ratelimit-reset-${kind}`])
    : provider==='anthropic'?['tokens','input-tokens','output-tokens','requests'].map(kind=>[kind.replaceAll('-','_') as ProviderLimitSnapshot['limits'][number]['kind'],`anthropic-ratelimit-${kind}-remaining`,`anthropic-ratelimit-${kind}-limit`,`anthropic-ratelimit-${kind}-reset`]):[];
  return definitions.flatMap(([kind,remainingHeader,limitHeader,resetHeader])=>{
    const remaining=integer(headers.get(remainingHeader));if(remaining===null)return [];
    const limit=integer(headers.get(limitHeader));if(limit!==null&&remaining>limit)return [];
    const reset=headers.get(resetHeader);
    return [{kind,remaining,limit,reset:reset&&/^[\x20-\x7e]{1,96}$/.test(reset)?reset:null}];
  });
}
