import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRemoteJWKSet,type JWTPayload} from 'jose';
import {z} from 'zod';
import type {Store} from '../db/store.js';
import type {Sql} from '../db/database.js';
import {authorizeOwner,type Principal} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import {verifyGoogleIdentity} from '../providers/google-oauth.js';

export const WORKSPACE_SCOPES=['openid','https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/calendar.events.readonly','https://www.googleapis.com/auth/calendar.freebusy'];
export interface WorkspaceVault {get(key:string):Promise<string|null>;set(key:string,value:string):Promise<void>;remove(key:string):Promise<void>;}
export interface WorkspaceActor {principal:Principal;live:()=>Promise<boolean>;signal?:AbortSignal;}
interface Options {allowedOrigins:()=>Promise<string[]>;vault?:WorkspaceVault;fetch?:typeof fetch;now?:()=>number;verifyIdentity?:(token:string,clientId:string)=>Promise<JWTPayload>;}
const configKey='google-workspace';
const clientId=z.string().regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/);
const configSchema=z.object({revision:z.uuid(),clientId,separateProjectAccepted:z.literal(true)}).strict();
const configureSchema=z.object({clientId,clientSecret:z.string().min(8).max(2048).regex(/^[^\s\x00-\x1f]+$/),separateProjectAccepted:z.literal(true)}).strict();
const grantSchema=z.object({connected:z.boolean(),revision:z.uuid(),epoch:z.uuid(),sessionVersion:z.number().int().nonnegative()}).strict();
const secretSchema=z.object({refreshToken:z.string().min(1).max(8192),subject:z.string().min(1).max(255)}).strict();
type Config=z.infer<typeof configSchema>;type Grant=z.infer<typeof grantSchema>;
interface Pending {userId:string;sessionId:string;sessionVersion:number;revision:string;generation:number;verifier:string;nonce:string;redirect:string;expires:number;}
const messageId=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const calendarId=z.string().min(1).max(256).regex(/^[^\x00-\x20\x7f]+$/);
const windowShape={timeMin:z.iso.datetime({offset:true}),timeMax:z.iso.datetime({offset:true})};
const validWindow=(value:{timeMin:string;timeMax:string})=>{const duration=Date.parse(value.timeMax)-Date.parse(value.timeMin);return duration>0&&duration<=31*86400000;};
const searchSchema=z.object({query:z.string().max(1000).default(''),maxResults:z.number().int().min(1).max(20).default(10),pageToken:z.string().max(2048).optional()}).strict();
const eventsSchema=z.object({...windowShape,calendarId:calendarId.default('primary'),maxResults:z.number().int().min(1).max(50).default(20),pageToken:z.string().max(2048).optional()}).strict().refine(validWindow,'Calendar window must be positive and at most 31 days.');
const freeBusySchema=z.object({...windowShape,calendarIds:z.array(calendarId).min(1).max(10).default(['primary'])}).strict().refine(validWindow,'Calendar window must be positive and at most 31 days.');
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const list=(value:unknown):unknown[]=>Array.isArray(value)?value:[];
const text=(value:unknown,max=2000)=>typeof value==='string'?value.slice(0,max):'';
function denied(code:string,message:string,status=409):never {throw new AppError(code,message,status);}
class WorkspaceKeyring implements WorkspaceVault {
  private async entry(key:string){const {AsyncEntry}=await import('@napi-rs/keyring');return new AsyncEntry('relay-local.google-workspace',key,{linux:{store:'secret-service'}});}
  async get(key:string){try{return await(await this.entry(key)).getPassword()??null;}catch{denied('WORKSPACE_VAULT','Google Workspace requires an available OS credential vault.',503);}}
  async set(key:string,value:string){try{await(await this.entry(key)).setPassword(value);}catch{denied('WORKSPACE_VAULT','Could not save Google Workspace credentials in the OS vault.',503);}}
  async remove(key:string){try{const entry=await this.entry(key);if(await entry.getPassword())await entry.deletePassword();}catch{denied('WORKSPACE_VAULT','OS credential removal could not be confirmed.',503);}}
}
interface Operation {config:Config;grant:Grant;generation:number;token:string;signal:AbortSignal;}

