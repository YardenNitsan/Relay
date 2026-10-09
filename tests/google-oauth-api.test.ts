import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {createApp} from '../server/api/app.js';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import {GoogleOAuth,GOOGLE_SCOPES} from '../server/providers/google-oauth.js';
import {ToolBroker} from '../server/tools/index.js';
import {Engine} from '../server/orchestration/engine.js';
import {LocalPairing} from '../server/auth/pairing.js';
import {RemoteIdentity} from '../server/auth/remote.js';
import {chatPermissions} from '../server/auth/policy.js';

const host='127.0.0.1:4317',publicOrigin='https://relay.example';
const configuration={clientId:'123-example.apps.googleusercontent.com',clientSecret:'private-client-secret-fixture',quotaProject:'relay-project',sharedQuotaAccepted:true};
let local:FastifyInstance,remote:FastifyInstance,store:Store,engine:Engine,google:GoogleOAuth,providers:Providers,dir:string;
let ownerHeaders:Record<string,string>,aliceHeaders:Record<string,string>,bobHeaders:Record<string,string>,nonce:string,exchanges:number,tokenRejected:boolean;
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'relay-google-api-'));store=new Store(await openDatabase());await store.init();nonce='';exchanges=0;tokenRejected=false;
  for(const id of ['alice','bob'])await store.db.query('INSERT INTO users(id,name,email,role,permissions) VALUES ($1,$2,$3,$4,$5)',[id,id,`${id}@example.com`,'chat',JSON.stringify({...chatPermissions,providers:['gemini','ollama']})]);
  const secrets=new Map<string,string>();
  google=new GoogleOAuth(store,{allowedOrigins:async()=>[`http://${host}`,publicOrigin],vault:{get:async key=>secrets.get(key)??null,set:async(key,value)=>{secrets.set(key,value);},remove:async key=>{secrets.delete(key);}},verifyIdentity:async()=>({sub:'google-account',nonce}),fetch:async(url)=>{
    if(String(url).endsWith('/revoke'))return new Response('{}');
    exchanges++;if(tokenRejected)return Response.json({error:'invalid_grant'},{status:400});return Response.json({access_token:'private-access-fixture',refresh_token:'private-refresh-fixture',id_token:'private-identity-fixture',expires_in:3600,scope:GOOGLE_SCOPES.join(' '),token_type:'Bearer'});
  }});
  // All credential stores are in-memory fixtures: never access the developer's vault.
  providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{},keyring:null}),userSecrets:userId=>new SecretManager({userId,keyring:null})});providers.setGoogleOAuth(google);
  const broker=new ToolBroker(dir,()=>engine?.isStopped()??false);engine=new Engine(store,providers,broker);
  const pairing=new LocalPairing(dir),config={publicOrigin,issuer:'https://team.cloudflareaccess.com',audience:'aud',port:4318};
  const services={store,providers,broker,engine,pairing,googleOAuth:google,remoteControl:{config,enabled:true,listening:true}};
  const staticRoot=join(dir,'public');await mkdir(staticRoot);await writeFile(join(staticRoot,'index.html'),'<!doctype html><title>Relay fixture shell</title>');
  local=await createApp(services,{staticRoot});
  const identity=new RemoteIdentity(store,config);vi.spyOn(identity,'authenticateContext').mockImplementation(async token=>({userId:token??'alice',expiresAtMs:Date.now()+3600000}));
  remote=await createApp(services,{remote:config,remoteIdentity:identity,staticRoot});
  const paired=await local.inject({method:'POST',url:'/api/session/pair',headers:{host,origin:`http://${host}`},payload:{token:(await pairing.issue()).token}});
  expect(paired.statusCode,paired.body).toBe(200);ownerHeaders={host,origin:`http://${host}`,cookie:paired.headers['set-cookie']!.toString().split(';')[0],'x-relay-csrf':paired.json().csrfToken};
  const login=async(user:string)=>{const base={host:'relay.example',origin:publicOrigin,'cf-access-jwt-assertion':user};const response=await remote.inject({url:'/api/session',headers:base});expect(response.statusCode,response.body).toBe(200);return {...base,cookie:response.headers['set-cookie']!.toString().split(';')[0],'x-relay-csrf':response.json().csrfToken};};
  aliceHeaders=await login('alice');bobHeaders=await login('bob');
});
afterEach(async()=>{await engine.shutdown();await Promise.all([local.close(),remote.close()]);await store.close();await rm(dir,{recursive:true,force:true});});
const configure=()=>local.inject({method:'PUT',url:'/api/admin/google-oauth',headers:ownerHeaders,payload:configuration});
async function start(headers=aliceHeaders){const response=await remote.inject({method:'POST',url:'/api/providers/gemini/google/start',headers,payload:{origin:publicOrigin}});expect(response.statusCode,response.body).toBe(200);const url=new URL(response.json().url);nonce=url.searchParams.get('nonce')!;return {state:url.searchParams.get('state')!,code:'one-use-private-code'};}

