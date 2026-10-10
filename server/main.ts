import {ScheduleService} from './scheduling/service.js';
import {GoogleWorkspace} from './integrations/google-workspace.js';
import {watchLocalMemory,type MemoryWatchFactory} from './hardware/watchdog.js';
import {startLmStudioBackground} from './host/lmstudio-background.js';
import { lanConfig, loadLanTls } from './auth/lan-config.js';
import { LocalLease } from './orchestration/lease.js';
import { InferenceService } from './inference/service.js';
import { createInferenceApp } from './inference/routes.js';
import { inferenceRemoteConfig, InferenceRemoteIdentity } from './inference/remote.js';
import {acquireServiceLock} from './host/service-lock.js';
import { resolve, join } from 'node:path';
import { createApp, type RemoteControl } from './api/app.js';
import { resolveRemoteSetup } from './auth/remote-config.js';
import { openDatabase } from './db/database.js';
import { Store } from './db/store.js';
import { Engine } from './orchestration/engine.js';
import { MeasuredProviders } from './models/measured-providers.js';
import { GoogleOAuth } from './providers/google-oauth.js';
import { ToolBroker } from './tools/index.js';
import { hostPlatform } from './host/platform.js';
import { privateDirectory } from './host/private-storage.js';
import {recordBackend} from './host/backend.js';
import { LocalPairing } from './auth/pairing.js';
import { getResourcePolicy } from './hardware/config.js';
import { getHardware } from './hardware/index.js';
import type { ProviderId } from '../shared/types.js';

