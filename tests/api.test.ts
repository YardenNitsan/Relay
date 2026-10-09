import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { Engine } from '../server/orchestration/engine.js';
import { LocalPairing } from '../server/auth/pairing.js';
import type { TaskOptions } from '../shared/types.js';
import { catalogTool } from '../server/mcp/schema.js';

let app:FastifyInstance,store:Store,engine:Engine,dir:string,pairing:LocalPairing;
const host='127.0.0.1:4317';let cookie:string,csrf:string;
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'relay-api-'));store=new Store(await openDatabase());await store.init();
  const providers=new Providers({fetch:async()=>new Response('{}',{status:503}),secrets:new SecretManager({env:{}})});
  const broker=new ToolBroker(dir,()=>engine?.isStopped()??false);engine=new Engine(store,providers,broker);
  pairing=new LocalPairing(dir);app=await createApp({store,providers,broker,engine,pairing},{staticRoot:join(dir,'missing')});
  const issued=await pairing.issue();const session=await app.inject({method:'POST',url:'/api/session/pair',headers:{host,origin:`http://${host}`},payload:{token:issued.token}});cookie=session.headers['set-cookie']!.toString().split(';')[0];csrf=session.json().csrfToken;
});
afterEach(async()=>{await engine.shutdown();await app.close();await store.close();await rm(dir,{recursive:true,force:true});});
describe('local HTTP boundary',()=>{
  it('creates an explicitly personal local-owner workspace without converting host imports into private folders',async()=>{
    const request={method:'POST' as const,url:'/api/workspaces',headers:{host,cookie,'x-relay-csrf':csrf}};
    const personal=await app.inject({...request,payload:{name:'My uploaded files',personal:true}});
    expect(personal.statusCode,personal.body).toBe(200);expect(personal.json().ownerUserId).toBe('owner');
    const shared=await app.inject({...request,payload:{name:'Host workspace'}});
    expect(shared.statusCode).toBe(200);expect(shared.json().ownerUserId??null).toBeNull();
    expect((await app.inject({...request,payload:{name:'Invalid import',personal:true,sourcePath:dir}})).statusCode).toBe(403);
  });
  it('requires authenticated CSRF-protected deletion and hides deleted conversations',async()=>{
    const conversation=await store.createConversation('Remove this conversation');
    const url=`/api/conversations/${conversation.id}`;
    expect((await app.inject({method:'DELETE',url,headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({method:'DELETE',url,headers:{host,cookie}})).statusCode).toBe(403);
    expect((await app.inject({method:'DELETE',url,headers:{host,cookie,'x-relay-csrf':csrf}})).json()).toEqual({deleted:true});
    expect((await app.inject({url,headers:{host,cookie}})).statusCode).toBe(404);
  });
  it('saves remote deployment identifiers only for the owner and requires gateway restart',async()=>{
    const payload={publicOrigin:'https://relay.example',issuer:'https://team.cloudflareaccess.com',audience:'application-id',registration:'approval'};
    const request={method:'POST' as const,url:'/api/admin/remote/config',payload,headers:{host,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({...request,headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({...request,payload:{...payload,publicOrigin:'http://relay.example'}})).statusCode).toBe(400);
    expect((await app.inject(request)).json()).toMatchObject({enabled:false,restartRequired:true,savedConfig:{...payload,port:4318}});
    expect((await store.db.query('SELECT value FROM settings WHERE key=$1',['remote_enabled']))[0].value).toBe(false);
  });
  it('starts a conversation atomically and makes repeated first-message requests idempotent',async()=>{
    vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
    const options={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'local_only',budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    const request={method:'POST' as const,url:'/api/conversations/start',headers:{host,cookie,'x-relay-csrf':csrf},payload:{requestId:'eb6e5bb4-e4f6-4549-9209-b0d12eb9830c',content:'Hello once',options}};
    const first=await app.inject(request),second=await app.inject(request);
    expect(first.statusCode).toBe(200);expect(second.statusCode).toBe(200);
    expect(first.json().task.id).toBe(second.json().task.id);
    expect(await store.conversations()).toHaveLength(1);
    await store.setStopped(true);
    expect((await app.inject({...request,payload:{...request.payload,requestId:'b8c972ee-cadf-48b6-863b-45690956c55c'}})).statusCode).toBe(409);
    expect(await store.conversations()).toHaveLength(1);
  });
  it('persists owner-pinned external tools, rejects fingerprint tampering and keeps disabled servers out of task discovery',async()=>{
    const tool=catalogTool({name:'public_lookup',description:'Untrusted fixture catalog',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}});
    const server={id:'public-docs',name:'Fixture documents',url:'https://example.com/mcp',enabled:false,tools:[tool]};
    const request={method:'PUT' as const,url:'/api/mcp/servers',headers:{host,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({url:'/api/mcp/servers',headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({...request,headers:{host,cookie},payload:{servers:[server]}})).statusCode).toBe(403);
    expect((await app.inject({...request,payload:{servers:[{...server,tools:[{...tool,description:'Silently altered contract'}]}]}})).statusCode).toBe(400);
    expect((await app.inject({...request,payload:{servers:[server]}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/mcp/available',headers:{host,cookie}})).json().servers).toEqual([]);
    server.enabled=true;expect((await app.inject({...request,payload:{servers:[server]}})).statusCode).toBe(200);
    expect((await app.inject({url:'/api/mcp/available',headers:{host,cookie}})).json().servers).toEqual([{id:server.id,name:server.name,url:server.url}]);
    expect((await store.db.query('SELECT value FROM settings WHERE key=$1',['mcp_servers']))[0].value).toEqual([server]);
  });
  it('starts only owner-approved local calibration with fixed safe options and normal task cancellation',async()=>{
    expect((await app.inject({url:'/api/models/calibrations',headers:{host}})).statusCode).toBe(401);
    vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
    const providers=engine.gateway;
    vi.spyOn(providers,'listModels').mockResolvedValue([{id:'ollama/calibration',name:'Calibration fixture',provider:'ollama',runtime:'test',local:true,capabilities:{tools:false,reasoning:false,vision:false,structured:false},contextWindow:8192,quantization:null,sizeBytes:100,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null}]);
    const request={method:'POST' as const,url:'/api/models/calibrations',headers:{host,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({...request,payload:{modelId:'ollama/calibration',contextTokens:4096,workspaceId:'forbidden'}})).statusCode).toBe(400);
    const created=await app.inject({...request,payload:{modelId:'ollama/calibration',contextTokens:4096}});expect(created.statusCode).toBe(200);
    const task=await store.task(created.json().taskId);expect(task.options).toMatchObject({modelSelection:'required',access:'read_only',workspaceId:null,network:{mode:'deny'},budget:{maxCalls:1,localOnly:true}});
    expect((await app.inject({url:'/api/models/calibrations',headers:{host,cookie}})).json()[0].measurement).toBeNull();
    expect((await app.inject({method:'POST',url:`/api/tasks/${task.id}/cancel`,headers:request.headers})).json().status).toBe('cancelled');
  });
  it('persists owner resource policy and rejects settings below hard safety floors',async()=>{
    const get=()=>app.inject({url:'/api/hardware/policy',headers:{host,cookie}});
    expect((await get()).json().policy).toEqual({profile:'safe'});
    const request={method:'POST' as const,url:'/api/hardware/policy',headers:{host,cookie,'x-relay-csrf':csrf}};
    expect((await app.inject({...request,payload:{profile:'custom',ramReserveGiB:0,ramReservePercent:0,vramReserveGiB:0,vramReservePercent:0}})).statusCode).toBe(400);
    expect((await get()).json().policy).toEqual({profile:'safe'});
    expect((await app.inject({...request,payload:{profile:'balanced'}})).statusCode).toBe(200);
    expect((await get()).json().policy).toEqual({profile:'balanced'});
    expect((await store.db.query('SELECT value FROM settings WHERE key=$1',['resource_policy']))[0].value).toEqual({profile:'balanced'});
  });
  it('keeps resident telemetry owner-scoped and unavailable values truthful',async()=>{
    expect((await app.inject({url:'/api/models/resident',headers:{host}})).statusCode).toBe(401);
    const response=await app.inject({url:'/api/models/resident',headers:{host,cookie}});
    expect(response.statusCode).toBe(200);expect(response.json().state).toBe('unavailable');expect(response.json().models).toEqual([]);
  });
  it('rejects unauthenticated, cross-origin, wrong-host and mutation-without-CSRF requests',async()=>{
    expect((await app.inject({url:'/api/session',headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/conversations',headers:{host}})).statusCode).toBe(401);
    expect((await app.inject({url:'/api/session',headers:{host,origin:'https://evil.example'}})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/session',headers:{host:'evil.example'}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/conversations',headers:{host,cookie},payload:{}})).statusCode).toBe(403);
  });
  it('persists a conversation with session+CSRF and never returns credentials in provider state',async()=>{
    const response=await app.inject({method:'POST',url:'/api/conversations',headers:{host,cookie,'x-relay-csrf':csrf},payload:{title:'A real conversation'}});
    expect(response.statusCode).toBe(200);
    expect((await app.inject({url:'/api/conversations',headers:{host,cookie}})).json()[0].title).toBe('A real conversation');
    const models=await app.inject({url:'/api/models',headers:{host,cookie}});expect(models.statusCode).toBe(200);expect(models.body).not.toContain('apiKey');
  });
  it('rejects unrestricted execution and disabled scheduling on the server',async()=>{
    const c=await store.createConversation();const payload={content:'test',options:{depth:'fast',modelId:null,access:'unrestricted',workspaceId:null,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}}};
    expect((await app.inject({method:'POST',url:`/api/conversations/${c.id}/messages`,headers:{host,cookie,'x-relay-csrf':csrf},payload})).statusCode).toBe(403);
    await engine.stopAll();payload.options.access='read_only';
    expect((await app.inject({method:'POST',url:`/api/conversations/${c.id}/messages`,headers:{host,cookie,'x-relay-csrf':csrf},payload})).statusCode).toBe(409);
  });
  it('requires an explicit origin and one-use code for owner pairing',async()=>{
    const issued=await pairing.issue();
    const request={method:'POST' as const,url:'/api/session/pair',headers:{host,origin:`http://${host}`},payload:{token:issued.token}};
    expect((await app.inject({...request,headers:{host}})).statusCode).toBe(403);
    const results=await Promise.all([app.inject(request),app.inject(request)]);
    expect(results.filter(result=>result.statusCode===200)).toHaveLength(1);expect(results.filter(result=>result.statusCode===401)).toHaveLength(1);
    const audit=JSON.stringify(await store.db.query('SELECT * FROM audit_events'));expect(audit.includes(issued.token)).toBe(false);
    expect(results.every(result=>!result.body.includes(issued.token))).toBe(true);
  });
  it('reuses a paired session across tabs and a newly constructed session service',async()=>{
    const before=await app.inject({url:'/api/session',headers:{host,cookie}});expect(before.statusCode).toBe(200);expect(before.headers['set-cookie']).toBeUndefined();
    const {Sessions}=await import('../server/auth/sessions.js');await new Sessions(store).initialize();
    const after=await app.inject({url:'/api/session',headers:{host,cookie}});expect(after.statusCode).toBe(200);expect(after.json().csrfToken).toBe(csrf);
  });
  it('revokes pre-pairing local sessions once during migration',async()=>{
    await store.db.query('DELETE FROM settings WHERE key=$1',['local_pairing_v1']);
    const {Sessions}=await import('../server/auth/sessions.js');await new Sessions(store).initialize();
    const revoked=await app.inject({url:'/api/session',headers:{host,cookie}});expect(revoked.statusCode).toBe(401);expect(revoked.json().code).toBe('PAIRING_REQUIRED');
    expect((await store.db.query('SELECT id FROM sessions WHERE remote=false'))).toHaveLength(0);
  });
  it('blocks reverting an old task or uploading while another task owns the same workspace',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};
    const workspace=(await app.inject({method:'POST',url:'/api/workspaces',headers,payload:{name:'Shared workspace'}})).json() as {id:string};
    const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:workspace.id,contextTokens:4096,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}};
    const old=(await store.createTask((await store.createConversation()).id,'Old task',options)).task;await store.transition(old.id,'cancelled');
    await store.createTask((await store.createConversation()).id,'Active shared work',options);
    const revert=await app.inject({method:'POST',url:`/api/tasks/${old.id}/revert`,headers,payload:{checkpointId:'11111111-1111-4111-8111-111111111111'}});
    const upload=await app.inject({method:'POST',url:`/api/workspaces/${workspace.id}/files`,headers,payload:{path:'result.txt',content:'manual edit'}});
    expect(revert.statusCode).toBe(409);expect(revert.json().code).toBe('WORKSPACE_BUSY');
    expect(upload.statusCode).toBe(409);expect(upload.json().code).toBe('WORKSPACE_BUSY');
  });
  it('persists an explicit verification contract and rejects unsafe requirements at admission',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const workspace=(await app.inject({method:'POST',url:'/api/workspaces',headers,payload:{name:'Required checks'}})).json() as {id:string};
    const conversation=await store.createConversation();const contract={requiredReads:[{path:'result.txt',expectedSha256:'a'.repeat(64)}]};
    const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:workspace.id,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true},verification:contract};
    const enqueue=vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
    try{
      const bad=await app.inject({method:'POST',url:`/api/conversations/${conversation.id}/messages`,headers,payload:{content:'Read required file',options:{...options,verification:{requiredReads:[{...contract.requiredReads[0],path:'../secret'}]}}}});expect(bad.statusCode).toBe(400);
      const good=await app.inject({method:'POST',url:`/api/conversations/${conversation.id}/messages`,headers,payload:{content:'Read required file',options}});expect(good.statusCode).toBe(200);expect(good.json().task.options.verification).toEqual(contract);
      expect((await store.task(good.json().task.id)).options.verification).toEqual(contract);
    }finally{enqueue.mockRestore();}
  });
});