describe('Google OAuth integrated session and API boundary',()=>{
  it.each(['GOOGLE_AUTH','GOOGLE_IDENTITY'])('does not invalidate the Relay session when Google returns %s',async code=>{
    await configure();const input=await start();if(code==='GOOGLE_AUTH')tokenRejected=true;else nonce='mismatched-provider-identity';
    const failed=await remote.inject({method:'POST',url:'/api/providers/gemini/google/complete',headers:aliceHeaders,payload:input});
    expect(failed.statusCode,failed.body).toBe(502);expect(failed.json().code).toBe(code);expect(failed.headers['set-cookie']).toBeUndefined();
    expect((await remote.inject({url:'/api/session',headers:aliceHeaders})).statusCode).toBe(200);
    expect((await remote.inject({url:'/api/providers/gemini/google',headers:aliceHeaders})).json().connected).toBe(false);
    // The same authenticated browser can try again without pairing or signing into Relay.
    tokenRejected=false;const retry=await start();expect((await remote.inject({method:'POST',url:'/api/providers/gemini/google/complete',headers:aliceHeaders,payload:retry})).statusCode).toBe(200);
  });
  it('requires a local owner, CSRF and shared-quota consent and never stores the client secret in public records',async()=>{
    expect((await local.inject({url:'/api/admin/google-oauth',headers:{host}})).statusCode).toBe(401);
    expect((await remote.inject({method:'PUT',url:'/api/admin/google-oauth',headers:aliceHeaders,payload:configuration})).statusCode).toBe(403);
    const {['x-relay-csrf']:_csrf,...withoutCsrf}=ownerHeaders;
    expect((await local.inject({method:'PUT',url:'/api/admin/google-oauth',headers:withoutCsrf,payload:configuration})).statusCode).toBe(403);
    expect((await local.inject({method:'PUT',url:'/api/admin/google-oauth',headers:ownerHeaders,payload:{...configuration,sharedQuotaAccepted:false}})).statusCode).toBe(400);
    const saved=await configure();expect(saved.statusCode,saved.body).toBe(200);expect(saved.body).not.toContain(configuration.clientSecret);
    const status=await remote.inject({url:'/api/providers/gemini/google',headers:aliceHeaders});expect(status.statusCode,status.body).toBe(200);expect(status.json()).toMatchObject({configured:true,connected:false});
    const persisted=JSON.stringify(await store.db.query('SELECT * FROM settings'));expect(persisted).not.toContain(configuration.clientSecret);
    expect(JSON.stringify(await store.db.query('SELECT * FROM audit_events'))).not.toContain(configuration.clientSecret);
  });
  it('binds consent to the initiating account, rejects replay and refuses a hidden API-key override',async()=>{
    expect((await configure()).statusCode).toBe(200);const input=await start();
    const complete=(headers:Record<string,string>)=>remote.inject({method:'POST',url:'/api/providers/gemini/google/complete',headers,payload:input});
    expect((await complete(bobHeaders)).statusCode).toBe(400);expect(exchanges).toBe(0);
    const connected=await complete(aliceHeaders);expect(connected.statusCode,connected.body).toBe(200);expect(connected.json().connected).toBe(true);
    expect((await remote.inject({url:'/api/providers/gemini/google',headers:bobHeaders})).json().connected).toBe(false);
    expect((await complete(aliceHeaders)).statusCode).toBe(400);expect(exchanges).toBe(1);
    const key=await remote.inject({method:'POST',url:'/api/providers/gemini/key',headers:aliceHeaders,payload:{key:'new-api-key-fixture',persist:false}});expect(key.statusCode,key.body).toBe(409);expect(key.json().code).toBe('GOOGLE_CONNECTED');
    expect(await (await providers.forUser('alice')).secrets.get('gemini')).toBeNull();
    const persisted=JSON.stringify(await store.db.query('SELECT * FROM settings'))+JSON.stringify(await store.db.query('SELECT * FROM audit_events'))+connected.body;
    for(const secret of ['private-access-fixture','private-refresh-fixture','private-identity-fixture',input.code])expect(persisted).not.toContain(secret);
    expect((await remote.inject({method:'DELETE',url:'/api/providers/gemini/google',headers:aliceHeaders})).statusCode).toBe(200);
    await expect(google.headers('alice')).rejects.toMatchObject({code:'GOOGLE_DISCONNECTED'});
    const explicit=await remote.inject({method:'POST',url:'/api/providers/gemini/key',headers:aliceHeaders,payload:{key:'explicit-api-key-fixture',persist:false}});expect(explicit.statusCode,explicit.body).toBe(200);expect(await google.headers('alice')).toBeNull();
  });
  it('loads only an inert callback shell and requires authenticated same-origin completion',async()=>{
    await configure();const input=await start();
    const navigation={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
    const shell=await remote.inject({url:`/?relay_google=1&code=${input.code}&state=${input.state}`,headers:{host:'relay.example','cf-access-jwt-assertion':'alice',...navigation}});
    expect(shell.statusCode,shell.body).toBe(200);expect(shell.body).toContain('Relay fixture shell');expect(shell.body).not.toContain(input.code);expect(exchanges).toBe(0);
    const localShell=await local.inject({url:'/?relay_google=1&code=inert-code&state=inert-state',headers:{host,...navigation}});expect(localShell.statusCode,localShell.body).toBe(200);
    expect((await local.inject({url:'/api/providers/gemini/google',headers:{...ownerHeaders,...navigation}})).statusCode).toBe(403);
    const {['x-relay-csrf']:_csrf,...withoutCsrf}=aliceHeaders;
    expect((await remote.inject({method:'POST',url:'/api/providers/gemini/google/complete',headers:withoutCsrf,payload:input})).statusCode).toBe(403);
    expect((await remote.inject({method:'POST',url:'/api/providers/gemini/google/start',headers:aliceHeaders,payload:{origin:'https://attacker.example'}})).statusCode).toBe(400);
    await store.db.query('UPDATE users SET enabled=false,session_version=session_version+1 WHERE id=$1',['alice']);
    expect((await remote.inject({method:'POST',url:'/api/providers/gemini/google/complete',headers:aliceHeaders,payload:input})).statusCode).toBe(401);expect(exchanges).toBe(0);
  });
});
