import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import staticFiles from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z, ZodError } from 'zod';
import type { TaskOptions } from '../../shared/types.js';
import { authorizeOptions, authorizeOwner, authorizeWorkspace, chatPermissions, permissionSchema, type Principal, type User } from '../auth/policy.js';
import { Sessions } from '../auth/sessions.js';
import type { LocalPairing } from '../auth/pairing.js';
import { RemoteIdentity, type RemoteConfig } from '../auth/remote.js';
import { AppError, publicError } from '../core/errors.js';
import { row, type Store } from '../db/store.js';
import type { Engine } from '../orchestration/engine.js';
import type { Providers } from '../providers/index.js';
import type { ToolBroker } from '../tools/index.js';
import { getHardware, assessModel } from '../hardware/index.js';
import { getResourcePolicy } from '../hardware/config.js';
import { resourceRoutes } from './resources.js';
import { registerHistoryRoutes } from './history.js';
import { calibrationRoutes } from './calibration.js';
import { mcpRoutes } from './mcp.js';
import { verificationContractSchema } from '../orchestration/required-reads.js';
import { networkPolicySchema } from '../tools/network-policy.js';
import { installBoundary, RateLimiter, routeId } from './boundary.js';

const taskOptions=z.object({depth:z.enum(['fast','balanced','deep','maximum']),modelId:z.string().max(200).nullable(),access:z.enum(['read_only','supervised','workspace','unrestricted']),hostAccessConfirmed:z.boolean().optional(),workspaceId:z.string().uuid().nullable(),contextTokens:z.number().int().min(2048).max(131072),cloudPolicy:z.enum(['local_only','allow','ask']).default('local_only'),verification:verificationContractSchema.optional(),network:networkPolicySchema.optional(),mcpServerIds:permissionSchema.shape.mcpServerIds,modelSelection:z.enum(['preferred','required']).optional(),budget:z.object({maxCalls:z.number().int().min(1).max(64),maxSeconds:z.number().int().min(30).max(3600),maxIterations:z.number().int().min(1).max(16),maxCostUsd:z.number().min(0).max(100).nullable(),localOnly:z.boolean()})});
const providerId=z.enum(['ollama','lmstudio','openai','anthropic','gemini']);
export interface RemoteControl {config:RemoteConfig|null;enabled:boolean;listening:boolean;}
export interface Services {store:Store;engine:Engine;providers:Providers;broker:ToolBroker;remoteControl?:RemoteControl;pairing?:LocalPairing;}
export interface AppOptions {port?:number;remote?:RemoteConfig;remoteIdentity?:RemoteIdentity;staticRoot?:string;logging?:boolean;}

// Both loopback listeners share the same Store and therefore the same admission
// counters. These limits bound open connections, not merely requests per minute.
const streamPools=new WeakMap<Store,{total:number;users:Map<string,number>}>();
function reserveStream(store:Store,userId:string):()=>void {
  let pool=streamPools.get(store);
  if(!pool){pool={total:0,users:new Map()};streamPools.set(store,pool);}
  const count=pool.users.get(userId)??0;
  if(count>=4||pool.total>=32)throw new AppError('EVENT_STREAM_LIMIT','Too many activity streams are open. Close another tab or reconnect shortly.',429);
  pool.users.set(userId,count+1);pool.total++;
  let released=false;
  return ()=>{if(released)return;released=true;pool.total--;const remaining=(pool.users.get(userId)??1)-1;if(remaining)pool.users.set(userId,remaining);else pool.users.delete(userId);};
}

