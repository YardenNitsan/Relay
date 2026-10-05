import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp, type RemoteControl } from './api/app.js';
import { remoteConfig } from './auth/remote.js';
import { openDatabase } from './db/database.js';
import { Store } from './db/store.js';
import { Engine } from './orchestration/engine.js';
import { MeasuredProviders } from './models/measured-providers.js';
import { ToolBroker } from './tools/index.js';
import { hostPlatform } from './host/platform.js';
import type { ProviderId } from '../shared/types.js';

const host=hostPlatform();
const dataDir=resolve(process.env.RELAY_DATA_DIR??(process.env.RELAY_PACKAGED==='1'?host.dataDirectory():'.data'));
const port=Number(process.env.RELAY_PORT??4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('RELAY_PORT must be a port between 1024 and 65535');
await mkdir(dataDir,{recursive:true,mode:0o700});
const lockPath=join(dataDir,'service.lock');
try {
  const previous=Number(await readFile(lockPath,'utf8'));
  if(Number.isInteger(previous)&&previous>0){try{process.kill(previous,0);throw new Error('Relay is already running for this data directory');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
  await unlink(lockPath);
} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));await lock.close();
const store=new Store(await openDatabase(join(dataDir,'postgres'),process.env.DATABASE_URL));await store.init();
const providers=new MeasuredProviders(store);
for(const item of await store.db.query('SELECT provider,enabled FROM provider_connections'))providers.setEnabled(item.provider as ProviderId,item.enabled===true);
let engine:Engine|undefined;
const broker=new ToolBroker(dataDir,()=>engine?.isStopped()??true);
engine=new Engine(store,providers,broker);await engine.initialize();
const remoteControl:RemoteControl={config:null,enabled:false,listening:false};
let remoteError:unknown;
try{remoteControl.config=remoteConfig(process.env);remoteControl.enabled=!!remoteControl.config;const saved=(await store.db.query('SELECT value FROM settings WHERE key=$1',['remote_enabled']))[0];if(saved?.value===false)remoteControl.enabled=false;}catch(error){remoteError=error;}
const services={store,providers,broker,engine,remoteControl};
const app=await createApp(services,{port,logging:true});
await app.listen({host:'127.0.0.1',port});
let gateway:Awaited<ReturnType<typeof createApp>>|undefined;
try {
  if(remoteError)throw remoteError;
  const config=remoteControl.config;
  if(config){gateway=await createApp(services,{port:config.port,remote:config,logging:true});await gateway.listen({host:'127.0.0.1',port:config.port});remoteControl.listening=true;}
}catch(error){app.log.error({error:error instanceof Error?error.message:'Invalid remote configuration'},'Remote gateway did not start. Local access remains available.');}
app.log.info({url:`http://127.0.0.1:${port}`,platform:host.os,database:store.db.kind,remote:!!gateway},'Relay is ready');
let closing=false;
const close=async()=>{if(closing)return;closing=true;try{await engine!.shutdown();await gateway?.close();await app.close();await store.close();await unlink(lockPath);}finally{process.exit(0);}};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
