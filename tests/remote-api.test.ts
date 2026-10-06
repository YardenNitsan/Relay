import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { createApp, type Services, type RemoteControl } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';
import { chatPermissions } from '../server/auth/policy.js';
import { RemoteIdentity } from '../server/auth/remote.js';
import { LocalPairing } from '../server/auth/pairing.js';
import type { TaskOptions } from '../shared/types.js';

let app:FastifyInstance,store:Store,engine:Engine,broker:ToolBroker,dir:string;
let cookie:string,csrf:string;
let services:Services,remoteControl:RemoteControl;
const controllers:AbortController[]=[];
const extraApps:FastifyInstance[]=[];
const headers={host:'relay.example','cf-access-jwt-assertion':'verified-fixture'};
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'relay-remote-api-'));store=new Store(await openDatabase());await store.init();
  await store.db.query('INSERT INTO users(id,name,email,role,permissions) VALUES ($1,$2,$3,$4,$5)',['friend','Friend','friend@example.com','trusted',JSON.stringify(chatPermissions)]);
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{}})});
  broker=new ToolBroker(dir,()=>engine?.isStopped()??false);engine=new Engine(store,providers,broker);
  const remote={publicOrigin:'https://relay.example',issuer:'https://team.cloudflareaccess.com',audience:'aud',port:4318};
  const identity=new RemoteIdentity(store,remote);vi.spyOn(identity,'authenticateContext').mockImplementation(async token=>{if(!token?.startsWith('verified-fixture'))throw new Error('Authentication required');return {userId:token.split(':')[1]??'friend',expiresAtMs:Date.now()+3600000};});
  remoteControl={config:remote,enabled:true,listening:true};services={store,providers,broker,engine,remoteControl,pairing:new LocalPairing(dir)};
  app=await createApp(services,{remote,remoteIdentity:identity,staticRoot:join(dir,'missing')});
  const session=await app.inject({url:'/api/session',headers});cookie=session.headers['set-cookie']!.toString().split(';')[0];csrf=session.json().csrfToken;
  expect(session.headers['set-cookie']).toContain('Secure');expect(session.headers['set-cookie']).toContain('HttpOnly');
});
afterEach(async()=>{for(const controller of controllers.splice(0))controller.abort();await engine.shutdown();await Promise.all(extraApps.splice(0).map(extra=>extra.close()));await app.close();await store.close();await rm(dir,{recursive:true,force:true});});
async function openEvents(url:string,sessionCookie=cookie,identity='verified-fixture') {
  const controller=new AbortController();controllers.push(controller);
  const response=await new Promise<Response>((resolve,reject)=>{
    const request=httpRequest(`${url}/api/events`,{headers:{...headers,cookie:sessionCookie,'cf-access-jwt-assertion':identity},signal:controller.signal},response=>resolve(new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>,{status:response.statusCode})));
    request.on('error',reject);request.end();
  });
  return {response,controller};
}
describe('remote API isolation',()=>{
  it('cannot redeem a local owner code at the remote gateway',async()=>{
    const issued=await services.pairing!.issue();
    const response=await app.inject({method:'POST',url:'/api/session/pair',headers:{...headers,cookie,origin:'https://relay.example'},payload:{token:issued.token}});
    expect(response.statusCode).toBe(403);await services.pairing!.redeem(issued.token);
  });
  it('a remote identity never bootstraps owner authority or guesses private conversation IDs',async()=>{
    const privateConversation=await store.createConversation('Owner private');
    expect((await app.inject({url:`/api/conversations/${privateConversation.id}`,headers:{...headers,cookie}})).statusCode).toBe(404);
    expect((await app.inject({url:'/api/admin/users',headers:{...headers,cookie}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/stop',headers:{...headers,cookie,'x-relay-csrf':csrf}})).statusCode).toBe(403);
    const session=await app.inject({url:'/api/session',headers:{...headers,cookie}});expect(session.json().user.id).toBe('friend');
  });
  it('does not allow remote users to inspect resident allocation or relax host resource policy',async()=>{
    for(const url of ['/api/hardware/policy','/api/models/resident'])expect((await app.inject({url,headers:{...headers,cookie}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/hardware/policy',headers:{...headers,cookie,'x-relay-csrf':csrf},payload:{profile:'performance'}})).statusCode).toBe(403);
    expect(await store.db.query('SELECT value FROM settings WHERE key=$1',['resource_policy'])).toEqual([]);
  });
  it('current workspace and write grants are rechecked before reverting an old checkpoint',async()=>{
    const workspace=await broker.createWorkspace('Previously granted');const c=await store.createConversation('Friend work','friend');
    const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:workspace.id,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,workspaceIds:[workspace.id],maxAccess:'workspace'}),'friend']);
    const {task}=await store.createTask(c.id,'Write once',options,'friend');await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[task.id]);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify(chatPermissions),'friend']);
    const revert=vi.spyOn(broker,'revert');
    const request={method:'POST' as const,url:`/api/tasks/${task.id}/revert`,headers:{...headers,cookie,'x-relay-csrf':csrf},payload:{checkpointId:'11111111-1111-4111-8111-111111111111'}};
    expect((await app.inject(request)).statusCode).toBe(403);expect(revert).not.toHaveBeenCalled();
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,workspaceIds:[workspace.id],maxAccess:'read_only'}),'friend']);
    expect((await app.inject(request)).statusCode).toBe(403);expect(revert).not.toHaveBeenCalled();
  });
  it('revocation invalidates an existing remote session immediately',async()=>{
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    expect((await app.inject({url:'/api/conversations',headers:{...headers,cookie}})).statusCode).toBe(401);
  });
  it('enforces active user quotas atomically across conversations',async()=>{
    const a=await store.createConversation('A','friend');const b=await store.createConversation('B','friend');
    const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    const results=await Promise.allSettled([store.createTask(a.id,'A',options,'friend'),store.createTask(b.id,'B',options,'friend')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  });
  it('reports the shared remote control state through the local owner gateway',async()=>{
    const local=await createApp(services,{staticRoot:join(dir,'missing')});extraApps.push(local);
    const localHeaders={host:'127.0.0.1:4317'};
    const issued=await services.pairing!.issue();const session=await local.inject({method:'POST',url:'/api/session/pair',headers:{...localHeaders,origin:'http://127.0.0.1:4317'},payload:{token:issued.token}});const localCookie=session.headers['set-cookie']!.toString().split(';')[0];
    const status=()=>local.inject({url:'/api/status',headers:{...localHeaders,cookie:localCookie}});
    expect((await status()).json().remoteEnabled).toBe(true);
    expect((await local.inject({url:'/api/admin/remote',headers:{host:'127.0.0.1:4317',cookie:localCookie}})).json()).toMatchObject({enabled:true,configured:true,listening:true});
    remoteControl.enabled=false;expect((await status()).json().remoteEnabled).toBe(false);
    remoteControl.enabled=true;remoteControl.listening=false;expect((await status()).json().remoteEnabled).toBe(false);
  });
  it('limits streams per user and returns capacity when a client disconnects',async()=>{
    const url=await app.listen({host:'127.0.0.1',port:0});
    const streams=await Promise.all(Array.from({length:4},()=>openEvents(url)));
    for(const stream of streams)expect(stream.response.status,stream.response.status===200?'':await stream.response.clone().text()).toBe(200);
    const blocked=await openEvents(url);expect(blocked.response.status).toBe(429);
    expect((await blocked.response.json() as {code:string}).code).toBe('EVENT_STREAM_LIMIT');
    streams[0].controller.abort();
    let resumed:Awaited<ReturnType<typeof openEvents>>|undefined;
    for(let attempt=0;attempt<20;attempt++){
      await new Promise(resolve=>setTimeout(resolve,20));resumed=await openEvents(url);
      if(resumed.response.status===200)break;
      await resumed.response.text();
    }
    expect(resumed?.response.status).toBe(200);
  });
  it('limits all concurrent streams across user accounts',async()=>{
    const url=await app.listen({host:'127.0.0.1',port:0});
    for(let index=0;index<8;index++) {
      const id=`stream-user-${index}`;const identity=`verified-fixture:${id}`;
      await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)',[id,'chat',JSON.stringify(chatPermissions)]);
      const session=await app.inject({url:'/api/session',headers:{...headers,'cf-access-jwt-assertion':identity}});const sessionCookie=session.headers['set-cookie']!.toString().split(';')[0];
      const streams=await Promise.all(Array.from({length:4},()=>openEvents(url,sessionCookie,identity)));
      expect(streams.every(stream=>stream.response.status===200)).toBe(true);
    }
    const blocked=await openEvents(url);expect(blocked.response.status).toBe(429);expect((await blocked.response.json() as {code:string}).code).toBe('EVENT_STREAM_LIMIT');
  });
  it('closes an existing stream when remote access is disabled',async()=>{
    const url=await app.listen({host:'127.0.0.1',port:0});const stream=await openEvents(url);
    expect(stream.response.status,stream.response.status===200?'':await stream.response.clone().text()).toBe(200);remoteControl.enabled=false;
    const result=await Promise.race([stream.response.text().then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1200))]);
    expect(result).toBe(true);
  });
  it('shares stream capacity between gateway instances using the same store',async()=>{
    const identity=new RemoteIdentity(store,remoteControl.config!);vi.spyOn(identity,'authenticateContext').mockResolvedValue({userId:'friend',expiresAtMs:Date.now()+3600000});
    const second=await createApp(services,{remote:remoteControl.config!,remoteIdentity:identity,staticRoot:join(dir,'missing')});extraApps.push(second);
    const firstUrl=await app.listen({host:'127.0.0.1',port:0});const secondUrl=await second.listen({host:'127.0.0.1',port:0});
    await Promise.all(Array.from({length:4},()=>openEvents(firstUrl)));
    const blocked=await openEvents(secondUrl);expect(blocked.response.status).toBe(429);await blocked.response.text();
  });
  it('closes active event streams during gateway shutdown',async()=>{
    const url=await app.listen({host:'127.0.0.1',port:0});const stream=await openEvents(url);expect(stream.response.status).toBe(200);
    const body=stream.response.text();await app.close();expect(await body).toContain('retry: 1500');
  });
  it('keeps an admitted SSE connection open beyond the ordinary socket timeout',async()=>{
    app.server.setTimeout(100);
    const url=await app.listen({host:'127.0.0.1',port:0});const stream=await openEvents(url);expect(stream.response.status).toBe(200);
    const ended=stream.response.text().then(()=>true,()=>true);
    expect(await Promise.race([ended,new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),300))])).toBe(false);
    expect(app.server.timeout).toBe(100);
  });
  it('ends a remote stream at the signed JWT expiry while the host session remains valid',async()=>{
    const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='expiry-test';
    const config=remoteControl.config!;const identity=new RemoteIdentity(store,config,createLocalJWKSet({keys:[jwk]}));
    const verified=await createApp(services,{remote:config,remoteIdentity:identity,staticRoot:join(dir,'missing')});extraApps.push(verified);
    const expiresAt=Math.floor(Date.now()/1000)+2;
    const token=await new SignJWT({email:'friend@example.com',type:'app'}).setProtectedHeader({alg:'RS256',kid:'expiry-test'}).setSubject('verified-friend').setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime(expiresAt).sign(privateKey);
    const session=await verified.inject({url:'/api/session',headers:{...headers,'cf-access-jwt-assertion':token}});expect(session.statusCode).toBe(200);
    const sessionCookie=session.headers['set-cookie']!.toString().split(';')[0];
    const url=await verified.listen({host:'127.0.0.1',port:0});const stream=await openEvents(url,sessionCookie,token);expect(stream.response.status).toBe(200);
    const ended=await Promise.race([stream.response.text().then(()=>true),new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),2500))]);
    expect(ended).toBe(true);expect(Date.now()).toBeGreaterThanOrEqual(expiresAt*1000-10);
    expect((await store.db.query("SELECT id FROM sessions WHERE user_id='friend' AND expires_at>now()"))).not.toHaveLength(0);
    const expired=await openEvents(url,sessionCookie,token);expect(expired.response.status).toBe(401);await expired.response.text();
  });
});
