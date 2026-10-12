// Explicit native integration fixture. Never imported by production entry points.
// Control channel is the parent process's private pipes, not an HTTP route.
import {createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {createApp,type Services} from '../server/api/app.js';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {ToolBroker} from '../server/tools/index.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import {Engine} from '../server/orchestration/engine.js';
import {LocalPairing} from '../server/auth/pairing.js';
import {chatPermissions} from '../server/auth/policy.js';
import type {ProviderId} from '../shared/types.js';

if(process.argv[2]!=='--private-native-test')throw new Error('Explicit native fixture mode required');
const input=createInterface({input:process.stdin,terminal:false});
const lines=input[Symbol.asyncIterator]();
const first=await lines.next();
if(first.done||first.value.length>32768)throw new Error('Fixture TLS input missing or too large');
const tls=JSON.parse(first.value) as {certificate:string;key:string};
if(typeof tls.certificate!=='string'||typeof tls.key!=='string')throw new Error('Fixture TLS input invalid');
const cleanups:Array<()=>Promise<unknown>>=[];
let cleaning:Promise<void>|undefined;
function cleanup():Promise<void> {
  return cleaning??=(async()=>{
    let failed=false;
    for(const dispose of [...cleanups].reverse())try{await dispose();}catch{failed=true;}
    if(failed)throw new Error('Native fixture cleanup failed');
  })();
}
const timeout=setTimeout(()=>{void cleanup().finally(()=>process.exit(1));},120000);timeout.unref();
const reply=(data:unknown)=>process.stdout.write(JSON.stringify(data)+'\n');
try {
const temporaryRoot=await realpath(tmpdir());
const directory=await mkdtemp(join(temporaryRoot,'relay-native-lan-'));
cleanups.push(async()=>{
  const exact=await realpath(directory);
  if(dirname(exact)!==temporaryRoot||!/^relay-native-lan-[\w-]+$/.test(basename(exact))||resolve(directory)!==exact)throw new Error('Fixture cleanup path refused');
  await rm(exact,{recursive:true,force:true});
});
const store=new Store(await openDatabase());cleanups.push(()=>store.close());await store.init();
const providers=new Providers({fetch:async()=>{throw new Error('Native fixture prohibits provider network');},secrets:new SecretManager({env:{},keyring:null}),userSecrets:()=>new SecretManager({env:{},keyring:null}),ollamaUrl:'http://127.0.0.1:1',lmstudioUrl:'http://127.0.0.1:1'});
for(const id of ['ollama','lmstudio','openai','anthropic','gemini','xai','deepseek'] as ProviderId[])providers.setEnabled(id,false);
let engine:Engine;
const broker=new ToolBroker(directory,()=>engine?.isStopped()??false,undefined,store);
engine=new Engine(store,providers,broker);cleanups.push(()=>engine.shutdown());await engine.initialize();
const pairing=new LocalPairing(directory);
const services:Services={store,providers,broker,engine,pairing,remoteControl:{config:null,enabled:false,listening:false}};
const owner=await createApp(services,{port:4317,staticRoot:join(directory,'no-web')});
cleanups.push(()=>owner.close());
const ownerOrigin='http://127.0.0.1:4317';
const ownerPaired=await owner.inject({method:'POST',url:'/api/session/pair',headers:{host:'127.0.0.1:4317',origin:ownerOrigin},payload:{token:(await pairing.issue()).token}});
if(ownerPaired.statusCode!==200)throw new Error('Fixture owner pairing failed');
const ownerHeaders={host:'127.0.0.1:4317',origin:ownerOrigin,cookie:ownerPaired.headers['set-cookie']!.toString().split(';')[0],'x-relay-csrf':ownerPaired.json().csrfToken as string};
async function ownerPost(url:string,payload:Record<string,unknown>={}) {
  const response=await owner.inject({method:'POST',url,headers:ownerHeaders,payload});
  if(response.statusCode!==200)throw new Error(`Fixture owner operation failed (${response.statusCode})`);
  return response.json() as Record<string,unknown>;
}
const account=await ownerPost('/api/admin/users',{name:'Native integration account',email:'native-integration@example.test',role:'chat',permissions:{...chatPermissions,providers:[]}});
const userId=String(account.id);
const privateConversation=await ownerPost('/api/conversations',{title:'Owner-private integration marker'});
const privateWorkspace=await ownerPost('/api/workspaces',{name:'Owner-private fixture',personal:true});
await ownerPost(`/api/workspaces/${privateWorkspace.id}/files`,{path:'private.txt',content:'owner-only integration fixture'});

async function freeLoopbackPort():Promise<number> {
  const reservation=createServer();await new Promise<void>((ok,fail)=>{reservation.once('error',fail);reservation.listen(0,'127.0.0.1',ok);});
  const address=reservation.address();if(!address||typeof address==='string')throw new Error('Fixture port unavailable');
  const port=address.port;await new Promise<void>((ok,fail)=>reservation.close(error=>error?fail(error):ok()));
  if([4317,4318,4319,4323].includes(port))return freeLoopbackPort();
  return port;
}
const port=await freeLoopbackPort(),origin=`https://relay.test:${port}`;
// Direct app construction deliberately tests real LAN API policy over loopback;
// deployment configuration/private-interface/file-ACL validation is not exercised.
const app=await createApp(services,{tls:{cert:Buffer.from(tls.certificate),key:Buffer.from(tls.key)},lan:{origin,host:'127.0.0.1',port,certFile:'in-memory-test-only',keyFile:'in-memory-test-only'},staticRoot:join(directory,'no-web')});
cleanups.push(()=>app.close());
await app.listen({host:'127.0.0.1',port});
reply({origin,userId,privateConversationId:privateConversation.id,privateWorkspaceId:privateWorkspace.id,invitation:(await ownerPost(`/api/admin/users/${userId}/lan-invitation`)).token});
  for(;;){
    const next=await lines.next();if(next.done)break;
    if(next.value.length>1024)throw new Error('Fixture control input too large');
    const command=JSON.parse(next.value) as {op:string};
    if(command.op==='shutdown'){await cleanup();reply({closed:true});break;}
    if(command.op==='invite')reply(await ownerPost(`/api/admin/users/${userId}/lan-invitation`));
    else if(command.op==='revoke')reply(await ownerPost(`/api/admin/users/${userId}/revoke`));
    else if(command.op==='expire'){
      await store.db.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND remote=true",[userId]);reply({expired:true});
    } else throw new Error('Unknown fixture control operation');
  }
} catch {reply({fixtureError:true});process.exitCode=1;}
finally {clearTimeout(timeout);input.close();await cleanup();}
