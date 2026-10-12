import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/api/app.js';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import {ToolStore} from '../server/tools/store.js';
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
  it('reconciles an interrupted managed branch receipt only with explicit owner consent',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf},broker=engine.tools as ToolBroker;
    const parent=await broker.createWorkspace('Parent');await store.saveWorkspace(parent);await broker.upload(parent.id,'a.txt','base');const child=await broker.forkWorkspace(parent.id,'Child',async()=>{},async record=>{await store.saveWorkspace(record);});await broker.changeFile(child.id,'a.txt','child',(await broker.readFile(child.id,'a.txt')).sha256);
    const preview=await broker.reviewBranch(child.id,parent.id,async()=>{}),saved=ToolStore.prototype.saveCheckpoint;const failure=vi.spyOn(ToolStore.prototype,'saveCheckpoint').mockImplementation(async function(this:ToolStore,record){if(record.taskId===`branch-${child.id}`&&record.state==='committed')throw new Error('Lost final receipt');return saved.call(this,record);});
    try{await expect(broker.integrateBranch(child.id,parent.id,preview.digest,['a.txt'],async()=>{})).rejects.toThrow();}finally{failure.mockRestore();}
    const receipt=(await broker.branchIntegrations(child.id,parent.id,async()=>{}))[0],url=`/api/workspaces/${child.id}/integration/${receipt.id}/reconcile`;
    expect((await app.inject({method:'POST',url,headers,payload:{confirmed:false}})).statusCode).toBe(400);
    const response=await app.inject({method:'POST',url,headers,payload:{confirmed:true}});expect(response.statusCode,response.body).toBe(200);expect(response.json().state).toBe('committed');expect((await broker.readFile(parent.id,'a.txt')).content).toBe('child');
  });
  it('reviews, integrates and rolls back a managed branch through exact owner confirmation',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const broker=engine.tools as ToolBroker;
    const parent=await broker.createWorkspace('Integration parent');await store.saveWorkspace(parent);await broker.upload(parent.id,'a.txt','base');
    const child=await broker.forkWorkspace(parent.id,'Integration child',async()=>{},async record=>{await store.saveWorkspace(record);});await broker.changeFile(child.id,'a.txt','child',(await broker.readFile(child.id,'a.txt')).sha256);
    const url=`/api/workspaces/${child.id}/integration`;
    const preview=await app.inject({url:`${url}/preview`,headers});expect(preview.statusCode,preview.body).toBe(200);
    const body={digest:preview.json().digest,paths:['a.txt'],confirmed:true};
    expect((await app.inject({method:'POST',url,headers:{host,cookie},payload:body})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url,headers,payload:{...body,confirmed:false}})).statusCode).toBe(400);
    const applied=await app.inject({method:'POST',url,headers,payload:body});expect(applied.statusCode,applied.body).toBe(200);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('child');
    expect((await app.inject({url,headers})).json()[0].id).toBe(applied.json().id);
    expect((await app.inject({method:'POST',url,headers,payload:body})).statusCode).toBe(409);
    const revert=await app.inject({method:'POST',url:`${url}/${applied.json().id}/rollback`,headers,payload:{confirmed:true}});expect(revert.statusCode,revert.body).toBe(200);expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');
  });
  it('denies managed branch integration to a non-owner even for their own workspace',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const broker=engine.tools as ToolBroker;const parent=await broker.createWorkspace('Parent',undefined,'owner');await store.saveWorkspace(parent);
    const child=await broker.forkWorkspace(parent.id,'Child',async()=>{},async record=>{await store.saveWorkspace(record);});await store.db.query("UPDATE users SET role='chat' WHERE id='owner'");
    for(const suffix of ['', '/preview'])expect((await app.inject({url:`/api/workspaces/${child.id}/integration${suffix}`,headers})).statusCode).toBe(403);
  });
  it('refuses managed branch integration while either participant has unfinished work',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const broker=engine.tools as ToolBroker;const parent=await broker.createWorkspace('Parent');await store.saveWorkspace(parent);await broker.upload(parent.id,'a.txt','base');
    const child=await broker.forkWorkspace(parent.id,'Child',async()=>{},async record=>{await store.saveWorkspace(record);});await broker.changeFile(child.id,'a.txt','child',(await broker.readFile(child.id,'a.txt')).sha256);
    const url=`/api/workspaces/${child.id}/integration`,preview=(await app.inject({url:`${url}/preview`,headers})).json();
    const options:TaskOptions={depth:'fast',modelId:null,access:'workspace',workspaceId:parent.id,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    const task=await store.createTask((await store.createConversation()).id,'Unfinished parent',options);
    const result=await app.inject({method:'POST',url,headers,payload:{digest:preview.digest,paths:['a.txt'],confirmed:true}});expect(result.statusCode,result.body).toBe(409);expect(result.json().code).toBe('WORKSPACE_BUSY');expect((await broker.readFile(parent.id,'a.txt')).content).toBe('base');await store.transition(task.task.id,'cancelled');
  });
  it('persists Auto preference without changing privacy or budgets and rejects unknown preferences',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};
    const options:TaskOptions={autoPolicy:'quality',depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'local_only',budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:0,localOnly:true}};
    const requestId='031ec2c5-c96c-4581-99a6-ad98f86ebf20';
    const response=await app.inject({method:'POST',url:'/api/conversations/start',headers,payload:{requestId,content:'Policy persistence fixture',options}});
    expect(response.statusCode,response.body).toBe(200);
    const saved=await store.task(response.json().task.id);
    expect(saved.options).toMatchObject({autoPolicy:'quality',modelId:null,cloudPolicy:'local_only',budget:{maxCostUsd:0,localOnly:true}});
    const rejected=await app.inject({method:'POST',url:'/api/conversations/start',headers,payload:{requestId,content:'Invalid policy',options:{...options,autoPolicy:'unlimited'}}});
    expect(rejected.statusCode).toBe(400);
  });
  it('recognizes an available explicit development profile when the default sandbox is absent',async()=>{
    const status=vi.spyOn(engine.tools as ToolBroker,'sandboxStatus').mockImplementation(async(profile?:string)=>({available:profile==='python',reason:'Fixture profile status'}));
    try{
      const response=await app.inject({url:'/api/assistants',headers:{host,cookie}});expect(response.statusCode).toBe(200);
      const coding=response.json().assistants.find((item:{id:string})=>item.id==='coding');
      expect(coding.status).toBe('ready');expect(coding.tools).toContain('terminal');
      expect(status).toHaveBeenCalledWith('python');
    }finally{status.mockRestore();}
  });
  it('reports connection and sandbox prerequisites without inventing agent execution readiness',async()=>{
    const status=vi.spyOn(engine.tools as ToolBroker,'sandboxStatus').mockResolvedValue({available:false,reason:'Fixture: no isolated runtime'});
    try{
      const response=await app.inject({url:'/api/assistants',headers:{host,cookie}});expect(response.statusCode).toBe(200);
      const assistants=response.json().assistants as {id:string;status:string;tools:string[];integrationState?:string}[];
      for(const id of ['email','calendar'])expect(assistants.find(item=>item.id===id)).toMatchObject({status:'connection_required',integrationState:'not_configured'});
      expect(assistants.find(item=>item.id==='coding')).toMatchObject({status:'limited'});
      expect(assistants.every(item=>!item.tools.includes('terminal'))).toBe(true);
      expect(assistants.flatMap(item=>item.tools).some(name=>name.startsWith('gmail_')||name.startsWith('calendar_'))).toBe(false);
    }finally{status.mockRestore();}
  });
  it('forks an owner-reviewed workspace into an independent Git branch and persists its identity',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};
    const parent=(await app.inject({method:'POST',url:'/api/workspaces',headers,payload:{name:'Original',personal:true}})).json();
    expect((await app.inject({method:'POST',url:`/api/workspaces/${parent.id}/files`,headers,payload:{path:'a.txt',content:'base'}})).statusCode).toBe(200);
    const url=`/api/workspaces/${parent.id}/fork`;
    expect((await app.inject({method:'POST',url,headers:{host,cookie},payload:{name:'Branch'}})).statusCode).toBe(403);
    const response=await app.inject({method:'POST',url,headers,payload:{name:'Branch'}});
    expect(response.statusCode,response.body).toBe(200);
    const fork=response.json();expect(fork.id).not.toBe(parent.id);expect(fork.sourcePath).toBeNull();expect(fork.ownerUserId).toBe('owner');
    expect(fork.git).toMatchObject({parentWorkspaceId:parent.id,repositoryId:parent.id,branch:`relay/${fork.id}`});
    expect(fork.git.baseCommit).toMatch(/^[a-f0-9]{64}$/);
    expect((await store.db.query('SELECT git FROM workspaces WHERE id=$1',[fork.id]))[0].git).toEqual(fork.git);
    expect((await app.inject({url:`/api/workspaces/${fork.id}/file?path=a.txt`,headers})).json().content).toBe('base');
    expect((await app.inject({method:'POST',url:`/api/workspaces/${fork.id}/files`,headers,payload:{path:'new.txt',content:'branch only'}})).statusCode).toBe(200);
    expect((await app.inject({url:`/api/workspaces/${parent.id}/files`,headers})).json().files).toEqual(['a.txt']);
    const listing=(await app.inject({url:'/api/workspaces',headers})).json();
    expect(listing.find((item:{id:string})=>item.id===fork.id).git).toEqual(fork.git);
    await store.db.query("UPDATE users SET role='chat' WHERE id='owner'");
    expect((await app.inject({method:'POST',url,headers,payload:{name:'Denied fork'}})).statusCode).toBe(403);
  });
  it('exports metadata-only diagnostics and authenticates task timing reads',async()=>{
    const options:TaskOptions={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    const {task}=await store.createTask((await store.createConversation()).id,'private diagnostic objective sentinel',options);
    const headers={host,cookie,'x-relay-csrf':csrf};
    expect((await app.inject({url:`/api/tasks/${task.id}/timing`,headers:{host}})).statusCode).toBe(401);
    const timing=await app.inject({url:`/api/tasks/${task.id}/timing`,headers});
    expect(timing.statusCode).toBe(200);expect(timing.json().id).toBe(task.id);
    expect(timing.body).not.toContain('private diagnostic objective sentinel');
    expect((await app.inject({method:'POST',url:'/api/admin/diagnostics',headers:{host,cookie},payload:{days:7}})).statusCode).toBe(403);
    const bundle=await app.inject({method:'POST',url:'/api/admin/diagnostics',headers,payload:{days:7,maxTasks:20}});
    expect(bundle.statusCode).toBe(200);expect(bundle.json()).toMatchObject({format:1,scope:'own_account',counts:{exportedTasks:1}});
    expect(bundle.body).not.toContain(task.id);expect(bundle.body).not.toContain('private diagnostic objective sentinel');
    expect((await app.inject({method:'POST',url:'/api/admin/diagnostics',headers,payload:{days:9999}})).statusCode).toBe(400);
  });
  it('keeps restored execution stopped until the local owner reviews it',async()=>{
    await store.db.query("INSERT INTO settings(key,value) VALUES ('restoration_pending','true')");
    await engine.stopAll();
    const headers={host,cookie,'x-relay-csrf':csrf};
    expect((await app.inject({method:'POST',url:'/api/resume',headers})).statusCode).toBe(409);
    expect((await app.inject({url:'/api/admin/restoration',headers})).json().pending).toBe(true);
    expect((await app.inject({method:'POST',url:'/api/admin/restoration/review',headers,payload:{confirm:true}})).statusCode).toBe(200);
    expect((await store.control()).stopped).toBe(true);
    expect((await app.inject({method:'POST',url:'/api/resume',headers})).statusCode).toBe(200);
  });
  it('requires an owner preview and exact explicit confirmation for retention',async()=>{
    const headers={host,cookie,'x-relay-csrf':csrf};
    const preview=await app.inject({method:'POST',url:'/api/admin/retention/preview',headers,payload:{expiredCredentials:true,olderThanDays:90}});
    expect(preview.statusCode).toBe(200);expect(preview.json().counts.sessions).toBe(0);
    const token=preview.json().token;
    expect((await app.inject({method:'POST',url:'/api/admin/retention/apply',headers,payload:{token}})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:'/api/admin/retention/apply',headers,payload:{token,confirm:true}})).statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/admin/retention/apply',headers,payload:{token,confirm:true}})).statusCode).toBe(409);
  });
  it('persists supported reasoning preferences and rejects arbitrary controls',async()=>{
    vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
    const options={reasoning:'low',depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'local_only',budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:null,localOnly:true}};
    const request={method:'POST' as const,url:'/api/conversations/start',headers:{host,cookie,'x-relay-csrf':csrf},payload:{requestId:'95b6b53d-4397-4c4a-9a25-024bfca38f24',content:'Reasoning option fixture',options}};
    expect((await app.inject({...request,payload:{...request.payload,options:{...options,reasoning:'unlimited'}}})).statusCode).toBe(400);
    const response=await app.inject(request);expect(response.statusCode).toBe(200);
    expect((await store.task(response.json().task.id)).options.reasoning).toBe('low');
  });
  it('reports host execution limits separately from account in-flight quotas',async()=>{
    const response=await app.inject({url:'/api/status',headers:{host,cookie}});
    expect(response.statusCode).toBe(200);
    expect(response.json().scheduling).toEqual({maxExecutingTasks:3,maxLocalInference:1,approvalWaitUsesSlot:false,accountLimitIncludesWaiting:true});
  });
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
  it.each(['fast','balanced','deep','maximum'] as const)('rejects incompatible %s Browser verification before task admission',async depth=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const workspace=await (engine.tools as ToolBroker).createWorkspace('Browser contract');await store.saveWorkspace(workspace);
    const conversation=await store.createConversation();
    const options:TaskOptions={assistantId:'browser',depth,modelId:null,access:'read_only',workspaceId:workspace.id,contextTokens:16384,budget:{maxCalls:8,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true},verification:{requiredReads:[{path:'result.txt',expectedSha256:'a'.repeat(64)}]}};
    const response=await app.inject({method:'POST',url:`/api/conversations/${conversation.id}/messages`,headers,payload:{content:'Read required file',options}});
    expect(response.statusCode,response.body).toBe(403);expect(response.json().code).toBe('VERIFICATION_CAPABILITY');
    const unchanged=await store.conversation(conversation.id);expect(unchanged.tasks).toEqual([]);expect(unchanged.messages).toEqual([]);
  });
  it.each([undefined,'coding','learning'] as const)('persists compatible %s verification and rejects unsafe requirements at admission',async assistantId=>{
    const headers={host,cookie,'x-relay-csrf':csrf};const workspace=(await app.inject({method:'POST',url:'/api/workspaces',headers,payload:{name:'Required checks'}})).json() as {id:string};
    const conversation=await store.createConversation();const contract={requiredReads:[{path:'result.txt',expectedSha256:'a'.repeat(64)}]};
    const options:TaskOptions={assistantId,depth:'fast',modelId:null,access:'workspace',workspaceId:workspace.id,contextTokens:8192,budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true},verification:contract};
    const enqueue=vi.spyOn(engine,'enqueue').mockImplementation(()=>{});
    try{
      const bad=await app.inject({method:'POST',url:`/api/conversations/${conversation.id}/messages`,headers,payload:{content:'Read required file',options:{...options,verification:{requiredReads:[{...contract.requiredReads[0],path:'../secret'}]}}}});expect(bad.statusCode).toBe(400);
      const good=await app.inject({method:'POST',url:`/api/conversations/${conversation.id}/messages`,headers,payload:{content:'Read required file',options}});expect(good.statusCode).toBe(200);expect(good.json().task.options.verification).toEqual(contract);
      expect((await store.task(good.json().task.id)).options.verification).toEqual(contract);
    }finally{enqueue.mockRestore();}
  });
});