export async function createApp(services:Services,options:AppOptions={}):Promise<FastifyInstance> {
  const {store,engine,providers,broker}=services;
  const app=Fastify({logger:options.logging?{level:'info',redact:['req.headers.authorization','req.headers.cookie','req.headers["cf-access-jwt-assertion"]','req.headers["x-relay-csrf"]','req.body.token','res.headers["set-cookie"]']}:false,bodyLimit:1024*1024,requestTimeout:15000,connectionTimeout:10000,keepAliveTimeout:72000});
  await app.register(cookie);
  const port=options.port??4317;
  const origins=options.remote?[options.remote.publicOrigin]:[`http://127.0.0.1:${port}`,`http://localhost:${port}`, ...(process.env.RELAY_DEV==='1'?['http://127.0.0.1:5178','http://localhost:5178']:[])];
  installBoundary(app,origins,!!options.remote);
  const sessions=new Sessions(store,!!options.remote);await sessions.initialize();
  const identity=options.remoteIdentity??(options.remote?new RemoteIdentity(store,options.remote):null);
  const principals=new WeakMap<FastifyRequest,Principal>();const externalUsers=new WeakMap<FastifyRequest,string>();
  const identityExpiries=new WeakMap<FastifyRequest,number>();
  const activeStreams=new Set<()=>void>();
  app.addHook('preClose',async()=>{for(const close of [...activeStreams])close();});
  const limiter=new RateLimiter();const pairingLimiter=new RateLimiter();
  app.addHook('onRequest',async request=>{
    if(identity) {
      if(services.remoteControl&&!services.remoteControl.enabled)throw new AppError('REMOTE_DISABLED','Remote access is disabled by the host owner',403);
      const header=request.headers['cf-access-jwt-assertion'];
      const verified=await identity.authenticateContext(typeof header==='string'?header:undefined);externalUsers.set(request,verified.userId);identityExpiries.set(request,verified.expiresAtMs);
      limiter.check(verified.userId,180);
    } else if(request.url.startsWith('/api/')) limiter.check(request.ip,300);
    const path=request.url.split('?')[0];
    if(request.url.startsWith('/api/')&&path!=='/api/session'&&path!=='/api/session/pair') {
      const principal=await sessions.principal(request,externalUsers.get(request));principals.set(request,principal);
    }
  });
  const principal=(request:FastifyRequest):Principal=>{const p=principals.get(request);if(!p)throw new AppError('AUTH_REQUIRED','Authentication required',401);return p;};
  const owner=(request:FastifyRequest)=>{const p=principal(request);authorizeOwner(p);return p;};
  resourceRoutes(app,store,providers,owner);
  registerHistoryRoutes(app,store,principal);
  calibrationRoutes(app,store,engine,providers,owner);
  await mcpRoutes(app,store,broker.mcp,principal,owner);
  const task=async(request:FastifyRequest)=>store.task(routeId(request),principal(request).user.id);
  const remoteEnabled=()=>services.remoteControl?services.remoteControl.enabled&&services.remoteControl.listening:!!options.remote;
  const systemStatus=async()=>{const control=await store.control();return {stopped:control.stopped,stopGeneration:control.generation,database:store.db.kind,sandbox:await broker.sandboxStatus(),version:'0.1.0',hostName:hostname(),remoteEnabled:remoteEnabled()};};
  app.setErrorHandler((error,request,reply)=>{
    const code=error instanceof AppError?error.code:error instanceof ZodError?'VALIDATION_ERROR':'OPERATION_FAILED';
    const status=error instanceof AppError?error.status:error instanceof ZodError?400:error&&typeof error==='object'&&'statusCode' in error&&typeof error.statusCode==='number'?error.statusCode:500;
    if(status>=500)app.log.error({code,requestId:request.id,message:publicError(error)},'Operation failed');
    reply.code(status).send({error:error instanceof ZodError?error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,4).join('; '):publicError(error),code});
  });
  app.get('/api/session',async(request,reply)=>({...await sessions.open(request,reply,externalUsers.get(request)??'owner',!!identity),hostName:hostname()}));
  app.post('/api/session/pair',async(request,reply)=>{
    if(identity||options.remote)throw new AppError('LOCAL_ONLY','Owner pairing is available only at the local host address.',403);
    if(!request.headers.origin||!origins.includes(request.headers.origin))throw new AppError('BAD_ORIGIN','Pairing requires the exact local application origin.',403);
    pairingLimiter.check(request.ip,10);
    if(!services.pairing)throw new AppError('PAIRING_UNAVAILABLE','The local pairing service is unavailable.',503);
    const {token}=z.object({token:z.string().trim().min(1).max(128)}).strict().parse(request.body);
    await services.pairing.redeem(token);
    const session=await sessions.open(request,reply,'owner',true);
    await store.audit(null,'LOCAL_BROWSER_PAIRED',{userId:'owner'});
    return {...session,hostName:hostname()};
  });
  app.get('/api/status',async()=>systemStatus());
  app.post('/api/stop',async(request)=>{owner(request);await engine.stopAll();return systemStatus();});
  app.post('/api/resume',async(request)=>{owner(request);await engine.resumeScheduling();return systemStatus();});
  app.get('/api/conversations',async request=>store.conversations(principal(request).user.id));
  app.post('/api/conversations',async request=>{
    const body=z.object({title:z.string().max(120).optional()}).parse(request.body??{});return store.createConversation(body.title,principal(request).user.id);
  });
  app.get('/api/conversations/:id',async request=>store.conversation(routeId(request),principal(request).user.id));
  app.delete('/api/conversations/:id',async request=>{await store.deleteConversation(routeId(request),principal(request).user.id);return {deleted:true};});
  app.post('/api/conversations/start',async request=>{
    const p=principal(request);
    const body=z.object({requestId:z.string().uuid(),content:z.string().trim().min(1).max(32000),options:taskOptions}).strict().parse(request.body);
    const options=authorizeOptions(p,body.options as TaskOptions);
    if(options.workspaceId&&!((await broker.listWorkspaces()).some(w=>w.id===options.workspaceId)))throw new AppError('WORKSPACE_NOT_FOUND','Workspace not found',404);
    const created=await store.createTask(body.requestId,body.content,options,p.user.id,p.user.sessionVersion,true);
    if(created.task.status==='created')engine.enqueue(created.task.id);
    return created;
  });
  app.post('/api/conversations/:id/messages',async request=>{
    const p=principal(request);
    const body=z.object({content:z.string().trim().min(1).max(32000),options:taskOptions}).parse(request.body);
    const options=authorizeOptions(p,body.options as TaskOptions);
    const active=await store.db.query("SELECT id FROM tasks WHERE user_id=$1 AND status NOT IN ('completed','failed','cancelled','paused')",[p.user.id]);
    if(active.length>=p.user.permissions.maxConcurrentTasks)throw new AppError('USER_TASK_QUOTA','Your active task limit is reached. Wait or stop a task.',429);
    if(options.workspaceId&&!((await broker.listWorkspaces()).some(w=>w.id===options.workspaceId)))throw new AppError('WORKSPACE_NOT_FOUND','Workspace not found',404);
    const created=await store.createTask(routeId(request),body.content,options,p.user.id,p.user.sessionVersion);engine.enqueue(created.task.id);return created;
  });
  app.get('/api/tasks/:id',async request=>{
    const record=await task(request);const [steps,events,approvals,verification,changes]=await Promise.all([store.steps(record.id),store.taskEvents(record.id),store.approvals(record.id),store.verification(record.id),broker.changes(record.id)]);
    return {task:record,steps,events,approvals,verification,changes};
  });
  app.post('/api/tasks/:id/cancel',async request=>{const record=await task(request);await engine.cancel(record.id);return store.task(record.id);});
  app.post('/api/tasks/:id/resume',async request=>{const record=await task(request);const p=principal(request);authorizeOptions(p,record.options);return engine.resume(record.id,p.user.sessionVersion);});
  app.get('/api/tasks/:id/changes',async request=>broker.changes((await task(request)).id));
  app.post('/api/tasks/:id/revert',async request=>{
    const record=await task(request);if(!['completed','paused','cancelled','failed','waiting_for_user'].includes(record.status))throw new AppError('TASK_ACTIVE','Stop the task before reverting a checkpoint',409);
    const p=principal(request);
    if(!record.options.workspaceId)throw new AppError('WORKSPACE_REQUIRED','This task has no authorized workspace',403);
    authorizeWorkspace(p,record.options.workspaceId);
    if(p.user.permissions.maxAccess==='read_only')throw new AppError('READ_ONLY','Your current policy does not permit checkpoint changes',403);
    const body=z.object({checkpointId:z.string().uuid()}).parse(request.body);await engine.mutateWorkspace(record.options.workspaceId,()=>broker.revert(record.id,body.checkpointId));await store.audit(record.id,'CHECKPOINT_REVERTED',{checkpointId:body.checkpointId,userId:principal(request).user.id});return {reverted:true};
  });
  app.post('/api/approvals/:id',async request=>{
    const {decision}=z.object({decision:z.enum(['allow_once','allow_task','denied'])}).parse(request.body);
    const approval=await store.decideApproval(routeId(request),decision,principal(request).user.id);engine.approvalChanged(approval.id);return approval;
  });
  app.get('/api/models',async request=>{
    const p=principal(request);const [models,statuses]=await Promise.all([providers.listModels(),providers.statuses()]);
    return {models:models.filter(m=>p.user.permissions.providers.includes(m.provider)),providers:statuses.filter(s=>p.user.permissions.providers.includes(s.id))};
  });
  app.post('/api/models/assess',async request=>{
    const p=principal(request);const body=z.object({modelId:z.string().max(200),contextTokens:z.number().int().min(2048).max(131072)}).parse(request.body);
    const model=(await providers.listModels()).find(m=>m.id===body.modelId&&p.user.permissions.providers.includes(m.provider));
    if(!model)throw new AppError('MODEL_NOT_FOUND','Available model not found',404);return assessModel(model,await getHardware(),body.contextTokens,await getResourcePolicy(store));
  });
  app.get('/api/hardware',async request=>{owner(request);return getHardware();});
  for(const method of ['POST','DELETE'] as const)app.route({method,url:'/api/providers/:id/key',handler:async request=>{
    owner(request);const id=providerId.parse(routeId(request));
    if(id==='ollama'||id==='lmstudio')throw new AppError('LOCAL_RUNTIME','This local runtime does not require a Relay API key.');
    if(method==='DELETE'){await providers.secrets.remove(id);await providers.verify(id);await store.audit(null,'PROVIDER_DISCONNECTED',{provider:id});return {saved:false,storage:'none'};}
    const {key,persist}=z.object({key:z.string().trim().min(8).max(1000),persist:z.boolean()}).parse(request.body);
    const result=await providers.secrets.set(id,key,persist);await providers.verify(id);await store.audit(null,'PROVIDER_CONNECTED',{provider:id,storage:result.storage});return result;
  }});
  app.post('/api/providers/:id/verify',async request=>{owner(request);return providers.verify(providerId.parse(routeId(request)));});
  app.post('/api/providers/:id/enabled',async request=>{
    owner(request);const id=providerId.parse(routeId(request));const {enabled}=z.object({enabled:z.boolean()}).parse(request.body);providers.setEnabled(id,enabled);
    await store.db.query('INSERT INTO provider_connections(provider,enabled) VALUES ($1,$2) ON CONFLICT(provider) DO UPDATE SET enabled=excluded.enabled',[id,enabled]);await store.audit(null,'PROVIDER_ENABLED',{provider:id,enabled});return providers.verify(id);
  });
  app.get('/api/workspaces',async request=>{const p=principal(request);return (await broker.listWorkspaces()).filter(w=>p.user.role==='owner'&&!p.remote||p.user.permissions.workspaceIds.includes(w.id));});
  app.post('/api/workspaces',async request=>{
    owner(request);const body=z.object({name:z.string().trim().min(1).max(128),sourcePath:z.string().max(2048).optional()}).parse(request.body);
    const workspace=await broker.createWorkspace(body.name,body.sourcePath);await store.saveWorkspace(workspace);await store.audit(null,'WORKSPACE_CREATED',{workspaceId:workspace.id,imported:!!body.sourcePath});return workspace;
  });
  app.get('/api/workspaces/:id/files',async request=>{authorizeWorkspace(principal(request),routeId(request));return {files:await broker.listFiles(routeId(request))};});
  app.post('/api/workspaces/:id/files',async request=>{
    const p=principal(request);authorizeWorkspace(p,routeId(request));if(p.user.permissions.maxAccess==='read_only')throw new AppError('READ_ONLY','Your account cannot upload workspace files',403);
    const body=z.object({path:z.string().min(1).max(512),content:z.string().max(256000)}).parse(request.body);
    await engine.mutateWorkspace(routeId(request),()=>broker.upload(routeId(request),body.path,body.content));await store.audit(null,'FILE_UPLOADED',{workspaceId:routeId(request),path:body.path,userId:p.user.id});return {uploaded:true};
  });
  app.get('/api/events',async(request,reply)=>{
    const p=principal(request);const query=z.object({after:z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)}).parse(request.query);
    const header=Number(request.headers['last-event-id']??0);let cursor=Math.max(query.after,Number.isSafeInteger(header)&&header>=0?header:0);
    const expiresAt=p.remote?identityExpiries.get(request):undefined;
    if(p.remote&&(expiresAt===undefined||expiresAt<=Date.now()))throw new AppError('REMOTE_AUTH','Gateway authentication expired. Reconnect to continue.',401);
    const release=reserveStream(store,p.user.id);
    const controller=new AbortController();
    let expiryTimer:NodeJS.Timeout|undefined;
    let closed=false;const close=()=>{if(closed)return;closed=true;if(expiryTimer)clearTimeout(expiryTimer);release();activeStreams.delete(close);controller.abort();if(!reply.raw.writableEnded)reply.raw.end();};
    activeStreams.add(close);reply.raw.once('close',close);reply.raw.once('error',close);
    if(expiresAt!==undefined){expiryTimer=setTimeout(close,Math.min(2147483647,Math.max(0,expiresAt-Date.now())));expiryTimer.unref();}
    const write=async(value:string)=>{
      if(closed||reply.raw.destroyed||expiresAt!==undefined&&Date.now()>=expiresAt){close();return;}
      if(reply.raw.write(value))return;
      // Every exit removes the drain listener and clears the timeout. A prior
      // successful drain must never leave a timer that closes a healthy stream.
      const drained=await new Promise<boolean>(resolve=>{
        const done=(success:boolean)=>{clearTimeout(timer);reply.raw.off('drain',drain);controller.signal.removeEventListener('abort',aborted);resolve(success);};
        const drain=()=>done(true);const aborted=()=>done(false);const timer=setTimeout(()=>done(false),5000);
        reply.raw.once('drain',drain);controller.signal.addEventListener('abort',aborted,{once:true});
        if(controller.signal.aborted)aborted();
      });
      if(!drained)close();
    };
    let lastHeartbeat=Date.now();
    try {
      // Authenticated, capacity-limited SSE owns its idle lifetime. The ordinary
      // HTTP socket timeout otherwise races a quiet stream's heartbeat interval.
      request.raw.socket.setTimeout(0);
      reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});await write('retry: 1500\n\n');
      while(!closed) {
      if(p.remote&&!remoteEnabled()||!await sessions.live(p))break;
      const events=await store.events(cursor,100,p.user.id==='owner'&&!p.remote?undefined:p.user.id);
      for(const e of events) {
        if(closed)break;cursor=e.id;
        await write(`id: ${e.id}\nevent: activity\ndata: ${JSON.stringify(e)}\n\n`);
      }
      if(Date.now()-lastHeartbeat>10000){await write(': heartbeat\n\n');lastHeartbeat=Date.now();}
      if(!events.length)await delay(400,undefined,{signal:controller.signal}).catch(()=>{});
    }} catch(error) {app.log.warn({message:publicError(error),userId:p.user.id},'Activity stream ended');}
    finally {close();reply.raw.off('close',close);reply.raw.off('error',close);}
  });
  registerAdmin(app,services,owner,sessions,options.remote);
  const staticRoot=options.staticRoot??resolve('dist');
  if(existsSync(staticRoot)){await app.register(staticFiles,{root:staticRoot,index:'index.html'});app.setNotFoundHandler((request,reply)=>{if(request.url.startsWith('/api/'))return reply.code(404).send({error:'API route not found',code:'NOT_FOUND'});return reply.sendFile('index.html');});}
  return app;
}

