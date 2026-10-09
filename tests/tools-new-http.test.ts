import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { ToolBroker } from '../server/tools/index.js';
import type { ToolContext } from '../shared/types.js';
import { isPublicAddress, networkPolicySchema, safeHttpRequestForRecord, validateNetworkUrl } from '../server/tools/network-policy';
import { PublicHttpClient } from '../server/tools/http';

const fixture=vi.hoisted(()=>({answers:[{address:'93.184.216.34',family:4}],requests:[] as Array<Record<string,unknown>>,responses:[] as Array<{status?:number;headers?:Record<string,string>;body?:string;remoteAddress?:string;hang?:boolean}>,lookups:0}));
vi.mock('node:dns/promises',()=>({lookup:async()=>{fixture.lookups++;return fixture.answers;}}));
vi.mock('node:https',()=>({request:(options:Record<string,unknown>,callback:(response:Readable)=>void)=>{
  fixture.requests.push(options);const request=new EventEmitter() as EventEmitter&{end:()=>void;destroy:(error?:Error)=>void};
  request.destroy=(error)=>{if(error)queueMicrotask(()=>request.emit('error',error));};
  request.end=()=>{queueMicrotask(()=>{const next=fixture.responses.shift()??{};if(next.hang)return;const response=Object.assign(Readable.from([Buffer.from(next.body??'Public documentation')]),{statusCode:next.status??200,headers:{'content-type':'text/plain; charset=utf-8',...next.headers},socket:{remoteAddress:next.remoteAddress??'93.184.216.34'},complete:true});callback(response);});};
  return request;
}}));
beforeEach(()=>{fixture.answers=[{address:'93.184.216.34',family:4}];fixture.requests=[];fixture.responses=[];fixture.lookups=0;});

const context:ToolContext={taskId:'task',agentId:'researcher',workspaceId:null,access:'read_only',allowedTools:['http_get'],signal:new AbortController().signal,approved:false,network:{mode:'ask',allowedOrigins:['https://example.com']}};
describe('separate network capability',()=>{
  it('requires explicit network approval without requiring filesystem access',()=>{
    const broker=new ToolBroker('output/http-policy-test',()=>false);const request={id:'request',name:'http_get',arguments:{url:'https://example.com/docs'}};
    expect(broker.decide(context,request).decision).toBe('approval');
    expect(broker.decide({...context,approved:true},request).decision).toBe('allow');
    expect(broker.decide({...context,network:undefined,approved:true},request).decision).toBe('deny');
    expect(broker.decide({...context,network:{mode:'allow',allowedOrigins:['https://elsewhere.example']}},request).decision).toBe('deny');
  });
});