/** Separate consent, durable grants and OS namespace from Gemini. No write API. */
export class GoogleWorkspace {
  private readonly vault:WorkspaceVault;private readonly fetcher:typeof fetch;private readonly now:()=>number;
  private readonly pending=new Map<string,Pending>();private readonly generations=new Map<string,number>();private readonly controllers=new Map<string,AbortController>();
  private readonly queues=new Map<string,{tail:Promise<unknown>;count:number}>();private configQueue:Promise<unknown>=Promise.resolve();
  private readonly cached=new Map<string,{epoch:string;token:string;expires:number}>();
  private readonly jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
  constructor(private readonly store:Store,private readonly options:Options){this.vault=options.vault??new WorkspaceKeyring();this.fetcher=options.fetch??fetch;this.now=options.now??Date.now;}
  captureReadAuthorization(id:string):()=>void {const generation=this.generation(id);return ()=>{if(this.generation(id)!==generation)denied('WORKSPACE_REVOKED','Google Workspace authorization changed while this read was queued.');};}
  private userKey(id:string){return `user.${createHash('sha256').update(id).digest('hex')}`;}
  private grantKey(id:string){return `${configKey}.${this.userKey(id)}`;}
  private tokenKey(id:string,grant:Grant){return `${this.userKey(id)}.${grant.epoch}`;}
  private generation(id:string){return this.generations.get(id)??0;}
  private controller(id:string){let value=this.controllers.get(id);if(!value){value=new AbortController();this.controllers.set(id,value);}return value;}
  private invalidate(id:string){this.generations.set(id,this.generation(id)+1);this.controllers.get(id)?.abort();this.controllers.delete(id);this.cached.delete(id);for(const[state,pending]of this.pending)if(pending.userId===id)this.pending.delete(state);}
  private serial<T>(id:string,work:()=>Promise<T>):Promise<T>{
    const current=this.queues.get(id);if((current?.count??0)>=16||!current&&this.queues.size>=100)denied('WORKSPACE_BUSY','Too many Google Workspace requests are pending.',429);
    const entry=current??{tail:Promise.resolve(),count:0};entry.count++;const next=entry.tail.catch(()=>{}).then(work);entry.tail=next;this.queues.set(id,entry);
    void next.finally(()=>{entry.count--;if(entry.count===0&&this.queues.get(id)===entry)this.queues.delete(id);}).catch(()=>{});return next;
  }
  private async authorize(actor:WorkspaceActor,sql:Sql=this.store.db,lock=false){
    if(actor.signal?.aborted)denied('WORKSPACE_REVOKED','The request was cancelled.',409);
    const user=(await sql.query(`SELECT enabled,registration_status,role,session_version FROM users WHERE id=$1${lock?' FOR UPDATE':''}`,[actor.principal.user.id]))[0];
    if(!user||user.enabled!==true||user.registration_status!=='approved'||Number(user.session_version)!==actor.principal.user.sessionVersion)denied('WORKSPACE_REVOKED','Your Relay account session is no longer authorized.',401);
    // actor.live() uses the outer Database connection in production. Calling it
    // from a PGlite transaction would wait on this very transaction forever.
    const live=lock?!!(await sql.query('SELECT id FROM sessions WHERE id=$1 AND user_id=$2 AND version=$3 AND remote=$4 AND expires_at>clock_timestamp() FOR SHARE',[actor.principal.sessionId,actor.principal.user.id,actor.principal.user.sessionVersion,actor.principal.remote]))[0]:await actor.live();
    if(!live)denied('WORKSPACE_REVOKED','Your Relay account session is no longer authorized.',401);
    return user;
  }
  private async config(sql:Sql=this.store.db):Promise<Config|null>{const value=(await sql.query('SELECT value FROM settings WHERE key=$1',[configKey]))[0]?.value;if(value===undefined)return null;const parsed=configSchema.safeParse(value);if(!parsed.success)denied('WORKSPACE_SETUP','Google Workspace configuration must be reviewed by the host owner.');return parsed.data;}
  private async grant(id:string,sql:Sql=this.store.db):Promise<Grant|null>{const value=(await sql.query('SELECT value FROM settings WHERE key=$1',[this.grantKey(id)]))[0]?.value;const parsed=grantSchema.safeParse(value);return parsed.success?parsed.data:null;}
  private async saveGrant(id:string,grant:Grant,sql:Sql=this.store.db){await sql.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[this.grantKey(id),JSON.stringify(grant)]);}
  private async origins(){return [...new Set(await this.options.allowedOrigins())].filter(origin=>{try{const url=new URL(origin);return url.origin===origin&&!url.username&&!url.password&&(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)||url.protocol==='https:'&&!/^(?:\d+\.){3}\d+$/.test(url.hostname)&&!url.hostname.includes(':'));}catch{return false;}}).slice(0,4);}
  async configuration(){const config=await this.config();return {configured:!!config,clientId:config?.clientId??null,origins:await this.origins(),callbackPath:'/?relay_workspace=1',readOnly:true,scopes:[...WORKSPACE_SCOPES],separateProjectAcknowledged:config?.separateProjectAccepted===true};}
  async configure(actor:WorkspaceActor,input:unknown){
    authorizeOwner(actor.principal);const body=configureSchema.parse(input);
    const run=this.configQueue.catch(()=>{}).then(async()=>{
      await this.authorize(actor);const gemini=(await this.store.db.query("SELECT value FROM settings WHERE key='google-oauth'"))[0]?.value;
      if(object(gemini).clientId===body.clientId)denied('WORKSPACE_SEPARATE_PROJECT','Use a separate Google Cloud project and OAuth client from Gemini.');
      const config:Config={revision:randomUUID(),clientId:body.clientId,separateProjectAccepted:true};await this.vault.set(`app.${config.revision}`,body.clientSecret);
      const previous=await this.config();try{await this.authorize(actor);await this.store.db.transaction(async tx=>{const user=await this.authorize(actor,tx,true);if(user.role!=='owner')denied('OWNER_ONLY','Only the local owner may configure this application.',403);await tx.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[configKey,JSON.stringify(config)]);await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('GOOGLE_WORKSPACE_CONFIGURED',$1)",[JSON.stringify({userId:actor.principal.user.id,separateProjectAcknowledged:true,readOnly:true})]);});}catch(error){await this.vault.remove(`app.${config.revision}`).catch(()=>{});throw error;}
      for(const id of new Set([...this.controllers.keys(),...this.cached.keys(),...this.pending.values()].map(value=>typeof value==='string'?value:value.userId)))this.invalidate(id);this.pending.clear();this.cached.clear();
      if(previous)await this.vault.remove(`app.${previous.revision}`);
      await this.authorize(actor);
    });this.configQueue=run;await run;
  }
  async status(actor:WorkspaceActor){await this.authorize(actor);const config=await this.config(),grant=await this.grant(actor.principal.user.id);let connected=false;
    if(config&&grant?.connected&&grant.revision===config.revision&&grant.sessionVersion===actor.principal.user.sessionVersion){const saved=await this.vault.get(this.tokenKey(actor.principal.user.id,grant));if(saved){try{connected=secretSchema.safeParse(JSON.parse(saved)).success;}catch{/* unavailable */}}}
    return {configured:!!config,connected,readOnly:true,storage:connected?'os-keyring':'none',scopes:[...WORKSPACE_SCOPES]};
  }
  async start(actor:WorkspaceActor,input:unknown){
    await this.authorize(actor);const {origin}=z.object({origin:z.string().max(300)}).strict().parse(input),config=await this.config();if(!config)denied('WORKSPACE_SETUP','The host owner must configure a Google Workspace application first.');if(!(await this.origins()).includes(origin))denied('WORKSPACE_ORIGIN','Use the configured browser origin for Google Workspace sign-in.',400);
    const id=actor.principal.user.id;for(const[state,value]of this.pending)if(value.expires<=this.now()||value.userId===id)this.pending.delete(state);if(this.pending.size>=100)denied('WORKSPACE_BUSY','Too many sign-ins are pending.',429);
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),redirect=origin+'/?relay_workspace=1';
    this.pending.set(state,{userId:id,sessionId:actor.principal.sessionId,sessionVersion:actor.principal.user.sessionVersion,revision:config.revision,generation:this.generation(id),verifier,nonce,redirect,expires:this.now()+300000});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirect,response_type:'code',scope:WORKSPACE_SCOPES.join(' '),state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false'}).toString();return {url:url.toString()};
  }
  private signal(actor:WorkspaceActor){return AbortSignal.any([AbortSignal.timeout(30000),this.controller(actor.principal.user.id).signal,...actor.signal?[actor.signal]:[]]);}
  private async json(url:string,init:RequestInit,signal:AbortSignal,max=1024*1024):Promise<Record<string,unknown>>{
    let response:Response;try{response=await this.fetcher(url,{...init,signal,redirect:'error',cache:'no-store'});}catch{if(signal.aborted)denied('WORKSPACE_REVOKED','Google Workspace request was cancelled or timed out.');denied('WORKSPACE_UPSTREAM','Google Workspace is unavailable.',502);}
    if(signal.aborted){await response.body?.cancel();denied('WORKSPACE_REVOKED','Google Workspace request was revoked.');}
    if(!response.ok){await response.body?.cancel();denied('WORKSPACE_UPSTREAM',response.status===401||response.status===403?'Google Workspace access was rejected. Review consent or reconnect.':'Google Workspace could not complete this read.',502);}
    const reader=response.body?.getReader();if(!reader)denied('WORKSPACE_RESPONSE','Google returned an empty response.',502);const chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const chunk=await reader.read();if(chunk.done)break;if(signal.aborted)denied('WORKSPACE_REVOKED','Google Workspace request was revoked.');bytes+=chunk.value.byteLength;if(bytes>max)denied('WORKSPACE_RESPONSE','Google response exceeded its bounded size.',502);chunks.push(chunk.value);}return z.record(z.string(),z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){await reader.cancel().catch(()=>{});if(error instanceof AppError)throw error;denied('WORKSPACE_RESPONSE','Google returned an invalid response.',502);}finally{reader.releaseLock();}
  }
  private checkScopes(value:unknown){const scopes=typeof value==='string'?new Set(value.split(/\s+/)):new Set<string>();if(!WORKSPACE_SCOPES.every(scope=>scopes.has(scope))||[...scopes].some(scope=>!WORKSPACE_SCOPES.includes(scope)))denied('WORKSPACE_SCOPE','Google did not grant exactly the requested read-only Workspace permissions.',403);}
  private async tokens(actor:WorkspaceActor,config:Config,body:Record<string,string>,signal:AbortSignal){await this.authorize(actor);const secret=await this.vault.get(`app.${config.revision}`);if(!secret)denied('WORKSPACE_SETUP','The Workspace application secret is unavailable.',503);return this.json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:config.clientId,client_secret:secret})},signal,65536);}
  async complete(actor:WorkspaceActor,input:unknown){
    const body=z.object({state:z.string().min(1).max(128),code:z.string().min(1).max(4096).optional(),error:z.string().max(128).optional()}).strict().parse(input),pending=this.pending.get(body.state),id=actor.principal.user.id;
    if(!pending||pending.expires<=this.now()||pending.userId!==id||pending.sessionId!==actor.principal.sessionId||pending.sessionVersion!==actor.principal.user.sessionVersion)denied('WORKSPACE_STATE','Sign-in expired or belongs to another Relay session.',400);this.pending.delete(body.state);if(body.error||!body.code)denied('WORKSPACE_DENIED','Google Workspace connection was not authorized.',400);
    return this.serial(id,async()=>{
      await this.authorize(actor);const config=await this.config();if(config?.revision!==pending.revision||this.generation(id)!==pending.generation)denied('WORKSPACE_REVOKED','Workspace application or account connection changed.');const signal=this.signal(actor);
      const raw=await this.tokens(actor,config,{grant_type:'authorization_code',code:body.code!,redirect_uri:pending.redirect,code_verifier:pending.verifier},signal);
      const parsed=z.object({access_token:z.string().min(1).max(8192),refresh_token:z.string().min(1).max(8192),id_token:z.string().min(1).max(16384),expires_in:z.number().int().min(1).max(86400),scope:z.string(),token_type:z.literal('Bearer')}).safeParse(raw);if(!parsed.success)denied('WORKSPACE_RESPONSE','Google did not return a usable offline authorization.',502);this.checkScopes(parsed.data.scope);
      let identity:JWTPayload;try{identity=this.options.verifyIdentity?await this.options.verifyIdentity(parsed.data.id_token,config.clientId):await verifyGoogleIdentity(parsed.data.id_token,config.clientId,this.jwks);}catch{denied('WORKSPACE_IDENTITY','Google Workspace identity verification failed.',502);}
      if(identity.nonce!==pending.nonce||!identity.sub||identity.azp&&identity.azp!==config.clientId)denied('WORKSPACE_IDENTITY','Google identity did not match this authorization.',502);
      const previous=await this.grant(id),grant:Grant={connected:true,revision:config.revision,epoch:randomUUID(),sessionVersion:actor.principal.user.sessionVersion},key=this.tokenKey(id,grant);
      await this.authorize(actor);if(signal.aborted||this.generation(id)!==pending.generation||(await this.config())?.revision!==config.revision)denied('WORKSPACE_REVOKED','Workspace connection changed before authorization completed.');
      await this.vault.set(key,JSON.stringify({refreshToken:parsed.data.refresh_token,subject:identity.sub}));
      try{await this.authorize(actor);await this.store.db.transaction(async tx=>{await this.authorize(actor,tx,true);if(signal.aborted||this.generation(id)!==pending.generation||(await this.config(tx))?.revision!==config.revision)denied('WORKSPACE_REVOKED','Workspace connection was revoked.');await this.saveGrant(id,grant,tx);await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('GOOGLE_WORKSPACE_CONNECTED',$1)",[JSON.stringify({userId:id,readOnly:true})]);});}catch(error){await this.vault.remove(key).catch(()=>{});throw error;}
      if(previous)await this.vault.remove(this.tokenKey(id,previous));this.cache(id,grant.epoch,parsed.data.access_token,parsed.data.expires_in);await this.guard(actor,{config,grant,generation:pending.generation,signal,token:parsed.data.access_token});
    });
  }
  private cache(id:string,epoch:string,token:string,seconds:number){if(this.cached.size>=200&&!this.cached.has(id))this.cached.delete(this.cached.keys().next().value!);this.cached.set(id,{epoch,token,expires:this.now()+seconds*1000});}
  private async guard(actor:WorkspaceActor,operation:Operation){await this.authorize(actor);const grant=await this.grant(actor.principal.user.id);if(operation.signal.aborted||this.generation(actor.principal.user.id)!==operation.generation||(await this.config())?.revision!==operation.config.revision||!grant?.connected||grant.epoch!==operation.grant.epoch||grant.sessionVersion!==actor.principal.user.sessionVersion)denied('WORKSPACE_REVOKED','Google Workspace authorization changed during this request.');}
  private async run<T>(actor:WorkspaceActor,work:(operation:Operation)=>Promise<T>):Promise<T>{
    const id=actor.principal.user.id,queuedGeneration=this.generation(id);return this.serial(id,async()=>{
      if(this.generation(id)!==queuedGeneration)denied('WORKSPACE_REVOKED','Google Workspace authorization changed while this read was queued.');
      await this.authorize(actor);const config=await this.config(),grant=await this.grant(id);if(!config)denied('WORKSPACE_SETUP','Configure Google Workspace first.');if(!grant?.connected||grant.revision!==config.revision||grant.sessionVersion!==actor.principal.user.sessionVersion)denied('WORKSPACE_DISCONNECTED','Connect your own Google Workspace account first.');
      const operation:Operation={config,grant,generation:this.generation(id),signal:this.signal(actor),token:''};let cached=this.cached.get(id);
      if(!cached||cached.epoch!==grant.epoch||cached.expires<=this.now()+60000){
        const saved=await this.vault.get(this.tokenKey(id,grant));let secret:z.infer<typeof secretSchema>;try{secret=secretSchema.parse(JSON.parse(saved??''));}catch{denied('WORKSPACE_DISCONNECTED','Google Workspace credentials are unavailable. Reconnect.');}
        await this.guard(actor,operation);const raw=await this.tokens(actor,config,{grant_type:'refresh_token',refresh_token:secret.refreshToken},operation.signal),parsed=z.object({access_token:z.string().min(1).max(8192),expires_in:z.number().int().min(1).max(86400),token_type:z.literal('Bearer'),scope:z.string().optional()}).safeParse(raw);
        if(!parsed.success)denied('WORKSPACE_RESPONSE','Google refresh returned invalid authorization.',502);if(parsed.data.scope!==undefined)this.checkScopes(parsed.data.scope);await this.guard(actor,operation);this.cache(id,grant.epoch,parsed.data.access_token,parsed.data.expires_in);cached=this.cached.get(id)!;
      }
      operation.token=cached.token;await this.guard(actor,operation);const result=await work(operation);await this.guard(actor,operation);return result;
    });
  }
  private async read(actor:WorkspaceActor,operation:Operation,url:URL,body?:unknown){await this.guard(actor,operation);const data=await this.json(url.toString(),{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${operation.token}`,...body===undefined?{}:{'content-type':'application/json'}},...body===undefined?{}:{body:JSON.stringify(body)}},operation.signal);await this.guard(actor,operation);return data;}
  async disconnect(actor:WorkspaceActor){
    await this.authorize(actor);const id=actor.principal.user.id;this.invalidate(id);
    return this.serial(id,async()=>{await this.authorize(actor);const grant=await this.grant(id);if(!grant)return {revoked:true};await this.saveGrant(id,{...grant,connected:false});const key=this.tokenKey(id,grant),saved=await this.vault.get(key);await this.vault.remove(key);let revoked=!saved;
      if(saved){let token:string|undefined;try{token=secretSchema.parse(JSON.parse(saved)).refreshToken;}catch{/* local removal is authoritative */}if(token)try{const response=await this.fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000),redirect:'error'});revoked=response.ok;await response.body?.cancel();}catch{revoked=false;}}
      await this.store.audit(null,'GOOGLE_WORKSPACE_DISCONNECTED',{userId:id,revocationConfirmed:revoked});return {revoked};
    });
  }
  private headers(payload:unknown){const result:Record<string,string>={};for(const raw of list(object(payload).headers).slice(0,100)){const header=object(raw),name=text(header.name,100).toLowerCase();if(['from','to','subject','date'].includes(name)&&!Object.hasOwn(result,name))result[name]=text(header.value);}return result;}
  async searchMail(actor:WorkspaceActor,input:unknown){const body=searchSchema.parse(input);return this.run(actor,async operation=>{
    const url=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');url.search=new URLSearchParams({q:body.query,maxResults:String(body.maxResults),includeSpamTrash:'false',fields:'messages(id,threadId),nextPageToken,resultSizeEstimate',...body.pageToken?{pageToken:body.pageToken}:{}}).toString();const data=await this.read(actor,operation,url),messages=[];
    for(const raw of list(data.messages).slice(0,body.maxResults)){const item=object(raw),id=messageId.safeParse(item.id);if(!id.success)denied('WORKSPACE_RESPONSE','Google returned an invalid message identity.',502);const detail=new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id.data}`);detail.search=new URLSearchParams({format:'metadata',fields:'id,threadId,snippet,internalDate,payload/headers'}).toString();for(const name of ['From','To','Subject','Date'])detail.searchParams.append('metadataHeaders',name);const message=await this.read(actor,operation,detail);messages.push({id:id.data,threadId:text(message.threadId,128),snippet:text(message.snippet),headers:this.headers(message.payload)});}
    return {messages,nextPageToken:text(data.nextPageToken,2048)||null,limited:!!data.nextPageToken||list(data.messages).length>body.maxResults,untrusted:true};
  });}
  async readMail(actor:WorkspaceActor,input:unknown){const {id}=z.object({id:messageId}).strict().parse(input);return this.run(actor,async operation=>{
    const url=new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);url.searchParams.set('format','full');const data=await this.read(actor,operation,url);let bytes=0,nodes=0,truncated=false;const parts:string[]=[];
    const visit=(raw:unknown,depth:number)=>{if(depth>10||++nodes>100){truncated=true;return;}const part=object(raw);if(text(part.filename))return;if(part.mimeType==='text/plain'){const encoded=object(part.body).data;if(typeof encoded==='string'&&/^[A-Za-z0-9_-]*={0,2}$/.test(encoded)){const value=Buffer.from(encoded,'base64url'),remaining=65536-bytes;const content=value.subarray(0,Math.max(0,remaining));parts.push(content.toString('utf8'));bytes+=content.length;if(value.length>remaining)truncated=true;}}for(const child of list(part.parts)){if(bytes>=65536){truncated=true;break;}visit(child,depth+1);}};visit(data.payload,0);
    return {id,threadId:text(data.threadId,128),snippet:text(data.snippet),headers:this.headers(data.payload),text:parts.length?parts.join('\n'):null,bodyUnavailable:!parts.length,truncated,attachmentsExcluded:true,untrusted:true};
  });}
  async listEvents(actor:WorkspaceActor,input:unknown){const body=eventsSchema.parse(input);return this.run(actor,async operation=>{
    const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(body.calendarId)}/events`);url.search=new URLSearchParams({timeMin:body.timeMin,timeMax:body.timeMax,maxResults:String(body.maxResults),singleEvents:'true',orderBy:'startTime',showDeleted:'false',fields:'items(id,status,summary,description,location,start,end),nextPageToken',...body.pageToken?{pageToken:body.pageToken}:{}}).toString();const data=await this.read(actor,operation,url);
    const point=(value:unknown)=>({date:text(object(value).date,32)||null,dateTime:text(object(value).dateTime,80)||null,timeZone:text(object(value).timeZone,100)||null});
    return {calendarId:body.calendarId,events:list(data.items).slice(0,body.maxResults).map(raw=>{const event=object(raw);return {id:text(event.id,256),status:['confirmed','tentative','cancelled'].includes(String(event.status))?String(event.status):'unknown',summary:text(event.summary),description:text(event.description,4000),location:text(event.location),start:point(event.start),end:point(event.end)};}),nextPageToken:text(data.nextPageToken,2048)||null,limited:!!data.nextPageToken||list(data.items).length>body.maxResults,untrusted:true};
  });}
  async freeBusy(actor:WorkspaceActor,input:unknown){const body=freeBusySchema.parse(input);return this.run(actor,async operation=>{
    const ids=[...new Set(body.calendarIds)],data=await this.read(actor,operation,new URL('https://www.googleapis.com/calendar/v3/freeBusy'),{timeMin:body.timeMin,timeMax:body.timeMax,timeZone:'UTC',groupExpansionMax:1,calendarExpansionMax:10,items:ids.map(id=>({id}))});
    return {timeMin:body.timeMin,timeMax:body.timeMax,calendars:ids.map(id=>{const entry=object(object(data.calendars)[id]),busy=list(entry.busy),available=Object.hasOwn(object(data.calendars),id)&&!list(entry.errors).length&&Array.isArray(entry.busy)&&busy.length<=500;const periods=busy.map(raw=>{const item=object(raw),start=z.iso.datetime({offset:true}).safeParse(item.start),end=z.iso.datetime({offset:true}).safeParse(item.end);return start.success&&end.success&&Date.parse(end.data)>Date.parse(start.data)?{start:start.data,end:end.data}:null;});return {id,available:available&&periods.every(Boolean),busy:available&&periods.every(Boolean)?periods:null};}),untrusted:true};
  });}
}