const host=hostPlatform();
const dataDir=resolve(process.env.RELAY_DATA_DIR??(process.env.RELAY_PACKAGED==='1'?host.dataDirectory():'.data'));
const port=Number(process.env.RELAY_PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('RELAY_PORT must be a port between 1024 and 65535');
await privateDirectory(dataDir);
const serviceLock=await acquireServiceLock(dataDir);
await recordBackend(dataDir,!!process.env.DATABASE_URL);
const store=new Store(await openDatabase(join(dataDir,'postgres'),process.env.DATABASE_URL));await store.init();
const restorationPending=(await store.db.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0]?.value===true;
const providers=new MeasuredProviders(store,{resourcePolicy:()=>getResourcePolicy(store),loadUserPreferences:async userId=>{
  const saved=await store.db.query('SELECT provider,enabled FROM user_provider_connections WHERE user_id=$1',[userId]);
  const account=(await store.db.query('SELECT permissions FROM users WHERE id=$1',[userId]))[0];
  const granted=(account?.permissions as {providers?:string[]}|undefined)?.providers??[];
  return (['openai','anthropic','gemini','xai','deepseek'] as ProviderId[]).map(provider=>({provider,enabled:granted.includes(provider)&&saved.find(item=>item.provider===provider)?.enabled!==false}));
}});
for(const item of await store.db.query('SELECT provider,enabled FROM provider_connections'))providers.setEnabled(item.provider as ProviderId,item.enabled===true);
const remoteControl:RemoteControl={config:null,enabled:false,listening:false};
const googleOAuth=new GoogleOAuth(store,{allowedOrigins:async()=>[`http://127.0.0.1:${port}`,`http://localhost:${port}`,...remoteControl.config?[remoteControl.config.publicOrigin]:[]]});
const googleWorkspace=new GoogleWorkspace(store,{allowedOrigins:async()=>[`http://127.0.0.1:${port}`,`http://localhost:${port}`,...remoteControl.config?[remoteControl.config.publicOrigin]:[]]});
providers.setGoogleOAuth(googleOAuth);
let engine:Engine|undefined;
const broker=new ToolBroker(dataDir,()=>engine?.isStopped()??true,undefined,store,googleWorkspace);
const lease=new LocalLease();
const admit=async(model:import('../shared/types.js').ModelProfile,context:number)=>providers.admitModel(model,context);
const watchMemory:MemoryWatchFactory=(signal,execution)=>watchLocalMemory(signal,async()=>{const [hardware,policy]=await Promise.all([getHardware(),getResourcePolicy(store)]);return {hardware,policy};},execution);
const inference=new InferenceService(store,providers,lease,()=>engine?.isStopped()??true,admit,watchMemory);
engine=new Engine(store,providers,broker,{admit,lease,watchMemory});await engine.initialize();
const schedules=new ScheduleService(store,engine);
// The scheduler stays available after owner review without requiring a restart.
// Its transactional claim/dispatch gates reject pending restoration and stop.
await schedules.start();
let remoteError:unknown;
try{remoteControl.config=await resolveRemoteSetup(store,process.env);remoteControl.enabled=!!remoteControl.config;const saved=(await store.db.query('SELECT value FROM settings WHERE key=$1',['remote_enabled']))[0];if(saved?.value===false)remoteControl.enabled=false;}catch(error){remoteError=error;}
const pairing=new LocalPairing(dataDir);await pairing.initialize();
const lanControl={configured:false,listening:false,origin:null as string|null,error:null as string|null};
const services={googleWorkspace,schedules,store,providers,broker,engine,remoteControl,pairing,inference,lanControl,googleOAuth};
const app=await createApp(services,{port,logging:true});
await app.listen({host:'127.0.0.1',port});
// Optional runtime startup never holds local login or conversations hostage.
void (async()=>{
  if(restorationPending)return;
  const saved=await store.db.query('SELECT enabled FROM provider_connections WHERE provider=$1',['lmstudio']);
  if(saved[0]?.enabled===false)return;
  const result=await startLmStudioBackground();app.log.info({runtime:'lmstudio',...result},'Local runtime startup');
  if(result.state==='started')await providers.refreshLocalModels();
})().catch(()=>app.log.warn({runtime:'lmstudio'},'Background runtime startup unavailable; local host remains available'));
let gateway:Awaited<ReturnType<typeof createApp>>|undefined;
try {
  if(restorationPending)throw new Error('Restored data requires local owner review before remote listeners can start.');
  if(remoteError)throw remoteError;
  const config=remoteControl.config;
  if(config){gateway=await createApp(services,{port:config.port,remote:config,logging:true});await gateway.listen({host:'127.0.0.1',port:config.port});remoteControl.listening=true;}
}catch(error){app.log.error({error:error instanceof Error?error.message:'Invalid remote configuration'},'Remote gateway did not start. Local access remains available.');}
let lanGateway:Awaited<ReturnType<typeof createApp>>|undefined;
let inferenceGateway:Awaited<ReturnType<typeof createInferenceApp>>|undefined;
let externalInference:Awaited<ReturnType<typeof createInferenceApp>>|undefined;
try {if(!restorationPending){inferenceGateway=await createInferenceApp(inference);await inferenceGateway.listen({host:'127.0.0.1',port:4315});}}
catch {app.log.error('Inference listener unavailable; local browser remains available.');}
try {
  const config=restorationPending?null:lanConfig(process.env);lanControl.configured=!!config;lanControl.origin=config?.origin??null;
  if(config){const tls=await loadLanTls(config);lanGateway=await createApp(services,{lan:config,tls,port:config.port,logging:true});await lanGateway.listen({host:config.host,port:config.port});lanControl.listening=true;}
}catch(error){lanControl.error=error instanceof Error?error.message:'Invalid LAN configuration';app.log.error({error:lanControl.error},'LAN HTTPS did not start. Local access remains available.');}
try {
  const config=restorationPending?null:inferenceRemoteConfig(process.env);
  if(config){const identity=new InferenceRemoteIdentity(config);externalInference=await createInferenceApp(inference,{origin:config.origin,port:config.port,gatewayEnabled:()=>remoteControl.enabled,verifyGateway:request=>identity.verify(request.headers['cf-access-jwt-assertion'])});await externalInference.listen({host:'127.0.0.1',port:config.port});}
}catch {app.log.error('Remote inference gateway unavailable. Local access remains available.');}
app.log.info({url:`http://127.0.0.1:${port}`,platform:host.os,database:store.db.kind,remote:!!gateway},'Relay is ready');
app.log.info({command:'node dist-server/pair.js',arguments:['--data-dir',dataDir]},'Pair a local browser using this command and data directory. Codes are never written to logs.');
let closing=false;
const close=async()=>{if(closing)return;closing=true;try{await schedules.stop();await inference.shutdown();await engine!.shutdown();await inferenceGateway?.close();await externalInference?.close();await lanGateway?.close();await gateway?.close();await app.close();await store.close();await serviceLock.release();}finally{process.exit(0);}};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
