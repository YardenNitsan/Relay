import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { request, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import type { NetworkPolicy, ToolResult } from '../../shared/types';
import { isPublicAddress, validateNetworkUrl } from './network-policy';
import { utf8Excerpt } from '../core/text';

const TRANSFER_LIMIT=512*1024;
const TEXT_LIMIT=16*1024;
export type PublicAddress={address:string;family:4|6};
function abortable<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new Error('Research request cancelled'));
    signal.addEventListener('abort',abort,{once:true});
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
/** Resolve once, validate every answer, and pass only the selected address to the connection. */
export async function resolvePublicAddress(hostname:string,signal:AbortSignal):Promise<PublicAddress> {
  const host=hostname.replace(/^\[|\]$/g,'');const literal=isIP(host);
  const addresses=literal ? [{address:host,family:literal}] : await abortable(lookup(host,{all:true,verbatim:true}),signal);
  signal.throwIfAborted();
  if (!addresses.length || addresses.length>20 || addresses.some(value=>!isPublicAddress(value.address) || ![4,6].includes(value.family))) throw new Error('DNS destination is not exclusively public');
  return {address:addresses[0].address,family:addresses[0].family as 4|6};
}
export function matchingAddress(actual:string|undefined,pinned:PublicAddress):boolean {
  if (!actual) return false;
  const expected=new BlockList(); expected.addAddress(pinned.address,pinned.family===4?'ipv4':'ipv6');
  return expected.check(actual,isIP(actual)===6?'ipv6':'ipv4');
}
type Response={status:number;headers:IncomingHttpHeaders;body:Buffer};
export function pinnedRequestOptions(url:URL,address:PublicAddress):RequestOptions & {autoSelectFamily:boolean} {
  return {
    protocol:'https:',hostname:url.hostname.replace(/^\[|\]$/g,''),port:'443',path:url.pathname+url.search,
    servername:isIP(url.hostname.replace(/^\[|\]$/g,''))?undefined:url.hostname,
    agent:false,autoSelectFamily:false,family:address.family,maxHeaderSize:8192,rejectUnauthorized:true,
    lookup:(_host,options,callback)=>{if(options.all)callback(null,[address]);else callback(null,address.address,address.family);},
  };
}
function exchange(url:URL,address:PublicAddress,signal:AbortSignal):Promise<Response> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    let done=false;
    const finish=(error?:Error,result?:Response)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(result!);};
    const abort=()=>{req.destroy(new Error('Research request cancelled'));};
    const options:RequestOptions & {autoSelectFamily:boolean}={
      ...pinnedRequestOptions(url,address),method:'GET',
      headers:{Accept:'text/plain, text/html, text/markdown, application/json, application/xhtml+xml','Accept-Encoding':'identity','User-Agent':'Relay-Research/0.1'},
    };
    const req=request(options,response=>{
      const fail=(message:string)=>{const error=new Error(message);finish(error);response.destroy();req.destroy();};
      if (!matchingAddress(response.socket.remoteAddress,address)) return fail('Connected address differs from the validated public address');
      const status=response.statusCode??0;
      if ([301,302,303,307,308].includes(status)) {finish(undefined,{status,headers:response.headers,body:Buffer.alloc(0)});response.destroy();return;}
      const contentType=response.headers['content-type']??'';
      if (!/^(?:text\/(?:plain|html|markdown)|application\/(?:json|xhtml\+xml))(?:\s*;|$)/i.test(contentType)) return fail('Research response is not a supported text content type');
      const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1];
      if (charset && !/^(?:utf-8|utf8|us-ascii)$/i.test(charset)) return fail('Research response encoding is unsupported');
      if (response.headers['content-encoding'] && response.headers['content-encoding']!=='identity') return fail('Compressed response encoding is not permitted');
      const declared=response.headers['content-length'];
      if (declared && (!/^\d+$/.test(declared) || Number(declared)>TRANSFER_LIMIT)) return fail('Research response exceeds transfer limit');
      const chunks:Buffer[]=[];let length=0;
      response.on('data',(chunk:Buffer)=>{length+=chunk.length;if(length>TRANSFER_LIMIT)return fail('Research response exceeds transfer limit');chunks.push(chunk);});
      response.on('error',()=>finish(new Error('Research response stream failed')));
      response.on('aborted',()=>finish(new Error('Research response was interrupted')));
      response.on('end',()=>{if(!response.complete)return finish(new Error('Incomplete research response'));finish(undefined,{status,headers:response.headers,body:Buffer.concat(chunks)});});
    });
    req.on('error',()=>finish(new Error(signal.aborted?'Research request cancelled':'Public HTTPS request failed')));
    signal.addEventListener('abort',abort,{once:true});
    if(signal.aborted)abort();else req.end();
  });
}

export class PublicHttpClient {
  private readonly active=new Set<AbortController>();
  stopAll():void {for(const controller of this.active)controller.abort();}
  async get(value:string,policy:NetworkPolicy,taskSignal:AbortSignal):Promise<ToolResult> {
    const controller=new AbortController();this.active.add(controller);
    const timeout=setTimeout(()=>controller.abort(),10_000);timeout.unref();
    const signal=AbortSignal.any([taskSignal,controller.signal]);
    try {
      let url=validateNetworkUrl(value,policy);const redirects:Array<{url:string;status:number;location:string}>=[];
      for(let attempt=0;attempt<4;attempt++) {
        signal.throwIfAborted();const address=await resolvePublicAddress(url.hostname,signal);
        const response=await exchange(url,address,signal);signal.throwIfAborted();
        if ([301,302,303,307,308].includes(response.status)) {
          if (attempt===3 || !response.headers.location) throw new Error('Research redirect limit reached or redirect has no destination');
          const next=validateNetworkUrl(new URL(response.headers.location,url).href,policy);
          redirects.push({url:url.href,status:response.status,location:next.href});url=next;continue;
        }
        let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(response.body);}catch{throw new Error('Research response is not valid UTF-8');}
        const excerpt=utf8Excerpt(text,TEXT_LIMIT);const {truncated}=excerpt;
        return {content:JSON.stringify({url:url.href,redirects,status:response.status,contentType:response.headers['content-type'],content:excerpt.text,receivedBytes:response.body.length,sha256:createHash('sha256').update(response.body).digest('hex'),truncated,trust:'untrusted'}),evidence:[{kind:'http_response',summary:`Observed public HTTPS response ${response.status}${truncated?' (text truncated)':''}`,passed:true,details:{url:url.href,status:response.status,receivedBytes:response.body.length,truncated,trust:'untrusted'}}]};
      }
      throw new Error('Research redirect limit reached');
    } finally {clearTimeout(timeout);this.active.delete(controller);}
  }
}