describe('public HTTPS boundary',()=>{
  const policy={mode:'allow' as const,allowedOrigins:['https://example.com']};
  it.each(['127.0.0.1','10.2.3.4','169.254.169.254','100.100.100.200','198.18.0.1','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','64:ff9b::7f00:1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::1','3fff::1'])('rejects nonpublic address %s',(address)=>expect(isPublicAddress(address)).toBe(false));
  it.each(['93.184.216.34','8.8.8.8','2606:4700:4700::1111'])('accepts globally routable address %s',(address)=>expect(isPublicAddress(address)).toBe(true));
  it.each(['http://example.com','https://user:password@example.com','https://example.com:444','https://localhost','https://0x7f000001','https://[::1]','https://example.com/path'])('rejects invalid origin %s',(origin)=>expect(networkPolicySchema.safeParse({mode:'allow',allowedOrigins:[origin]}).success).toBe(false));
  it.each(['https://example.com/?api_key=secret','https://example.com/sk-1234567890123456789','https://example.com/%00','https://example.com/?q='+ 'a'.repeat(257)])('rejects suspicious egress before DNS %s',async(url)=>{
    await expect(new PublicHttpClient().get(url,policy,new AbortController().signal)).rejects.toThrow();expect(fixture.lookups).toBe(0);expect(fixture.requests).toHaveLength(0);
    expect(safeHttpRequestForRecord({id:'x',name:'http_get',arguments:{url}},policy).arguments.url).toBe('[redacted: blocked research URL]');
  });
  it('pins the validated DNS answer and sends no credential headers',async()=>{
    const result=await new PublicHttpClient().get('https://example.com/docs',policy,new AbortController().signal);const data=JSON.parse(result.content);
    expect(data.content).toBe('Public documentation');expect(data.trust).toBe('untrusted');expect(data.sha256).toMatch(/^[a-f0-9]{64}$/);
    const options=fixture.requests[0];expect(options.agent).toBe(false);expect(options.hostname).toBe('example.com');expect(options.servername).toBe('example.com');
    expect(options.rejectUnauthorized).toBe(true);
    const lookup=options.lookup as (host:string,options:object,callback:(error:unknown,address:string,family:number)=>void)=>void;
    const output:unknown[]=[];lookup('example.com',{},(...values)=>output.push(...values));expect(output).toEqual([null,'93.184.216.34',4]);
    expect(JSON.stringify(options.headers)).not.toMatch(/authorization|cookie/i);
  });
  it('rejects mixed public/private DNS answers before a connection',async()=>{fixture.answers.push({address:'127.0.0.1',family:4});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/public/i);expect(fixture.requests).toHaveLength(0);});
  it('blocks socket address mismatch',async()=>{fixture.responses.push({remoteAddress:'127.0.0.1'});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/address/i);});
  it('validates redirect destinations before making another request',async()=>{fixture.responses.push({status:302,headers:{location:'https://127.0.0.1/private'}});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow();expect(fixture.requests).toHaveLength(1);});
  it('resolves and pins each authorized redirect independently',async()=>{fixture.responses.push({status:302,headers:{location:'/next'}},{body:'Final'});const data=JSON.parse((await new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).content);expect(data.content).toBe('Final');expect(data.redirects).toHaveLength(1);expect(fixture.lookups).toBe(2);});
  it('bounds transferred bytes and rejects compressed responses',async()=>{fixture.responses.push({body:'a'.repeat(524289)});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/limit/i);fixture.responses.push({headers:{'content-encoding':'gzip'}});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/encoding/i);});
  it('permits ordinary documentation-sized pages while bounding displayed text',async()=>{fixture.responses.push({body:'x'.repeat(200_000)});const data=JSON.parse((await new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).content);expect(data.receivedBytes).toBe(200_000);expect(data.content.length).toBe(16384);expect(data.truncated).toBe(true);});
  it('cancels a hanging request and global stop cancels another',async()=>{const client=new PublicHttpClient();const controller=new AbortController();fixture.responses.push({hang:true});const request=client.get('https://example.com',policy,controller.signal);await new Promise(resolve=>setTimeout(resolve,5));controller.abort();await expect(request).rejects.toThrow(/abort|cancel/i);fixture.responses.push({hang:true});const second=client.get('https://example.com',policy,new AbortController().signal);await new Promise(resolve=>setTimeout(resolve,5));client.stopAll();await expect(second).rejects.toThrow(/abort|cancel/i);});
  it('does not grant redirect access through an approved original URL',()=>expect(()=>validateNetworkUrl('https://elsewhere.example',policy)).toThrow(/authorized/));
  it('returns truthful bounded output and keeps HTTP errors as observed status',async()=>{fixture.responses.push({status:404,body:'x'.repeat(20_000)});const result=await new PublicHttpClient().get('https://example.com/missing',policy,new AbortController().signal);const body=JSON.parse(result.content);expect(body.status).toBe(404);expect(body.truncated).toBe(true);expect(body.content.length).toBe(16384);expect(body.receivedBytes).toBe(20_000);expect(result.evidence[0].summary).toContain('404');});
  it('enforces policy and performs a real client request through the broker without workspace access',async()=>{const broker=new ToolBroker('output/http-policy-test',()=>false);const result=await broker.execute({...context,network:policy},{id:'read',name:'http_get',arguments:{url:'https://example.com'}});expect(JSON.parse(result.content).content).toBe('Public documentation');expect(fixture.requests).toHaveLength(1);await broker.stopAll();});
  it('blocks binary output and excessive redirect loops',async()=>{fixture.responses.push({headers:{'content-type':'application/octet-stream'}});await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/text/);fixture.responses=Array.from({length:4},()=>({status:301,headers:{location:'/loop'}}));await expect(new PublicHttpClient().get('https://example.com',policy,new AbortController().signal)).rejects.toThrow(/redirect limit/i);expect(fixture.requests).toHaveLength(5);});
});
