import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
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
import { SecretManager, type CredentialStore } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';
import { chatPermissions } from '../server/auth/policy.js';
import { RemoteIdentity } from '../server/auth/remote.js';
import { LocalPairing } from '../server/auth/pairing.js';
import type { TaskOptions } from '../shared/types.js';
import {pdfFixture,docxFixture} from './helpers/documents.js';

let app:FastifyInstance,store:Store,engine:Engine,broker:ToolBroker,dir:string;
let cookie:string,csrf:string;
let services:Services,remoteControl:RemoteControl;
let personalKeyring:CredentialStore|null;
const controllers:AbortController[]=[];
const extraApps:FastifyInstance[]=[];
const headers={host:'relay.example','cf-access-jwt-assertion':'verified-fixture'};
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'relay-remote-api-'));store=new Store(await openDatabase());await store.init();
  await store.db.query('INSERT INTO users(id,name,email,role,permissions) VALUES ($1,$2,$3,$4,$5)',['friend','Friend','friend@example.com','trusted',JSON.stringify(chatPermissions)]);
  // These API tests must never read or delete the developer's actual OS vault.
  personalKeyring=null;
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{},keyring:null}),userSecrets:userId=>new SecretManager({userId,keyring:personalKeyring})});
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
  it.each(['pdf','docx'] as const)('imports a %s into the user’s private workspace without host privileges or retaining original bytes',async format=>{
    const mutate={headers:{...headers,cookie,'x-relay-csrf':csrf}};
    const created=await app.inject({...mutate,method:'POST',url:'/api/workspaces',payload:{name:'My documents'}});
    expect(created.statusCode).toBe(200);const workspace=created.json();
    const payload={name:`notes.${format}`,contentBase64:(format==='pdf'?pdfFixture('Private uploaded text'):docxFixture('Private uploaded text')).toString('base64')};
    const url=`/api/workspaces/${workspace.id}/documents`;
    expect((await app.inject({method:'POST',url,headers:{...headers,cookie},payload})).statusCode).toBe(403);
    const imported=await app.inject({...mutate,method:'POST',url,payload});
    expect(imported.statusCode,imported.body).toBe(200);expect(imported.json()).toMatchObject({uploaded:true,format,originalStored:false});
    const file=await app.inject({url:`/api/workspaces/${workspace.id}/file?path=${encodeURIComponent(imported.json().path)}`,headers:{...headers,cookie}});
    expect(file.json().content).toContain('Private uploaded text');
    expect(await broker.listFiles(workspace.id)).toEqual([imported.json().path]);
    const owner=await broker.createWorkspace('Owner documents',undefined,'owner');await store.saveWorkspace(owner);
    expect((await app.inject({...mutate,method:'POST',url:`/api/workspaces/${owner.id}/documents`,payload})).statusCode).toBe(403);
  });
  it('owns personal workspaces and manually edits files independently of agent access',async()=>{
    const mutate={headers:{...headers,cookie,'x-relay-csrf':csrf}};
    const created=await app.inject({...mutate,method:'POST',url:'/api/workspaces',payload:{name:'My files'}});
    expect(created.statusCode,created.body).toBe(200);const workspace=created.json();expect(workspace.ownerUserId).toBe('friend');
    const url=`/api/workspaces/${workspace.id}/file`;
    expect((await app.inject({...mutate,method:'POST',url:`/api/workspaces/${workspace.id}/files`,payload:{path:'notes.txt',content:'original'}})).statusCode).toBe(200);
    const read=await app.inject({url:url+'?path=notes.txt',headers:{...headers,cookie}});expect(read.statusCode).toBe(200);
    expect((await app.inject({...mutate,method:'PUT',url,payload:{path:'notes.txt',content:'changed',expectedHash:read.json().sha256}})).statusCode).toBe(200);
    expect((await app.inject({...mutate,method:'PUT',url,payload:{path:'notes.txt',content:'stale',expectedHash:read.json().sha256}})).statusCode).toBe(409);
    expect((await app.inject({...mutate,method:'POST',url:`/api/workspaces/${workspace.id}/files`,payload:{path:'notes.txt',content:'overwrite'}})).statusCode).toBe(409);
    const current=await app.inject({url:url+'?path=notes.txt',headers:{...headers,cookie}});
    expect((await app.inject({...mutate,method:'DELETE',url,payload:{path:'notes.txt',expectedHash:current.json().sha256}})).statusCode).toBe(200);
  });
  it('never imports host files or forges private ownership for a remote user',async()=>{
    const mutate={method:'POST' as const,url:'/api/workspaces',headers:{...headers,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({...mutate,payload:{name:'Import',sourcePath:dir}})).statusCode).toBe(403);
    expect((await app.inject({...mutate,payload:{name:'Forge',ownerUserId:'owner'}})).statusCode).toBe(400);
    const workspace=await broker.createWorkspace('Other private',undefined,'owner');await store.saveWorkspace(workspace);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,workspaceIds:[workspace.id],maxAccess:'workspace'}),'friend']);
    expect((await app.inject({url:'/api/workspaces',headers:{...headers,cookie}})).json()).toEqual([]);
    expect((await app.inject({url:`/api/workspaces/${workspace.id}/files`,headers:{...headers,cookie}})).statusCode).toBe(403);
  });
  it('serializes personal creation quotas and rejects revoked sessions',async()=>{
    const request={method:'POST' as const,url:'/api/workspaces',headers:{...headers,cookie,'x-relay-csrf':csrf},payload:{name:'Personal'}};
    const responses=await Promise.all(Array.from({length:10},()=>app.inject(request)));
    expect(responses.filter(response=>response.statusCode===200)).toHaveLength(8);
    expect(responses.filter(response=>response.statusCode===429)).toHaveLength(2);
    await store.db.query("UPDATE users SET enabled=false WHERE id='friend'");
    expect((await app.inject(request)).statusCode).toBe(401);
  });
  it('rechecks a queued private creation after account revocation',async()=>{
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const blocking=broker.createWorkspace('Owner queue operation',undefined,undefined,async()=>{entered();await gate;});await started;
    const pending=app.inject({method:'POST',url:'/api/workspaces',headers:{...headers,cookie,'x-relay-csrf':csrf},payload:{name:'Must not create'}}).then(response=>response);
    await new Promise(resolve=>setTimeout(resolve,20));
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");release();await blocking;
    expect((await pending).statusCode).toBe(401);
    expect((await broker.listWorkspaces()).filter(workspace=>workspace.ownerUserId==='friend')).toEqual([]);
  });
  it('keeps usage private to the authenticated account and denies revoked sessions',async()=>{
    for(const [id,user,tokens]of [['friend-usage','friend',20],['owner-usage','owner',999]] as const)await store.db.query('INSERT INTO inference_requests(id,user_id,token_id,model_id,status,input_tokens,output_tokens) VALUES ($1,$2,$3,$4,$5,$6,$7)',[id,user,'fixture','ollama/local','completed',tokens,5]);
    const response=await app.inject({url:'/api/usage?userId=owner',headers:{...headers,cookie}});
    expect(response.statusCode).toBe(200);expect(response.json().models).toEqual([expect.objectContaining({modelId:'ollama/local',inputTokens:20,outputTokens:5,requests:1})]);
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='friend'");
    expect((await app.inject({url:'/api/usage',headers:{...headers,cookie}})).statusCode).toBe(401);
  });
  it('serializes credential changes across a delayed save so a completed disconnect cannot be resurrected',async()=>{
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,providers:['openai']}),'friend']);
    const gateway=await services.providers.forUser('friend');
    let release!:()=>void,started!:()=>void;const hold=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});
    const save=gateway.secrets.set.bind(gateway.secrets);
    vi.spyOn(gateway.secrets,'set').mockImplementation(async(...args)=>{started();await hold;return save(...args);});
    const request={url:'/api/providers/openai/key',headers:{...headers,cookie,'x-relay-csrf':csrf}};
    const connecting=app.inject({...request,method:'POST',payload:{key:'delayed-personal-key',persist:false}});await entered;
    let disconnected=false;const disconnecting=app.inject({...request,method:'DELETE'}).then(result=>{disconnected=true;return result;});
    await new Promise(resolve=>setTimeout(resolve,20));expect(disconnected).toBe(false);
    release();expect((await connecting).statusCode).toBe(200);const disconnectedResponse=await disconnecting;expect(disconnectedResponse.statusCode,disconnectedResponse.body).toBe(200);
    expect(await gateway.secrets.get('openai')).toBeNull();
    expect((await gateway.statuses()).find(item=>item.id==='openai')?.configured).toBe(false);
    expect((await app.inject({...request,method:'POST',payload:{key:'new-personal-key',persist:false}})).statusCode).toBe(200);
  });
  it('reports unavailable vault deletion instead of claiming persistent credentials were removed',async()=>{
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,providers:['openai']}),'friend']);
    const read=vi.fn(()=>{throw new Error('Desktop Secret Service is unavailable');});
    personalKeyring={entry:()=>({getPassword:read,setPassword:()=>{throw new Error('Persistent writes are unavailable');},deletePassword:()=>{throw new Error('Persistent deletion is unavailable');}})};
    const gateway=await services.providers.forUser('friend');await gateway.secrets.set('openai','session-test-credential',false);
    const response=await app.inject({method:'DELETE',url:'/api/providers/openai/key',headers:{...headers,cookie,'x-relay-csrf':csrf}});
    expect(response.statusCode,response.body).toBe(500);
    expect(response.json()).toMatchObject({code:'OPERATION_FAILED',error:'Credential disabled for this session; OS keyring removal could not be confirmed'});
    expect(read).toHaveBeenCalledOnce();expect(await gateway.secrets.get('openai')).toBeNull();
    expect(await store.db.query("SELECT id FROM audit_events WHERE operation='PROVIDER_DISCONNECTED'")).toEqual([]);
    expect(response.body).not.toContain('session-test-credential');
  });
  it('shows a signed pending identity the inert sign-in screen without admitting a session or API request',async()=>{
    const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='pending-test';
    const config={...remoteControl.config!,registration:'approval' as const};
    const identity=new RemoteIdentity(store,config,createLocalJWKSet({keys:[jwk]}));
    const staticRoot=join(dir,'public');await mkdir(staticRoot);await writeFile(join(staticRoot,'index.html'),'<!doctype html><title>Relay access</title>');
    const pendingApp=await createApp(services,{remote:config,remoteIdentity:identity,staticRoot});extraApps.push(pendingApp);
    const token=await new SignJWT({email:'pending@example.com',type:'app'}).setProtectedHeader({alg:'RS256',kid:'pending-test'}).setSubject('pending-sub').setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const signed={...headers,'cf-access-jwt-assertion':token};
    const shell=await pendingApp.inject({url:'/',headers:{...signed,'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}});
    expect(shell.statusCode).toBe(200);expect(shell.body).toContain('Relay access');expect(shell.headers['set-cookie']).toBeUndefined();
    for(const url of ['/api/session','/api/models','/api/conversations'])expect((await pendingApp.inject({url,headers:signed})).json().code).toBe('REMOTE_PENDING');
    expect(await store.db.query("SELECT id FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='pending@example.com')")).toEqual([]);
    expect((await pendingApp.inject({url:'/',headers:{...signed,'cf-access-jwt-assertion':'forged'}})).statusCode).toBe(401);
  });
  it('signs out only the current remote browser and requires CSRF',async()=>{
    const request={method:'POST' as const,url:'/api/session/logout',headers:{...headers,cookie}};
    expect((await app.inject(request)).statusCode).toBe(403);
    const result=await app.inject({...request,headers:{...request.headers,'x-relay-csrf':csrf}});
    expect(result.statusCode).toBe(200);expect(result.headers['set-cookie']).toContain('Expires=Thu, 01 Jan 1970');
    expect((await app.inject({url:'/api/conversations',headers:{...headers,cookie}})).statusCode).toBe(401);
  });
  it.each(['openai','xai','deepseek'] as const)('manages only the signed-in user %s credentials and never the owner or local runtime',async provider=>{
    await services.providers.secrets.set(provider,'owner-private-key',false);
    const mutate={method:'POST' as const,headers:{...headers,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({...mutate,url:`/api/providers/${provider}/key`,payload:{key:'friend-private-key',persist:false}})).statusCode).toBe(403);
    await store.db.query('UPDATE users SET permissions=$1 WHERE id=$2',[JSON.stringify({...chatPermissions,providers:['ollama',provider]}),'friend']);
    const scoped=await services.providers.forUser('friend');
    expect((await app.inject({url:'/api/models',headers:{...headers,cookie}})).json().providers.find((p:{id:string})=>p.id===provider).configured).toBe(false);
    expect((await app.inject({...mutate,url:`/api/providers/${provider}/key`,payload:{key:'friend-private-key',persist:false,userId:'owner'}})).statusCode).toBe(400);
    expect((await app.inject({...mutate,url:`/api/providers/${provider}/key`,payload:{key:'friend-private-key',persist:false}})).statusCode).toBe(200);
    expect(await scoped.secrets.get(provider)).toBe('friend-private-key');
    expect(await services.providers.secrets.get(provider)).toBe('owner-private-key');
    expect((await app.inject({...mutate,url:'/api/providers/ollama/enabled',payload:{enabled:false}})).statusCode).toBe(403);
    expect((await app.inject({...mutate,url:`/api/providers/${provider}/enabled`,payload:{enabled:false}})).statusCode).toBe(200);
    expect(await store.db.query('SELECT user_id,provider,enabled FROM user_provider_connections')).toEqual([{user_id:'friend',provider,enabled:false}]);
    const response=await app.inject({method:'DELETE',url:`/api/providers/${provider}/key`,headers:mutate.headers});expect(response.statusCode,response.body).toBe(200);
    expect(await scoped.secrets.get(provider)).toBeNull();expect(await services.providers.secrets.get(provider)).toBe('owner-private-key');
    const audit=JSON.stringify(await store.db.query('SELECT * FROM audit_events'));
    expect(audit).toContain('friend');expect(audit).not.toContain('private-key');
  });
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
