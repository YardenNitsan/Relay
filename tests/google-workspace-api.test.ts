import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {FastifyInstance} from 'fastify';
import {createApp} from '../server/api/app.js';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import {ToolBroker} from '../server/tools/index.js';
import {Engine} from '../server/orchestration/engine.js';
import {LocalPairing} from '../server/auth/pairing.js';
import {GoogleWorkspace,WORKSPACE_SCOPES} from '../server/integrations/google-workspace.js';

let app:FastifyInstance,store:Store,engine:Engine,directory:string,cookie:string,csrf:string,nonce='';
const host='127.0.0.1:4317',origin=`http://${host}`;const upstream:string[]=[];
beforeAll(async()=>{
  directory=await mkdtemp(join(tmpdir(),'relay-workspace-api-'));store=new Store(await openDatabase());await store.init();const vault=new Map<string,string>();
  const googleWorkspace=new GoogleWorkspace(store,{allowedOrigins:async()=>[origin],vault:{get:async key=>vault.get(key)??null,set:async(key,value)=>{vault.set(key,value);},remove:async key=>{vault.delete(key);}},verifyIdentity:async()=>({sub:'fixture-account',nonce}),fetch:async url=>{upstream.push(String(url));return String(url).endsWith('/token')?Response.json({access_token:'private-token',refresh_token:'private-refresh',id_token:'injected-identity',scope:WORKSPACE_SCOPES.join(' '),token_type:'Bearer',expires_in:3600}):String(url).includes('/messages/mail1')?Response.json({id:'mail1',payload:{mimeType:'text/plain',body:{data:Buffer.from('Fixture mail body').toString('base64url')}}}):Response.json({messages:[{id:'mail1'}]});}});
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{},keyring:null})});const broker=new ToolBroker(directory,()=>engine?.isStopped()??true,undefined,store);engine=new Engine(store,providers,broker);const pairing=new LocalPairing(directory);
  app=await createApp({store,providers,broker,engine,pairing,googleWorkspace},{staticRoot:join(directory,'missing')});const issued=await pairing.issue();const session=await app.inject({method:'POST',url:'/api/session/pair',headers:{host,origin},payload:{token:issued.token}});expect(session.statusCode).toBe(200);cookie=String(session.headers['set-cookie']).split(';')[0];csrf=session.json().csrfToken;
},60000);
afterAll(async()=>{await engine?.shutdown();await app?.close();await store?.close();if(directory)await rm(directory,{recursive:true,force:true});});
describe('Google Workspace authenticated API',()=>{
  it('accepts explicit task read scopes and refuses conflicting cloud/network options at admission',async()=>{
    const headers={host,origin,cookie,'x-relay-csrf':csrf},options={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'local_only',googleWorkspace:{mail:true,calendar:false},budget:{maxCalls:2,maxSeconds:60,maxIterations:2,maxCostUsd:0,localOnly:true}};
    const post=(value:unknown)=>app.inject({method:'POST',url:'/api/conversations/start',headers,payload:{requestId:randomUUID(),content:'Read only my mail',options:value}});
    expect((await post({...options,cloudPolicy:'allow',budget:{...options.budget,localOnly:false}})).statusCode).toBe(403);
    expect((await post({...options,network:{mode:'allow',allowedOrigins:['https://example.com']}})).statusCode).toBe(403);
    expect((await post({...options,googleWorkspace:{...options.googleWorkspace,userId:'other'}})).statusCode).toBe(400);
    const response=await post(options);expect(response.statusCode,response.body).toBe(200);expect(response.json().task.options.googleWorkspace).toEqual({mail:true,calendar:false});await engine.cancel(response.json().task.id);
  });
  it('configures and completes OAuth through actual paired Sessions.live without a transaction deadlock',async()=>{
    const headers={host,origin,cookie,'x-relay-csrf':csrf};
    const configured=await app.inject({method:'PUT',url:'/api/admin/google-workspace',headers,payload:{clientId:'222-workspace.apps.googleusercontent.com',clientSecret:'fixture-private-secret',separateProjectAccepted:true}});expect(configured.statusCode,configured.body).toBe(200);expect(configured.body).not.toContain('fixture-private-secret');
    const start=await app.inject({method:'POST',url:'/api/integrations/google-workspace/start',headers,payload:{origin}});expect(start.statusCode,start.body).toBe(200);const url=new URL(start.json().url);nonce=url.searchParams.get('nonce')!;
    const completed=await app.inject({method:'POST',url:'/api/integrations/google-workspace/complete',headers,payload:{state:url.searchParams.get('state'),code:'fixture-code'}});expect(completed.statusCode,completed.body).toBe(200);expect(completed.json().connected).toBe(true);expect(completed.body).not.toMatch(/private-token|private-refresh/);
    const read=await app.inject({method:'POST',url:'/api/integrations/google-workspace/mail/read',headers,payload:{id:'mail1'}});expect(read.statusCode,read.body).toBe(200);expect(read.json().text).toBe('Fixture mail body');
  },15000);
  it('preserves CSRF/origin/account boundaries and fetches nothing from status alone',async()=>{
    const count=upstream.length;const headers={host,origin,cookie,'x-relay-csrf':csrf};expect((await app.inject({url:'/api/integrations/google-workspace',headers})).statusCode).toBe(200);expect(upstream).toHaveLength(count);
    expect((await app.inject({method:'POST',url:'/api/integrations/google-workspace/mail/read',headers:{host,origin,cookie},payload:{id:'mail1'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/integrations/google-workspace/start',headers,payload:{origin:'https://evil.example'}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/integrations/google-workspace/mail/read',headers,payload:{id:'mail1',userId:'someone-else'}})).statusCode).toBe(400);
    expect((await app.inject({url:'/api/integrations/google-workspace',headers:{host}})).statusCode).toBe(401);expect(upstream).toHaveLength(count);
  });
});
