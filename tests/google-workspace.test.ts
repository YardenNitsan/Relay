import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {openDatabase,type Database} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {chatPermissions,type Principal} from '../server/auth/policy.js';
import {Sessions} from '../server/auth/sessions.js';
import {GoogleWorkspace,WORKSPACE_SCOPES,type WorkspaceActor,type WorkspaceVault} from '../server/integrations/google-workspace.js';

let db:Database,store:Store;
const configuration={clientId:'222-workspace.apps.googleusercontent.com',clientSecret:'private-app-secret',separateProjectAccepted:true};
const principal=(id='owner'):Principal=>({sessionId:`session-${id}`,remote:id!=='owner',user:{id,name:id,email:null,role:id==='owner'?'owner':'chat',enabled:true,permissions:chatPermissions,sessionVersion:0,createdAt:new Date().toISOString(),lastActiveAt:null}});
const actor=(id='owner'):WorkspaceActor=>({principal:principal(id),live:async()=>true});
beforeEach(async()=>{db=await openDatabase();store=new Store(db);await store.init();await db.query("INSERT INTO users(id,name,role,permissions) VALUES ('alice','Alice','chat','{}'),('bob','Bob','chat','{}')");for(const id of ['owner','alice','bob'])await db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ($1,$2,'csrf',$3,'fixture',0,now()+interval '1 hour')",[`session-${id}`,id,id!=='owner']);});
afterEach(async()=>{await db.close();});
function harness(){
  const secrets=new Map<string,string>(),requests:Array<{url:string;init:RequestInit|undefined}>=[];let nonce='',scope=WORKSPACE_SCOPES.join(' '),now=Date.now();
  let handler:((url:string,init?:RequestInit)=>Promise<Response>)|undefined;
  const vault:WorkspaceVault={get:async key=>secrets.get(key)??null,set:async(key,value)=>{secrets.set(key,value);},remove:async key=>{secrets.delete(key);}};
  const fetcher:typeof fetch=async(url,init)=>{requests.push({url:String(url),init});if(handler){const value=await handler(String(url),init);return value;}if(String(url).endsWith('/token'))return Response.json({access_token:'private-access',refresh_token:'private-refresh',id_token:'signed-fixture',token_type:'Bearer',expires_in:3600,scope});if(String(url).endsWith('/revoke'))return new Response('');if(String(url).includes('/gmail/'))return Response.json({messages:[{id:'mail1',threadId:'thread1'}]});return Response.json({items:[]});};
  const service=new GoogleWorkspace(store,{allowedOrigins:async()=>['http://127.0.0.1:4317','https://relay.example.test'],vault,fetch:fetcher,now:()=>now,verifyIdentity:async()=>({sub:'google-subject',nonce})});
  const start=async(a=actor('alice'))=>{const result=await service.start(a,{origin:'https://relay.example.test'});const url=new URL(result.url);nonce=url.searchParams.get('nonce')!;return url;};
  const connect=async(a=actor('alice'))=>{const url=await start(a);await service.complete(a,{state:url.searchParams.get('state')!,code:'one-use-code'});return url;};
  return {service,secrets,requests,vault,start,connect,setScope:(value:string)=>{scope=value;},setHandler:(value:typeof handler)=>{handler=value;},advance:()=>{now+=3600000;},setNonce:(value:string)=>{nonce=value;}};
}
describe('Google Workspace read-only connection',()=>{
  it('uses actual database-backed session checks without nesting an outer-connection read inside a transaction',async()=>{
    const h=harness(),sessions=new Sessions(store);const access=(id:string):WorkspaceActor=>{const p=principal(id);return {principal:p,live:async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([sessions.live(p),new Promise<boolean>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Nested session query stalled')),1000);})]);}finally{clearTimeout(timer);}}};};
    await h.service.configure(access('owner'),configuration);await h.connect(access('alice'));expect((await h.service.status(access('alice'))).connected).toBe(true);
  });
  it('stays unconfigured until a local owner supplies a separate application; stores no credentials in PostgreSQL',async()=>{
    const h=harness();expect(await h.service.status(actor('alice'))).toMatchObject({configured:false,connected:false});await expect(h.start()).rejects.toMatchObject({code:'WORKSPACE_SETUP'});
    await expect(h.service.configure(actor('alice'),configuration)).rejects.toMatchObject({code:'OWNER_ONLY'});
    await h.service.configure(actor(),configuration);expect(JSON.stringify(await db.query('SELECT value FROM settings'))).not.toContain('private-app-secret');expect([...h.secrets.values()]).toContain('private-app-secret');
    expect(await h.service.status(actor('alice'))).toMatchObject({configured:true,connected:false,readOnly:true});
  });
  it('rejects reuse of Gemini application credentials or an unacknowledged shared-project boundary',async()=>{
    const h=harness();await expect(h.service.configure(actor(),{...configuration,separateProjectAccepted:false})).rejects.toThrow();
    await db.query("INSERT INTO settings(key,value) VALUES ('google-oauth',$1)",[JSON.stringify({clientId:configuration.clientId})]);await expect(h.service.configure(actor(),configuration)).rejects.toMatchObject({code:'WORKSPACE_SEPARATE_PROJECT'});
  });
  it('uses separate scopes, PKCE, nonce and one-use session-bound state',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);const url=await h.start();expect(url.searchParams.get('redirect_uri')).toBe('https://relay.example.test/?relay_workspace=1');expect(url.searchParams.get('scope')).not.toMatch(/gmail.send|calendar.events(?: |$)|generative-language/);
    await expect(h.service.complete(actor('bob'),{state:url.searchParams.get('state')!,code:'x'})).rejects.toMatchObject({code:'WORKSPACE_STATE'});
    await h.service.complete(actor('alice'),{state:url.searchParams.get('state')!,code:'x'});const exchange=new URLSearchParams(String(h.requests[0].init?.body));expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(exchange.get('code_verifier')!).digest('base64url'));
    await expect(h.service.complete(actor('alice'),{state:url.searchParams.get('state')!,code:'x'})).rejects.toMatchObject({code:'WORKSPACE_STATE'});expect((await h.service.status(actor('alice'))).connected).toBe(true);expect((await h.service.status(actor('bob'))).connected).toBe(false);
  });
  it('rejects missing consent, nonce substitution, expired sessions and unapproved origins',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await expect(h.service.start(actor('alice'),{origin:'https://evil.example'})).rejects.toMatchObject({code:'WORKSPACE_ORIGIN'});
    h.setScope('openid');await expect(h.connect()).rejects.toMatchObject({code:'WORKSPACE_SCOPE'});h.setScope(WORKSPACE_SCOPES.join(' '));const url=await h.start();h.setNonce('wrong');await expect(h.service.complete(actor('alice'),{state:url.searchParams.get('state')!,code:'x'})).rejects.toMatchObject({code:'WORKSPACE_IDENTITY'});
    await expect(h.service.start({...actor('alice'),live:async()=>false},{origin:'https://relay.example.test'})).rejects.toMatchObject({code:'WORKSPACE_REVOKED'});expect((await h.service.status(actor('alice'))).connected).toBe(false);
  });
  it('reads only the connected account through fixed endpoints and returns bounded plain text without attachments',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();h.setHandler(async()=>Response.json({id:'mail1',threadId:'thread1',snippet:'Preview',payload:{headers:[{name:'Subject',value:'A subject'},{name:'Authorization',value:'never returned'}],mimeType:'multipart/mixed',parts:[{mimeType:'text/html',body:{data:Buffer.from('<script>bad</script>').toString('base64url')}},{mimeType:'text/plain',body:{data:Buffer.from('Actual plain text').toString('base64url')}},{mimeType:'text/plain',filename:'private.txt',body:{data:Buffer.from('Attachment excluded').toString('base64url')}}]}}));
    const result=await h.service.readMail(actor('alice'),{id:'mail1'});expect(result.text).toBe('Actual plain text');expect(result.headers.subject).toBe('A subject');expect(JSON.stringify(result)).not.toMatch(/script|Attachment excluded|never returned/);expect(h.requests.at(-1)?.url).toContain('https://gmail.googleapis.com/gmail/v1/users/me/messages/mail1');
    await expect(h.service.readMail(actor('bob'),{id:'mail1'})).rejects.toMatchObject({code:'WORKSPACE_DISCONNECTED'});await expect(h.service.readMail(actor('alice'),{id:'../other'})).rejects.toThrow();
  });
  it('bounds search pages and calendar windows, and preserves per-calendar errors as unavailable',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();await expect(h.service.searchMail(actor('alice'),{query:'x',maxResults:21})).rejects.toThrow();
    await expect(h.service.listEvents(actor('alice'),{timeMin:'2026-01-01T00:00:00Z',timeMax:'2026-12-01T00:00:00Z'})).rejects.toThrow();
    h.setHandler(async()=>Response.json({calendars:{primary:{errors:[{reason:'notFound'}],busy:[]}}}));const result=await h.service.freeBusy(actor('alice'),{timeMin:'2026-01-01T00:00:00Z',timeMax:'2026-01-02T00:00:00Z',calendarIds:['primary']});expect(result.calendars[0]).toMatchObject({id:'primary',available:false,busy:null});expect(h.requests.at(-1)?.url).toBe('https://www.googleapis.com/calendar/v3/freeBusy');
  });
  it('returns real-shaped search headers and calendar occurrences from explicitly requested pages',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();h.setHandler(async url=>url.includes('/calendars/')?Response.json({items:[{id:'event1',status:'confirmed',summary:'Fixture meeting',start:{dateTime:'2026-01-01T10:00:00Z'},end:{dateTime:'2026-01-01T11:00:00Z'}}],nextPageToken:'next-events'}):url.includes('/messages/mail1')?Response.json({id:'mail1',threadId:'thread1',snippet:'Fixture preview',payload:{headers:[{name:'Subject',value:'Fixture subject'}]}}):Response.json({messages:[{id:'mail1'}],nextPageToken:'next-mail'}));
    const mail=await h.service.searchMail(actor('alice'),{query:'from:fixture@example.test',maxResults:1});expect(mail.messages[0]).toMatchObject({id:'mail1',headers:{subject:'Fixture subject'}});expect(mail.nextPageToken).toBe('next-mail');expect(mail.limited).toBe(true);
    const events=await h.service.listEvents(actor('alice'),{timeMin:'2026-01-01T00:00:00Z',timeMax:'2026-01-02T00:00:00Z'});expect(events.events[0]).toMatchObject({id:'event1',summary:'Fixture meeting',start:{dateTime:'2026-01-01T10:00:00Z'}});expect(events.limited).toBe(true);expect(h.requests.at(-1)?.url).toContain('singleEvents=true');
  });
  it('serializes refresh and never exposes renewed access tokens in read results',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();h.advance();h.setHandler(async url=>url.endsWith('/token')?Response.json({access_token:'renewed-private-access',token_type:'Bearer',expires_in:3600,scope:WORKSPACE_SCOPES.join(' ')}):Response.json({id:'mail1',payload:{mimeType:'text/plain',body:{data:Buffer.from('Readable').toString('base64url')}}}));
    const results=await Promise.all([h.service.readMail(actor('alice'),{id:'mail1'}),h.service.readMail(actor('alice'),{id:'mail1'})]);expect(h.requests.filter(request=>request.url.endsWith('/token'))).toHaveLength(2);expect(new Headers(h.requests.at(-1)?.init?.headers).get('authorization')).toBe('Bearer renewed-private-access');expect(JSON.stringify(results)).not.toContain('renewed-private-access');
    const refresh=new URLSearchParams(String(h.requests.find((request,index)=>index>0&&request.url.endsWith('/token'))?.init?.body));expect(refresh.get('grant_type')).toBe('refresh_token');expect(refresh.get('refresh_token')).toBe('private-refresh');
  });
  it('rejects oversized and private upstream errors without echoing provider payloads',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();h.setHandler(async()=>new Response('private upstream email and Bearer token',{status:500}));await expect(h.service.readMail(actor('alice'),{id:'mail1'})).rejects.toMatchObject({code:'WORKSPACE_UPSTREAM'});
    h.setHandler(async()=>new Response(' '.repeat(1024*1024+1)));await expect(h.service.readMail(actor('alice'),{id:'mail1'})).rejects.toMatchObject({code:'WORKSPACE_RESPONSE'});
  });
  it('invalidates saved connections after durable session-version changes, including a restored snapshot',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();await db.query("UPDATE users SET session_version=1 WHERE id='alice'");await expect(h.service.readMail(actor('alice'),{id:'mail1'})).rejects.toMatchObject({code:'WORKSPACE_REVOKED'});
    const fresh=actor('alice');fresh.principal.user.sessionVersion=1;expect((await h.service.status(fresh)).connected).toBe(false);await expect(h.service.readMail(fresh,{id:'mail1'})).rejects.toMatchObject({code:'WORKSPACE_DISCONNECTED'});
  });
  it('discards an in-flight read when disconnect is requested and keeps the durable grant disabled',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();let release!:()=>void;const gated=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const reached=new Promise<void>(resolve=>{entered=resolve;});
    h.setHandler(async url=>{if(url.endsWith('/revoke'))return new Response('');entered();await gated;return Response.json({id:'mail1',payload:{}});});
    const read=h.service.readMail(actor('alice'),{id:'mail1'});const rejected=expect(read).rejects.toMatchObject({code:'WORKSPACE_REVOKED'});await reached;const disconnect=h.service.disconnect(actor('alice'));await vi.waitFor(()=>expect(h.requests.at(-1)?.init?.signal?.aborted).toBe(true));release();await rejected;expect(await disconnect).toMatchObject({revoked:true});expect((await h.service.status(actor('alice'))).connected).toBe(false);
  });
  it('rejects already queued reads after disconnect before they can send another Google request',async()=>{
    const h=harness();await h.service.configure(actor(),configuration);await h.connect();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),reached=new Promise<void>(resolve=>{entered=resolve;});let reads=0;
    h.setHandler(async url=>{if(url.endsWith('/revoke'))return new Response('');reads++;entered();await gate;return Response.json({id:'mail1',payload:{}});});
    const first=h.service.readMail(actor('alice'),{id:'mail1'});const failedFirst=expect(first).rejects.toMatchObject({code:'WORKSPACE_REVOKED'});await reached;
    const queued=h.service.readMail(actor('alice'),{id:'mail2'});const failedQueued=expect(queued).rejects.toMatchObject({code:'WORKSPACE_REVOKED'});const disconnect=h.service.disconnect(actor('alice'));await vi.waitFor(()=>expect(h.requests.at(-1)?.init?.signal?.aborted).toBe(true));release();await Promise.all([failedFirst,failedQueued,disconnect]);expect(reads).toBe(1);
  });
});
