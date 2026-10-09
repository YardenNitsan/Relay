import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {GoogleOAuth,GOOGLE_SCOPES,verifyGoogleIdentity,type GoogleVault} from '../server/providers/google-oauth.js';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import type {Store} from '../server/db/store.js';
import {chatPermissions,type Principal} from '../server/auth/policy.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import {googleGenerateBody,googleGenerateStream} from '../server/providers/google-generate.js';
import {profile} from '../server/providers/registry.js';
import type {ModelChunk,ModelRequest} from '../shared/types.js';

const principal=(id='alice'):Principal=>({sessionId:`session-${id}`,remote:true,user:{id,name:id,email:null,role:'chat',enabled:true,permissions:{...chatPermissions,providers:['gemini','ollama']},sessionVersion:0,createdAt:new Date().toISOString(),lastActiveAt:null}});
const config={clientId:'123-example.apps.googleusercontent.com',clientSecret:'google-private-client-secret',quotaProject:'relay-project',sharedQuotaAccepted:true};
function harness() {
  const settings=new Map<string,unknown>(),secrets=new Map<string,string>();let now=100000;let nonce='';let scopes=GOOGLE_SCOPES.join(' ');let accessToken='google-access-one';let exchanges=0;
  const requests:{url:string;body:URLSearchParams}[]=[];
  const store={db:{query:async(sql:string,args:unknown[])=>{if(sql.startsWith('SELECT'))return settings.has(String(args[0]))?[{value:settings.get(String(args[0]))}]:[];settings.set(String(args[0]),JSON.parse(String(args[1])));return[];}}} as unknown as Store;
  const vault:GoogleVault={get:async key=>secrets.get(key)??null,set:async(key,value)=>{secrets.set(key,value);},remove:async key=>{secrets.delete(key);}};
  const fetcher:typeof fetch=async(url,init)=>{const body=new URLSearchParams(String(init?.body));requests.push({url:String(url),body});if(String(url).endsWith('/revoke'))return new Response('');exchanges++;return Response.json({access_token:accessToken,refresh_token:'private-refresh',id_token:'verified-injected-test-token',scope:scopes,token_type:'Bearer',expires_in:3600});};
  const service=new GoogleOAuth(store,{allowedOrigins:async()=>['http://127.0.0.1:4317','https://relay.example.com'],vault,fetch:fetcher,now:()=>now,verifyIdentity:async()=>({sub:'google-user',nonce})});
  const start=async(p=principal())=>{const result=await service.start(p,'https://relay.example.com');const url=new URL(result.url);nonce=url.searchParams.get('nonce')!;return url;};
  const connect=async(p=principal())=>{const url=await start(p);await service.complete(p,{state:url.searchParams.get('state')!,code:'one-use-code'},async()=>true);return url;};
  return {service,store,secrets,settings,requests,start,connect,vault,setNonce:(value:string)=>{nonce=value;},setScope:(value:string)=>{scopes=value;},advance:()=>{now+=3600000;accessToken='google-access-two';},exchanges:()=>exchanges};
}
describe('Google account authorization',()=>{
  it('verifies real OIDC signatures and rejects wrong issuer, audience and expired identities',async()=>{
    const keys=await generateKeyPair('RS256');const resolver=createLocalJWKSet({keys:[await exportJWK(keys.publicKey)]});
    const signed=(issuer:string,audience:string,expiry='2m')=>new SignJWT({nonce:'nonce'}).setProtectedHeader({alg:'RS256'}).setSubject('subject').setIssuedAt().setIssuer(issuer).setAudience(audience).setExpirationTime(expiry).sign(keys.privateKey);
    expect((await verifyGoogleIdentity(await signed('https://accounts.google.com',config.clientId),config.clientId,resolver)).sub).toBe('subject');
    for(const token of [await signed('https://attacker.example',config.clientId),await signed('https://accounts.google.com','other-client'),await signed('https://accounts.google.com',config.clientId,'-1s')])await expect(verifyGoogleIdentity(token,config.clientId,resolver)).rejects.toMatchObject({code:'GOOGLE_IDENTITY'});
  });
  it('requires owner application setup and explicit shared-quota acceptance',async()=>{
    const h=harness();await expect(h.start()).rejects.toMatchObject({code:'GOOGLE_SETUP'});
    await expect(h.service.configure({...config,sharedQuotaAccepted:false})).rejects.toThrow();
    await h.service.configure(config);expect(JSON.stringify([...h.settings])).not.toContain(config.clientSecret);expect([...h.secrets.values()]).toContain(config.clientSecret);
    expect(await h.service.status('alice')).toMatchObject({configured:true,connected:false,quotaProject:'relay-project'});
  });
  it('uses PKCE, random state/nonce and an exact approved callback',async()=>{
    const h=harness();await h.service.configure(config);const url=await h.connect();const exchange=h.requests[0].body;
    expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('redirect_uri')).toBe('https://relay.example.com/?relay_google=1');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url'));
    expect(exchange.get('client_secret')).toBe(config.clientSecret);expect(await h.service.status('alice')).toMatchObject({connected:true,storage:'os-keyring'});
    await expect(h.service.start(principal(),'https://10.0.0.8:4321')).rejects.toMatchObject({code:'GOOGLE_ORIGIN'});
  });
  it('binds callbacks to initiating user, browser session and session version',async()=>{
    const h=harness();await h.service.configure(config);const url=await h.start();const input={state:url.searchParams.get('state')!,code:'code'};
    for(const p of [principal('bob'),{...principal(),sessionId:'other-session'},{...principal(),user:{...principal().user,sessionVersion:1}}])await expect(h.service.complete(p,input,async()=>true)).rejects.toMatchObject({code:'GOOGLE_STATE'});
    expect(h.exchanges()).toBe(0);await h.service.complete(principal(),input,async()=>true);
    await expect(h.service.complete(principal(),input,async()=>true)).rejects.toMatchObject({code:'GOOGLE_STATE'});expect(h.exchanges()).toBe(1);
  });
  it('rejects expired, denied and insufficient-scope consent without saving credentials',async()=>{
    const h=harness();await h.service.configure(config);let url=await h.start();h.advance();await expect(h.service.complete(principal(),{state:url.searchParams.get('state')!,code:'code'},async()=>true)).rejects.toMatchObject({code:'GOOGLE_STATE'});
    url=await h.start();await expect(h.service.complete(principal(),{state:url.searchParams.get('state')!,error:'access_denied'},async()=>true)).rejects.toMatchObject({code:'GOOGLE_DENIED'});expect(h.exchanges()).toBe(0);
    h.setScope('openid email');await expect(h.connect()).rejects.toMatchObject({code:'GOOGLE_SCOPE'});expect((await h.service.status('alice')).connected).toBe(false);
  });
  it('rejects nonce substitution and revocation before exchange',async()=>{
    const h=harness();await h.service.configure(config);let url=await h.start();h.setNonce('wrong');await expect(h.service.complete(principal(),{state:url.searchParams.get('state')!,code:'code'},async()=>true)).rejects.toMatchObject({code:'GOOGLE_IDENTITY'});
    url=await h.start();await expect(h.service.complete(principal(),{state:url.searchParams.get('state')!,code:'code'},async()=>false)).rejects.toMatchObject({code:'GOOGLE_REVOKED'});
    expect((await h.service.status('alice')).connected).toBe(false);
  });
  it('partitions tokens per account and serializes refresh without storing access tokens',async()=>{
    const h=harness();await h.service.configure(config);await h.connect();expect(await h.service.headers('bob')).toBeNull();expect(JSON.stringify([...h.secrets])).not.toContain('google-access-one');
    h.advance();const headers=await Promise.all([h.service.headers('alice'),h.service.headers('alice'),h.service.headers('alice')]);
    expect(h.exchanges()).toBe(2);expect(headers).toEqual(Array(3).fill({authorization:'Bearer google-access-two','x-goog-user-project':'relay-project'}));
  });
  it('disconnects only the requesting account and never returns refresh tokens',async()=>{
    const h=harness();await h.service.configure(config);await h.connect();await h.connect(principal('bob'));await h.service.disconnect('alice');
    await expect(h.service.headers('alice')).rejects.toMatchObject({code:'GOOGLE_DISCONNECTED'});expect(await h.service.headers('bob')).toHaveProperty('authorization');expect(h.requests.at(-1)?.url).toBe('https://oauth2.googleapis.com/revoke');
    expect(JSON.stringify(await h.service.status('bob'))).not.toMatch(/refresh|access-one|secret/);
  });
  it('invalidates pending and saved grants when application configuration changes',async()=>{
    const h=harness();await h.service.configure(config);await h.connect();const url=await h.start();await h.service.configure({...config,quotaProject:'another-project'});
    await expect(h.service.complete(principal(),{state:url.searchParams.get('state')!,code:'code'},async()=>true)).rejects.toMatchObject({code:'GOOGLE_STATE'});
    await expect(h.service.headers('alice')).rejects.toMatchObject({code:'GOOGLE_RECONNECT'});
  });
  it('keeps disconnect durable across restart until an explicit API-key choice',async()=>{
    const h=harness();await h.service.configure(config);await h.connect();await h.service.disconnect('alice');
    const restarted=new GoogleOAuth(h.store,{allowedOrigins:async()=>[],vault:h.vault});
    await expect(restarted.headers('alice')).rejects.toMatchObject({code:'GOOGLE_DISCONNECTED'});
    await restarted.useApiKey('alice');expect(await restarted.headers('alice')).toBeNull();
  });
  it('supports configured loopback ports and keeps the third public origin without admitting LAN IPs',async()=>{
    const h=harness();await h.service.configure(config);
    const service=new GoogleOAuth(h.store,{vault:h.vault,allowedOrigins:async()=>['http://127.0.0.1:14317','http://localhost:14317','https://relay.example.com','https://10.0.0.8:4321']});
    expect((await service.configuration()).origins).toEqual(['http://127.0.0.1:14317','http://localhost:14317','https://relay.example.com']);
    expect(new URL((await service.start(principal(),'http://localhost:14317')).url).searchParams.get('redirect_uri')).toBe('http://localhost:14317/?relay_google=1');
    await expect(service.start(principal(),'http://127.0.0.1:9999')).rejects.toMatchObject({code:'GOOGLE_ORIGIN'});
  });
});

