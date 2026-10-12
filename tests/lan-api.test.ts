import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { createApp, type Services } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';
import { chatPermissions } from '../server/auth/policy.js';
import { LocalPairing } from '../server/auth/pairing.js';
import { LanInvitations } from '../server/auth/lan.js';
import { Sessions } from '../server/auth/sessions.js';
import type {TaskOptions} from '../shared/types';

let app:FastifyInstance,store:Store,engine:Engine,directory:string,services:Services;
let invitations:LanInvitations;
const origin='https://relay.test:4319',host='relay.test:4319';
const controllers:AbortController[]=[];
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-lan-api-'));
  store=new Store(await openDatabase());await store.init();
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',['friend','chat',JSON.stringify(chatPermissions)]);
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{}})});
  const broker=new ToolBroker(directory,()=>engine?.isStopped()??false);engine=new Engine(store,providers,broker);
  services={store,providers,broker,engine,pairing:new LocalPairing(directory),remoteControl:{config:null,enabled:false,listening:false}};
  invitations=new LanInvitations(store);
  // API boundary tests intentionally inject requests; certificate loading and real
  // HTTPS transport have separate tests. No client trust store is changed here.
  app=await createApp(services,{lan:{origin,host:'192.168.1.40',port:4319,certFile:'test-only-cert',keyFile:'test-only-key'},staticRoot:join(directory,'missing')});
});
afterEach(async()=>{
  controllers.splice(0).forEach(controller=>controller.abort());vi.restoreAllMocks();
  await engine.shutdown();await app.close();await store.close();await rm(directory,{recursive:true,force:true});
});
async function pair(token?:string) {
  return app.inject({method:'POST',url:'/api/session/pair',headers:{host,origin},payload:{token:token??(await invitations.issue('friend')).token}});
}
async function signedIn() {
  const response=await pair();expect(response.statusCode).toBe(200);
  return {host,origin,cookie:response.headers['set-cookie']!.toString().split(';')[0],'x-relay-csrf':response.json().csrfToken as string};
}
async function readActivity(url:string,headers:Record<string,string>,marker:string){
  const controller=new AbortController();controllers.push(controller);
  const response=await new Promise<Response>((resolve,reject)=>{const request=httpRequest(url,{headers,signal:controller.signal},incoming=>resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>,{status:incoming.statusCode})));request.once('error',reject);request.end();});
  expect(response.status).toBe(200);const reader=response.body!.getReader(),decoder=new TextDecoder();let text='';const timer=setTimeout(()=>controller.abort(),1500);
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;text+=decoder.decode(chunk.value,{stream:true});if(text.includes(marker))break;}}catch(error){if(!controller.signal.aborted)throw error;}
  finally{clearTimeout(timer);controller.abort();await reader.cancel().catch(()=>{});}
  return text;
}
describe('authenticated LAN API boundary',()=>{
  it('resets stale activity cursors and binds continuation to the authenticated browser session',async()=>{
    const headers=await signedIn(),url=await app.listen({host:'127.0.0.1',port:0});
    const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:4096,budget:{maxCalls:2,maxSeconds:60,maxIterations:2,maxCostUsd:0,localOnly:true}};
    const own=await store.createConversation('Private owner'),friend=await store.createConversation('Friend','friend');
    const ownerTask=(await store.createTask(own.id,'Owner',options)).task,friendTask=(await store.createTask(friend.id,'Friend',options,'friend')).task;
    await store.append(ownerTask.id,'PRIVATE_MARKER',{text:'private owner fixture'});const first=await store.append(friendTask.id,'PUBLIC_MARKER',{text:'first friend fixture'});
    const reset=await readActivity(`${url}/api/events?after=9000000&scope=${'0'.repeat(64)}`,headers,'first friend fixture');
    expect(reset).toContain('event: replay');expect(reset).toContain('first friend fixture');expect(reset).not.toContain('private owner fixture');
    const control=JSON.parse(reset.match(/event: replay\ndata: ([^\n]+)/)![1]) as {scope:string;after:number};expect(control.after).toBe(0);expect(control.scope).toMatch(/^[a-f0-9]{64}$/);
    await store.append(friendTask.id,'PUBLIC_MARKER',{text:'second friend fixture'});
    const resumed=await readActivity(`${url}/api/events?after=${first.id}&scope=${control.scope}`,headers,'second friend fixture');
    expect(resumed).toContain(`"after":${first.id}`);expect(resumed).not.toContain('first friend fixture');expect(resumed).toContain('second friend fixture');
    const newer=await signedIn();
    const changed=await readActivity(`${url}/api/events?after=9000000&scope=${control.scope}`,newer,'first friend fixture');
    expect(changed).toContain('"after":0');expect(changed).toContain('first friend fixture');expect(changed).not.toContain(`"scope":"${control.scope}"`);
  });
  it('requires LAN authentication and exact origin, and cannot consume the owner pairing code',async()=>{
    const session=await app.inject({url:'/api/session',headers:{host}});
    expect(session.statusCode).toBe(401);expect(session.json().code).toBe('LAN_PAIRING_REQUIRED');expect(session.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({url:'/api/conversations',headers:{host}})).statusCode).toBe(401);
    const token=(await invitations.issue('friend')).token;
    for(const headers of [{host},{host,origin:'https://evil.test'},{host:'evil.test',origin}])expect((await app.inject({method:'POST',url:'/api/session/pair',headers,payload:{token}})).statusCode).toBe(403);
    expect((await pair(token)).statusCode).toBe(200);
    const ownerCode=await services.pairing!.issue();expect((await pair(ownerCode.token)).statusCode).toBe(401);
    await expect(services.pairing!.redeem(ownerCode.token)).resolves.toBeUndefined();
    expect(await store.db.query("SELECT id FROM sessions WHERE user_id='owner'")).toEqual([]);
  });
  it('binds a one-use invitation to its account and emits a secure session without accepting a user override',async()=>{
    const invitation=await invitations.issue('friend');
    const forged=await app.inject({method:'POST',url:'/api/session/pair',headers:{host,origin},payload:{token:invitation.token,userId:'owner'}});expect(forged.statusCode).toBe(400);
    const response=await pair(invitation.token);expect(response.statusCode).toBe(200);expect(response.json()).toMatchObject({user:{id:'friend',role:'chat'},remote:true,connection:'lan'});
    expect(response.headers['set-cookie']).toContain('__Host-relay_remote=');expect(response.headers['set-cookie']).toContain('Secure');expect(response.headers['set-cookie']).toContain('HttpOnly');expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect((await pair(invitation.token)).statusCode).toBe(401);
    const cookie=response.headers['set-cookie']!.toString().split(';')[0];const reopened=await app.inject({url:'/api/session',headers:{host,cookie}});
    expect(reopened.statusCode).toBe(200);expect(reopened.json().user.id).toBe('friend');expect(reopened.headers['set-cookie']).toBeUndefined();
    expect(await store.db.query("SELECT id FROM sessions WHERE user_id='friend'")).toHaveLength(1);
    expect(JSON.stringify(await store.db.query('SELECT metadata FROM audit_events'))).not.toContain(invitation.token);
  });
  it('enforces CSRF and keeps guessed owner conversations private',async()=>{
    const headers=await signedIn();const ownerConversation=await store.createConversation('Owner private conversation');
    const create={method:'POST' as const,url:'/api/conversations',payload:{title:'Friend conversation'}};
    expect((await app.inject({...create,headers:{host,origin,cookie:headers.cookie}})).statusCode).toBe(403);
    expect((await app.inject({...create,headers:{...headers,'x-relay-csrf':'wrong'}})).statusCode).toBe(403);
    const created=await app.inject({...create,headers});expect(created.statusCode).toBe(200);
    const listed=await app.inject({url:'/api/conversations',headers});expect(listed.json()).toHaveLength(1);expect(listed.json()[0].id).toBe(created.json().id);
    expect((await app.inject({url:`/api/conversations/${ownerConversation.id}`,headers})).statusCode).toBe(404);
    expect((await app.inject({method:'DELETE',url:`/api/conversations/${ownerConversation.id}`,headers})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:'/api/session/logout',headers})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/conversations',headers})).statusCode).toBe(401);
  });
  it('denies owner administration, invitation issuance and global control, then honors account disablement',async()=>{
    const headers=await signedIn();
    for(const url of ['/api/admin/users','/api/admin/lan'])expect((await app.inject({url,headers})).statusCode).toBe(403);
    for(const url of ['/api/admin/users/friend/lan-invitation','/api/stop','/api/resume'])expect((await app.inject({method:'POST',url,headers,payload:{}})).statusCode).toBe(403);
    await store.db.query("UPDATE users SET enabled=false,session_version=session_version+1 WHERE id='friend'");
    expect((await app.inject({url:'/api/conversations',headers})).statusCode).toBe(401);
    const session=await app.inject({url:'/api/session',headers});expect(session.statusCode).toBe(401);expect(session.headers['set-cookie']).toBeUndefined();
  });
  it('does not renew a LAN session revoked between principal lookup and session admission',async()=>{
    const headers=await signedIn();const original=Sessions.prototype.principal;
    vi.spyOn(Sessions.prototype,'principal').mockImplementationOnce(async function(this:Sessions,...args:Parameters<Sessions['principal']>){
      const principal=await original.apply(this,args);
      await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");return principal;
    });
    const response=await app.inject({url:'/api/session',headers});expect(response.statusCode).toBe(401);expect(response.json().code).toBe('SESSION_REVOKED');expect(response.headers['set-cookie']).toBeUndefined();
    expect(await store.db.query("SELECT id FROM sessions WHERE user_id='friend' AND version=1")).toEqual([]);
  });
  it('streams LAN activity without a Cloudflare identity or enabled public gateway and closes on revocation',async()=>{
    const headers=await signedIn();const url=await app.listen({host:'127.0.0.1',port:0});const controller=new AbortController();controllers.push(controller);
    const response=await new Promise<Response>((resolve,reject)=>{
      const request=httpRequest(`${url}/api/events`,{headers,signal:controller.signal},incoming=>resolve(new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>,{status:incoming.statusCode})));request.once('error',reject);request.end();
    });
    expect(response.status,response.status===200?'':await response.clone().text()).toBe(200);
    let ended=false;const body=response.text().then(value=>{ended=true;return value;});
    await new Promise(resolve=>setTimeout(resolve,500));expect(ended).toBe(false);
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    const result=await Promise.race([body,new Promise<null>(resolve=>setTimeout(()=>resolve(null),1500))]);expect(result).toContain('retry: 1500');
  });
});
