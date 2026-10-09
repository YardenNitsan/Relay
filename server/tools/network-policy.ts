import { BlockList, isIP } from 'node:net';
import { z } from 'zod';
import type { NetworkPolicy, ToolRequest } from '../../shared/types';

const blocked4 = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked4.addSubnet(address,prefix,'ipv4');
const global6 = new BlockList(); global6.addSubnet('2000::',3,'ipv6');
const blocked6 = new BlockList();
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const) blocked6.addSubnet(address,prefix,'ipv6');

/** Conservative globally routable addresses only; reject transition and special-purpose ranges. */
export function isPublicAddress(address:string):boolean {
  if (address.includes('%')) return false;
  const family=isIP(address);
  return family===4 ? !blocked4.check(address,'ipv4') : family===6 && global6.check(address,'ipv6') && !blocked6.check(address,'ipv6');
}
function publicUrl(value:string):URL {
  if (value.length>4096 || /[\u0000-\u0020\u007f\\]/u.test(value)) throw new Error('Invalid research URL');
  let url:URL; try { url=new URL(value); } catch { throw new Error('Invalid research URL'); }
  if (url.protocol!=='https:' || (url.port && url.port!=='443') || url.username || url.password || url.hash) throw new Error('Research requires HTTPS on port 443 without credentials or fragments');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if (isIP(host) ? !isPublicAddress(host) : !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$|(?:^|\.)home\.arpa$|\.$/i.test(host)) throw new Error('Research destination is not a public host');
  return url;
}
export const networkOriginSchema=z.string().max(2048).transform((value,context)=>{
  try {
    const url=publicUrl(value);
    if (url.pathname!=='/' || url.search) throw new Error('Expected an exact HTTPS origin without a path or query');
    return url.origin;
  } catch(error) { context.addIssue({code:'custom',message:error instanceof Error?error.message:'Invalid network origin'}); return z.NEVER; }
});
export const networkPolicySchema=z.object({mode:z.enum(['deny','ask','allow']),allowedOrigins:z.array(networkOriginSchema).max(16)}).strict().refine(value=>new Set(value.allowedOrigins).size===value.allowedOrigins.length,'Network origins must be unique');

export function validateNetworkUrl(value:string,policy:NetworkPolicy|undefined):URL {
  if (!policy || policy.mode==='deny') throw new Error('Network access is disabled');
  const parsed=networkPolicySchema.safeParse(policy); if (!parsed.success) throw new Error('Invalid network policy');
  const url=publicUrl(value);
  if (!parsed.data.allowedOrigins.includes(url.origin)) throw new Error('Destination is outside the authorized network origins');
  // This is a conservative leak tripwire, not a general data-loss prevention guarantee.
  let decoded:string; try { decoded=decodeURIComponent(url.pathname+url.search); } catch { throw new Error('Invalid URL encoding'); }
  if (/[\u0000-\u001f\u007f]/u.test(decoded) || /(?:sk-[a-z0-9_-]{12,}|AKIA[A-Z0-9]{12,}|AIza[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{12,}|Bearer\s|PRIVATE[ _-]KEY)/i.test(decoded)) throw new Error('Potential credential data in research URL');
  for (const [key,item] of url.searchParams) {
    if (/(?:token|secret|api.?key|password|passwd|authorization|cookie|credential|signature|session|access.?key)/i.test(key) || item.length>256) throw new Error('Sensitive or oversized research query is not permitted');
  }
  return url;
}

/** Never persist a rejected URL that might itself contain a credential. The marker fails policy. */
export function safeHttpRequestForRecord(request:ToolRequest,policy?:NetworkPolicy):ToolRequest {
  if (request.name!=='http_get') return request;
  try {
    if (Object.keys(request.arguments).length!==1 || typeof request.arguments.url!=='string') throw new Error('Invalid request');
    validateNetworkUrl(request.arguments.url,policy); return request;
  } catch { return {...request,arguments:{url:'[redacted: blocked research URL]'}}; }
}