const event=(data:unknown)=>`data: ${JSON.stringify(data)}\n\n`;
const collect=async(stream:AsyncIterable<ModelChunk>)=>{const result:ModelChunk[]=[];for await(const value of stream)result.push(value);return result;};
function request():ModelRequest {const model=profile('gemini','gemini-2.5-flash');model.capabilities.tools=true;return {model,messages:[{role:'user',content:'Hello'}],tools:[],contextTokens:4096,maxOutputTokens:1024,signal:new AbortController().signal};}
describe('Gemini OAuth generation boundary',()=>{
  it('uses the account bearer token and quota project rather than an API key',async()=>{
    const h=harness();await h.service.configure(config);await h.connect();const calls:{url:string;headers:Headers;body:Record<string,unknown>}[]=[];
    const providers=new Providers({secrets:new SecretManager({env:{},keyring:null}),userSecrets:()=>new SecretManager({env:{},keyring:null}),fetch:async(url,init)=>{calls.push({url:String(url),headers:new Headers(init?.headers),body:JSON.parse(String(init?.body??'{}'))});return new Response(event({candidates:[{index:0,content:{parts:[{text:'Hello'}]},finishReason:'STOP'}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:2,thoughtsTokenCount:1}}));}});
    providers.setGoogleOAuth(h.service);const gateway=await providers.forUser('alice');const output=await collect(gateway.stream(request()));
    expect(calls[0].url).toContain(':streamGenerateContent?alt=sse');expect(calls[0].headers.get('authorization')).toBe('Bearer google-access-one');expect(calls[0].headers.get('x-goog-user-project')).toBe('relay-project');expect(calls[0].headers.has('x-goog-api-key')).toBe(false);
    expect(output).toContainEqual({type:'usage',inputTokens:3,outputTokens:3});expect(calls[0].body).toHaveProperty('contents');
    await expect(collect((await providers.forUser('bob')).stream(request()))).rejects.toThrow();expect(calls).toHaveLength(1);
  });
  it('preserves thought signatures privately and validates tools before dispatch',async()=>{
    const input=request();input.tools=[{name:'read',description:'read',parameters:{type:'object',properties:{}}}];
    const parts=[{thought:true,text:'private thought'},{functionCall:{id:'call1',name:'read',args:{path:'a.txt'}},thoughtSignature:'private-signature'}];
    const output=await collect(googleGenerateStream(new Response(event({candidates:[{content:{parts},finishReason:'STOP'}]})),input));
    expect(output.some(chunk=>chunk.type==='text')).toBe(false);expect(output.find(chunk=>chunk.type==='tool_call')).toMatchObject({call:{id:'call1',name:'read'}});
    const continuation=output.find(chunk=>chunk.type==='continuation');if(continuation?.type!=='continuation')throw new Error();input.messages.push({role:'assistant',content:'',providerData:continuation.providerData});
    expect(JSON.stringify(googleGenerateBody(input))).toContain('private-signature');
    await expect(collect(googleGenerateStream(new Response(event({candidates:[{content:{parts:[{functionCall:{name:'evil',args:{}}}]},finishReason:'STOP'}]})),input))).rejects.toThrow('invalid tool');
  });
  it('never dispatches tools from incomplete output',async()=>{
    const input=request();input.tools=[{name:'read',description:'read',parameters:{}}];
    for(const finish of [undefined,'MAX_TOKENS','SAFETY'])await expect(collect(googleGenerateStream(new Response(event({candidates:[{content:{parts:[{functionCall:{name:'read',args:{}}}]},...(finish?{finishReason:finish}:{})}]})),input))).rejects.toThrow(/incomplete|complete/);
  });
  it('does not silently fall back to an API key if OAuth refresh fails',async()=>{
    const providers=new Providers({secrets:new SecretManager({env:{GEMINI_API_KEY:'old-api-key'},keyring:null}),fetch:vi.fn()});
    providers.setGoogleOAuth({headers:async()=>{throw new Error('OAuth rejected');}} as unknown as GoogleOAuth);
    await expect(collect(providers.stream(request()))).rejects.toThrow();
  });
  it('accounts measured usage before truncation or invalid-tool failure without dispatching tools',async()=>{
    for(const reason of ['MAX_TOKENS','STOP']){
      const chunks:ModelChunk[]=[];const response=new Response(event({candidates:[{content:{parts:[{functionCall:{name:'unknown',args:{}}}]},finishReason:reason}],usageMetadata:{promptTokenCount:7,candidatesTokenCount:9,thoughtsTokenCount:2}}));
      const run=async()=>{for await(const chunk of googleGenerateStream(response,request()))chunks.push(chunk);};
      await expect(run()).rejects.toMatchObject({code:reason==='MAX_TOKENS'?'output_limit':'invalid_tool'});
      expect(chunks).toEqual([{type:'usage',inputTokens:7,outputTokens:11}]);
    }
  });
});
