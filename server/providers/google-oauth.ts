import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import type { Principal } from '../auth/policy.js';
import { AppError } from '../core/errors.js';

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/generative-language.retriever'];
const CONFIG_KEY = 'google-oauth';
const configSchema = z.object({ revision:z.uuid(), clientId:z.string().regex(/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/), quotaProject:z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/), sharedQuotaAccepted:z.literal(true) }).strict();
const tokenSchema = z.object({ revision:z.string(), refreshToken:z.string().min(1).max(8192), subject:z.string().min(1).max(255) }).strict();
type Config = z.infer<typeof configSchema>;
interface Pending { userId:string; sessionId:string; version:number; expires:number; verifier:string; nonce:string; redirect:string; revision:string; generation:number }
export interface GoogleVault { get(key:string):Promise<string|null>; set(key:string,value:string):Promise<void>; remove(key:string):Promise<void> }
/** Separate OS-vault namespace, no plaintext fallback or inherited environment. */
export class GoogleKeyring implements GoogleVault {
  private async entry(key:string) { const module=await import('@napi-rs/keyring'); const Entry=module.AsyncEntry; return new Entry('relay-local.google-oauth',key,{linux:{store:'secret-service'}}); }
  async get(key:string):Promise<string|null> { try { return await (await this.entry(key)).getPassword()??null; } catch { throw new AppError('GOOGLE_VAULT','Google connection needs an available OS credential vault.',503); } }
  async set(key:string,value:string) { try { await (await this.entry(key)).setPassword(value); } catch { throw new AppError('GOOGLE_VAULT','The OS credential vault could not save the Google connection.',503); } }
  async remove(key:string) { try { const entry=await this.entry(key); if(await entry.getPassword())await entry.deletePassword(); } catch { throw new AppError('GOOGLE_VAULT','OS credential removal could not be confirmed.',503); } }
}
interface Options { allowedOrigins:()=>Promise<string[]>; vault?:GoogleVault; fetch?:typeof fetch; now?:()=>number; verifyIdentity?:(token:string,clientId:string)=>Promise<JWTPayload>; }
export async function verifyGoogleIdentity(token:string,clientId:string,keys:JWTVerifyGetKey):Promise<JWTPayload> {
  try{return (await jwtVerify(token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,algorithms:['RS256'],maxTokenAge:'10m'})).payload;}
  catch{throw new AppError('GOOGLE_IDENTITY','Google identity verification failed.',401);}
}
export class GoogleOAuth {
  private readonly vault:GoogleVault; private readonly fetcher:typeof fetch; private readonly now:()=>number;
  private readonly pending=new Map<string,Pending>(); private readonly revisions=new Map<string,number>();
  private readonly cached=new Map<string,{token:string;expires:number;revision:string;generation:number}>();
  private readonly queues=new Map<string,Promise<unknown>>(); private configQueue:Promise<unknown>=Promise.resolve();
  private readonly blocked=new Set<string>();
  private readonly jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'),{timeoutDuration:5000});
  constructor(private readonly store:Store,private readonly options:Options) { this.vault=options.vault??new GoogleKeyring();this.fetcher=options.fetch??fetch;this.now=options.now??Date.now; }
  private key(userId:string) { return `user.${createHash('sha256').update(userId).digest('hex')}`; }
  private async choice(userId:string):Promise<string|undefined> {return (await this.store.db.query('SELECT value FROM settings WHERE key=$1',[`google-choice.${this.key(userId)}`]))[0]?.value as string|undefined;}
  private async saveChoice(userId:string,value:'google'|'disconnected'|'api_key') {await this.store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[`google-choice.${this.key(userId)}`,JSON.stringify(value)]);}
  /** Only an explicit successful API-key connection may switch away from OAuth. */
  async useApiKey(userId:string):Promise<void> {this.invalidate(userId);await this.serial(userId,()=>this.saveChoice(userId,'api_key'));}
  private generation(userId:string) { return this.revisions.get(userId)??0; }
  private assert(userId:string,generation:number) { if(this.generation(userId)!==generation)throw new AppError('GOOGLE_REVOKED','Google connection changed; reconnect to continue.',409); }
  private serial<T>(userId:string,work:()=>Promise<T>):Promise<T> { const next=(this.queues.get(userId)??Promise.resolve()).catch(()=>{}).then(work);this.queues.set(userId,next);void next.finally(()=>{if(this.queues.get(userId)===next)this.queues.delete(userId);}).catch(()=>{});return next; }
  private async config():Promise<Config|null> { const record=(await this.store.db.query('SELECT value FROM settings WHERE key=$1',[CONFIG_KEY]))[0];return record?configSchema.parse(record.value):null; }
  async configuration() { const config=await this.config();return {configured:!!config,clientId:config?.clientId??null,quotaProject:config?.quotaProject??null,origins:await this.origins()}; }
  private async origins() { return [...new Set(await this.options.allowedOrigins())].filter(origin=>{try{const url=new URL(origin);return url.origin===origin&&(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)||url.protocol==='https:'&&!/^(?:\d+\.){3}\d+$/.test(url.hostname)&&!url.hostname.includes(':'));}catch{return false;}}).slice(0,4); }
  async configure(input:unknown):Promise<void> {
    const body=z.object({clientId:configSchema.shape.clientId,clientSecret:z.string().min(8).max(2048).regex(/^[^\s\x00-\x1f]+$/),quotaProject:configSchema.shape.quotaProject,sharedQuotaAccepted:z.literal(true)}).strict().parse(input);
    const run=this.configQueue.catch(()=>{}).then(async()=>{
      const revision=randomUUID(); const config=configSchema.parse({clientId:body.clientId,quotaProject:body.quotaProject,sharedQuotaAccepted:body.sharedQuotaAccepted,revision});
      // Build the public record explicitly: clientSecret never enters PostgreSQL.
      await this.vault.set(`app.${revision}`,body.clientSecret);
      const previous=await this.config();
      await this.store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[CONFIG_KEY,JSON.stringify({revision,clientId:config.clientId,quotaProject:config.quotaProject,sharedQuotaAccepted:true})]);
      this.pending.clear();this.cached.clear();for(const user of this.revisions.keys())this.revisions.set(user,this.generation(user)+1);
      if(previous)await this.vault.remove(`app.${previous.revision}`);
    });this.configQueue=run;await run;
  }
  async status(userId:string) { const config=await this.config(),choice=await this.choice(userId);const saved=config&&!this.blocked.has(userId)&&choice!=='api_key'&&choice!=='disconnected'?await this.vault.get(this.key(userId)):null;let connected=false;
    if(saved){const parsed=tokenSchema.safeParse(JSON.parse(saved));connected=parsed.success&&parsed.data.revision===config?.revision;}
    return {configured:!!config,connected,quotaProject:config?.quotaProject??null,origins:await this.origins(),storage:connected?'os-keyring':'none'};
  }
  async start(principal:Principal,origin:string) {
    const config=await this.config();if(!config)throw new AppError('GOOGLE_SETUP','The host owner must configure the Google connection first.',409);
    if(!(await this.origins()).includes(origin))throw new AppError('GOOGLE_ORIGIN','Google sign-in requires the configured public URL or the owner localhost URL; raw LAN addresses are not supported.',400);
    for(const [state,pending]of this.pending)if(pending.expires<=this.now()||pending.userId===principal.user.id)this.pending.delete(state);
    if(this.pending.size>=100)throw new AppError('GOOGLE_BUSY','Too many Google sign-ins are pending. Try again shortly.',429);
    const state=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url');
    const redirect=origin+'/?relay_google=1',generation=this.generation(principal.user.id);this.revisions.set(principal.user.id,generation);
    this.pending.set(state,{userId:principal.user.id,sessionId:principal.sessionId,version:principal.user.sessionVersion,expires:this.now()+300000,verifier,nonce,redirect,revision:config.revision,generation});
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,redirect_uri:redirect,response_type:'code',scope:GOOGLE_SCOPES.join(' '),state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'}).toString();return {url:url.toString()};
  }
  private async token(body:Record<string,string>):Promise<Record<string,unknown>> {
    let response:Response;try{response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body),signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new AppError('GOOGLE_UNAVAILABLE','Google token service is unavailable. Try connecting again.',503);}
    if(!response.ok){await response.body?.cancel();throw new AppError('GOOGLE_AUTH','Google authorization failed or expired. Reconnect your account.',401);}
    const reader=response.body?.getReader();if(!reader)throw new AppError('GOOGLE_AUTH','Google returned an empty authorization response.',502);
    const chunks:Uint8Array[]=[];let size=0;try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>65536)throw new Error();chunks.push(item.value);}return z.record(z.string(),z.unknown()).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{await reader.cancel().catch(()=>{});throw new AppError('GOOGLE_AUTH','Google returned an invalid authorization response.',502);}finally{reader.releaseLock();}
  }
  private async identity(token:string,clientId:string) { try{return this.options.verifyIdentity?await this.options.verifyIdentity(token,clientId):await verifyGoogleIdentity(token,clientId,this.jwks);}catch{throw new AppError('GOOGLE_IDENTITY','Google identity verification failed.',401);} }
  async complete(principal:Principal,input:{state:string;code?:string;error?:string},live:()=>Promise<boolean>):Promise<void> {
    const pending=this.pending.get(input.state);
    if(!pending||pending.expires<=this.now()||pending.userId!==principal.user.id||pending.sessionId!==principal.sessionId||pending.version!==principal.user.sessionVersion)throw new AppError('GOOGLE_STATE','Sign-in expired or belongs to another browser session. Start again.',400);
    this.pending.delete(input.state);
    if(input.error||!input.code)throw new AppError('GOOGLE_DENIED','Google connection was not authorized.',400);
    await this.serial(principal.user.id,async()=>{
      this.assert(principal.user.id,pending.generation);if(!await live())throw new AppError('GOOGLE_REVOKED','Your Relay session was revoked.',401);
      const config=await this.config();if(config?.revision!==pending.revision)throw new AppError('GOOGLE_SETUP','Google application settings changed. Start sign-in again.',409);
      const secret=await this.vault.get(`app.${config.revision}`);if(!secret)throw new AppError('GOOGLE_SETUP','Google application secret is unavailable.',503);
      const tokens=await this.token({grant_type:'authorization_code',code:input.code!,redirect_uri:pending.redirect,client_id:config.clientId,client_secret:secret,code_verifier:pending.verifier});
      const parsed=z.object({access_token:z.string().min(1).max(8192),refresh_token:z.string().min(1).max(8192),id_token:z.string().min(1).max(16384),expires_in:z.number().int().min(1).max(86400),scope:z.string(),token_type:z.literal('Bearer')}).parse(tokens);
      const scopes=new Set(parsed.scope.split(' '));if(!GOOGLE_SCOPES.every(scope=>scopes.has(scope)||scope==='email'&&scopes.has('https://www.googleapis.com/auth/userinfo.email')))throw new AppError('GOOGLE_SCOPE','Google did not grant the required Gemini and identity permissions.',403);
      const identity=await this.identity(parsed.id_token,config.clientId);if(identity.nonce!==pending.nonce||!identity.sub||identity.azp&&identity.azp!==config.clientId)throw new AppError('GOOGLE_IDENTITY','Google identity did not match this sign-in request.',401);
      this.assert(principal.user.id,pending.generation);if(!await live()||(await this.config())?.revision!==config.revision)throw new AppError('GOOGLE_REVOKED','Connection was revoked before it completed.',401);
      await this.vault.set(this.key(principal.user.id),JSON.stringify({revision:config.revision,refreshToken:parsed.refresh_token,subject:identity.sub}));
      this.assert(principal.user.id,pending.generation);await this.saveChoice(principal.user.id,'google');this.assert(principal.user.id,pending.generation);this.blocked.delete(principal.user.id);this.cached.set(principal.user.id,{token:parsed.access_token,expires:this.now()+parsed.expires_in*1000,revision:config.revision,generation:pending.generation});
    });
  }
  async headers(userId:string):Promise<Record<string,string>|null> {
    return this.serial(userId,async()=>{
      const generation=this.generation(userId),choice=await this.choice(userId);if(choice==='api_key')return null;
      if(choice==='disconnected'||this.blocked.has(userId))throw new AppError('GOOGLE_DISCONNECTED','Connect Google again or explicitly choose an API key for Gemini.',401);
      const config=await this.config();if(!config){if(choice==='google')throw new AppError('GOOGLE_SETUP','Google application settings are unavailable.',503);return null;}
      const saved=await this.vault.get(this.key(userId));if(!saved){if(choice==='google')throw new AppError('GOOGLE_RECONNECT','Google credentials are unavailable. Reconnect your account.',401);return null;}const record=tokenSchema.parse(JSON.parse(saved));
      if(record.revision!==config.revision)throw new AppError('GOOGLE_RECONNECT','Google application settings changed. Reconnect your account.',401);
      let cached=this.cached.get(userId);
      if(!cached||cached.generation!==generation||cached.revision!==config.revision||cached.expires<=this.now()+60000){
        const secret=await this.vault.get(`app.${config.revision}`);if(!secret)throw new AppError('GOOGLE_SETUP','Google application secret is unavailable.',503);
        const tokens=await this.token({grant_type:'refresh_token',refresh_token:record.refreshToken,client_id:config.clientId,client_secret:secret});
        const parsed=z.object({access_token:z.string().min(1).max(8192),expires_in:z.number().int().min(1).max(86400),token_type:z.literal('Bearer'),scope:z.string().optional()}).parse(tokens);
        if(parsed.scope&&!parsed.scope.split(' ').includes(GOOGLE_SCOPES[2]))throw new AppError('GOOGLE_SCOPE','Gemini authorization was removed.',403);
        cached={token:parsed.access_token,expires:this.now()+parsed.expires_in*1000,revision:config.revision,generation};
      }
      this.assert(userId,generation);if((await this.config())?.revision!==config.revision)throw new AppError('GOOGLE_REVOKED','Google configuration changed.',409);
      this.cached.set(userId,cached);return {authorization:`Bearer ${cached.token}`,'x-goog-user-project':config.quotaProject};
    });
  }
  invalidate(userId:string) { this.revisions.set(userId,this.generation(userId)+1);this.cached.delete(userId);for(const[state,pending]of this.pending)if(pending.userId===userId)this.pending.delete(state); }
  async disconnect(userId:string):Promise<{revoked:boolean}> {
    this.invalidate(userId);this.blocked.add(userId);
    return this.serial(userId,async()=>{await this.saveChoice(userId,'disconnected');const saved=await this.vault.get(this.key(userId));await this.vault.remove(this.key(userId));if(!saved)return {revoked:true};
      const record=tokenSchema.parse(JSON.parse(saved));try{const response=await this.fetcher('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:record.refreshToken}),signal:AbortSignal.timeout(10000),redirect:'error'});await response.body?.cancel();return {revoked:response.ok};}catch{return {revoked:false};}
    });
  }
}
