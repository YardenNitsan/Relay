import { request } from 'node:https';
import type { FetchLike } from '@modelcontextprotocol/client';
import { matchingAddress,pinnedRequestOptions,resolvePublicAddress } from '../tools/http';
import { boundedJson,mcpEndpointSchema } from './schema';

/** Narrow SDK fetch boundary. Never delegates to global fetch or follows a server URL. */
export class PinnedMcpSession {
  dispatchedTool=false;
  private requests=0;
  private receivedBytes=0;
  private toolRequests=0;
  private readonly endpoint:URL;
  constructor(endpoint:string,private readonly signal:AbortSignal) {this.endpoint=new URL(mcpEndpointSchema.parse(endpoint));}
  readonly fetch:FetchLike=async(input,init)=>{
    this.signal.throwIfAborted();
    if(new URL(input).href!==this.endpoint.href || init?.method!=='POST' || typeof init.body!=='string')throw new Error('MCP transport permits only POST to the configured endpoint');
    if(++this.requests>8 || Buffer.byteLength(init.body)>65536)throw new Error('MCP request budget exceeded');
    const message=JSON.parse(init.body) as {method?:unknown;id?:unknown};boundedJson(message);
    if(!['server/discover','tools/list','tools/call'].includes(String(message.method)) || (typeof message.id!=='number' && typeof message.id!=='string'))throw new Error('Unsupported MCP operation');
    if(message.method==='tools/call' && ++this.toolRequests>1)throw new Error('Automatic MCP tool replay is forbidden');
    const headers=new Headers(init.headers);const allowed=new Set(['accept','content-type','mcp-protocol-version','mcp-method','mcp-name']);
    for(const [key,value] of headers){if(!allowed.has(key) || value.length>2048 || /[\u0000-\u001f\u007f]/u.test(value))throw new Error('Unsupported MCP request header');}
    if(headers.get('mcp-method')!==message.method || headers.get('content-type')!=='application/json')throw new Error('MCP header/body mismatch');
    headers.set('Accept-Encoding','identity');headers.set('User-Agent','Relay-MCP/0.1');
    const signal=AbortSignal.any([this.signal,...(init.signal?[init.signal]:[])]);
    const address=await resolvePublicAddress(this.endpoint.hostname,signal);signal.throwIfAborted();
    return new Promise<Response>((resolve,reject)=>{
      let done=false;
      const finish=(error?:Error,response?:Response)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(response!);};
      const abort=()=>req.destroy(new Error('MCP request cancelled'));
      const req=request({...pinnedRequestOptions(this.endpoint,address),method:'POST',headers:Object.fromEntries(headers)},response=>{
        const fail=(message:string)=>{finish(new Error(message));response.destroy();req.destroy();};
        if(!matchingAddress(response.socket.remoteAddress,address))return fail('MCP connected address differs from the validated address');
        const status=response.statusCode??0;
        if(status>=300 && status<400)return fail('MCP redirects are disabled');
        if(status!==200)return fail(`MCP endpoint returned unsupported HTTP status ${status}`);
        if(response.headers['content-encoding'] && response.headers['content-encoding']!=='identity')return fail('MCP compression is disabled');
        if(!/^(?:application\/json|text\/event-stream)(?:\s*;|$)/i.test(response.headers['content-type']??''))return fail('Unsupported MCP response content type');
        const declared=response.headers['content-length'];if(declared && (!/^\d+$/.test(declared) || Number(declared)+this.receivedBytes>512*1024))return fail('MCP response transfer budget exceeded');
        const chunks:Buffer[]=[];
        response.on('data',(chunk:Buffer)=>{this.receivedBytes+=chunk.length;if(this.receivedBytes>512*1024)return fail('MCP response transfer budget exceeded');chunks.push(chunk);});
        response.on('error',()=>finish(new Error('MCP response stream failed')));response.on('aborted',()=>finish(new Error('MCP response interrupted')));
        response.on('end',()=>{
          if(!response.complete)return finish(new Error('MCP response incomplete'));
          // No Set-Cookie, Location, auth challenge or server-controlled cache/session headers cross this boundary.
          try {finish(undefined,new Response(Buffer.concat(chunks),{status,headers:{'content-type':response.headers['content-type']!}}));}
          catch {finish(new Error('Invalid MCP HTTP response'));}
        });
      });
      req.on('error',()=>finish(new Error(signal.aborted?'MCP request cancelled':'MCP public HTTPS request failed')));
      signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)abort();else {if(message.method==='tools/call')this.dispatchedTool=true;req.end(init.body);}
    });
  };
}