function registerAdmin(app:FastifyInstance,{store,engine,remoteControl}:Services,owner:(request:FastifyRequest)=>Principal,_sessions:Sessions,remote?:RemoteConfig) {
  app.get('/api/admin/users',async request=>{owner(request);return (await store.db.query('SELECT * FROM users ORDER BY created_at')).map(r=>row<User>(r));});
  app.post('/api/admin/users',async request=>{
    owner(request);const body=z.object({name:z.string().trim().min(1).max(100),email:z.email().max(254),role:z.enum(['chat','trusted']).default('chat'),permissions:permissionSchema.optional()}).parse(request.body);
    const permissions=body.permissions??chatPermissions;
    const user=row<User>((await store.db.query('INSERT INTO users(id,name,email,role,permissions) VALUES ($1,$2,$3,$4,$5) RETURNING *',[randomUUID(),body.name,body.email.toLowerCase(),body.role,JSON.stringify(permissions)]))[0]);
    await store.audit(null,'USER_INVITED',{userId:user.id,role:user.role,permissions});return user;
  });
  app.post('/api/admin/users/:id',async request=>{
    owner(request);const id=routeId(request);if(id==='owner')throw new AppError('OWNER_PROTECTED','The local owner cannot be disabled or downgraded');
    const body=z.object({enabled:z.boolean(),permissions:permissionSchema}).parse(request.body);
    const rows=await store.db.query('UPDATE users SET enabled=$1,permissions=$2,session_version=session_version+1 WHERE id=$3 RETURNING *',[body.enabled,JSON.stringify(body.permissions),id]);
    if(!rows.length)throw new AppError('NOT_FOUND','User not found',404);await engine.cancelUser(id);await store.audit(null,'USER_POLICY_CHANGED',{userId:id,enabled:body.enabled,permissions:body.permissions});return row<User>(rows[0]);
  });
  app.post('/api/admin/users/:id/revoke',async request=>{
    owner(request);const id=routeId(request);if(id==='owner')throw new AppError('OWNER_PROTECTED','Use emergency stop for owner work');
    await store.db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1',[id]);await store.db.query('DELETE FROM sessions WHERE user_id=$1',[id]);await engine.cancelUser(id);await store.audit(null,'USER_SESSIONS_REVOKED',{userId:id});return {revoked:true};
  });
  app.get('/api/admin/sessions',async request=>{owner(request);return (await store.db.query('SELECT id,user_id,remote,user_agent,created_at,last_active_at,expires_at FROM sessions WHERE expires_at>now() ORDER BY created_at DESC')).map(r=>row(r));});
  app.post('/api/admin/sessions/:id/revoke',async request=>{owner(request);await store.db.query('DELETE FROM sessions WHERE id=$1',[routeId(request)]);return {revoked:true};});
  app.get('/api/admin/tasks',async request=>{owner(request);return (await store.db.query("SELECT id,user_id,status,created_at,updated_at,calls_used FROM tasks WHERE status NOT IN ('completed','cancelled','failed') ORDER BY created_at")).map(r=>row(r));});
  app.post('/api/admin/remote/stop',async request=>{owner(request);const users=await store.db.query("SELECT id FROM users WHERE role<>'owner'");for(const user of users)await engine.cancelUser(String(user.id));return {stopped:true};});
  const remoteState=()=>{const config=remoteControl?.config??remote;return {enabled:remoteControl?remoteControl.enabled&&remoteControl.listening:!!remote,configured:!!config,listening:remoteControl?.listening??!!remote,publicOrigin:config?.publicOrigin??null,hostName:hostname(),gatewayPort:config?.port??4318,authentication:'Cloudflare Access signed application identity',requiresSetup:!config,localAccessIndependent:true};};
  app.get('/api/admin/remote',async request=>{owner(request);return remoteState();});
  app.post('/api/admin/remote/enabled',async request=>{
    owner(request);const {enabled}=z.object({enabled:z.boolean()}).parse(request.body);
    if(!remoteControl?.config||!remoteControl.listening)throw new AppError('REMOTE_NOT_CONFIGURED','Configure and start the authenticated gateway before enabling remote access.',409);
    remoteControl.enabled=enabled;
    if(!enabled){await store.db.query('DELETE FROM sessions WHERE remote=true');const users=await store.db.query("SELECT id FROM users WHERE role<>'owner'");for(const user of users)await engine.cancelUser(String(user.id));}
    await store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['remote_enabled',JSON.stringify(enabled)]);
    await store.audit(null,'REMOTE_ACCESS_CHANGED',{enabled});return remoteState();
  });
}
