// Explicit standalone preview. Importing this file never starts a service.
// Run only after reviewing this launcher, its TLS material and the LAN address.
import {lstat,mkdir,open,readdir,realpath} from 'node:fs/promises';
import {networkInterfaces,type NetworkInterfaceInfo} from 'node:os';
import {isIP} from 'node:net';
import {basename,isAbsolute,join,parse,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {lanConfig,loadLanTls,type LanConfig} from '../server/auth/lan-config.js';
import {privateDirectory,readPrivate} from '../server/host/private-storage.js';
import {SecretManager} from '../server/providers/secrets.js';
import {AppError} from '../server/core/errors.js';

const marker='lan-preview.json';
const markerText=JSON.stringify({format:1,purpose:'isolated-lan-preview',ownerPort:4327,lanPort:4443});
interface PreviewOptions {dataDir:string;ownerHost:'127.0.0.1';ownerPort:4327;lan:LanConfig;}
function assertPrivateIPv4(host:string):void {
  const [a,b]=host.split('.').map(Number);
  if(isIP(host)!==4||!(a===10||a===172&&b>=16&&b<=31||a===192&&b===168))throw Error('Preview requires one explicit RFC1918 IPv4 address');
}
function previewPath(value:string):string {
  if(!isAbsolute(value)||/^[\\/]{2}/.test(value)||/[\x00-\x1f\x7f]/.test(value)||value.split(/[\\/]/).some(part=>part==='.'||part==='..'))throw Error('Preview data requires an absolute local path without traversal');
  if(process.platform==='win32'&&(!/^[a-z]:[\\/]/i.test(value)||value.slice(2).includes(':')||value.slice(3).split(/[\\/]/).some(part=>/[. ]$/.test(part))))throw Error('Invalid Windows preview data path');
  const path=resolve(value);
  if(!/^relay-lan-preview(?:-[\w-]+)?$/.test(basename(path)))throw Error('Use a dedicated relay-lan-preview directory');
  return path;
}
export function parseLanPreviewOptions(args:string[]):PreviewOptions {
  const values=new Map<string,string>();
  for(const arg of args){const match=/^--(data-dir|listen|cert|key)=(.+)$/.exec(arg);if(!match||match[0]!==arg||values.has(match[1]))throw Error('Use exactly --data-dir=ABSOLUTE --listen=PRIVATE_IPV4 --cert=ABSOLUTE --key=ABSOLUTE');values.set(match[1],match[2]);}
  if(values.size!==4)throw Error('All four explicit preview options are required');
  const previewHost=values.get('listen')!;assertPrivateIPv4(previewHost);
  const dataDir=previewPath(values.get('data-dir')!);
  const lan=lanConfig({RELAY_LAN_ENABLED:'1',RELAY_LAN_HOST:previewHost,RELAY_LAN_ORIGIN:`https://${previewHost}:4443`,RELAY_LAN_CERT_FILE:values.get('cert'),RELAY_LAN_KEY_FILE:values.get('key')})!;
  return {dataDir,ownerHost:'127.0.0.1',ownerPort:4327,lan};
}
export function assertPreviewInterface(previewHost:string,interfaces:NodeJS.Dict<NetworkInterfaceInfo[]>=networkInterfaces()):void {
  assertPrivateIPv4(previewHost);
  if(!Object.values(interfaces).flat().some(item=>item?.family==='IPv4'&&!item.internal&&item.address===previewHost))throw Error('Approved LAN address is not assigned to an active local IPv4 interface');
}
export async function preparePreviewDirectory(input:string):Promise<void> {
  const directory=previewPath(input),root=parse(directory).root;
  let path=root;
  // Inspect existing ancestors before any mkdir or ACL operation. Never claim a
  // production directory, linked parent or Windows filesystem alias.
  for(const component of relative(root,directory).split(/[\\/]/)){
    path=join(path,component);
    try{const info=await lstat(path),actual=await realpath(path);if(!info.isDirectory()||info.isSymbolicLink()||(process.platform==='win32'?actual.toLowerCase()!==path.toLowerCase():actual!==path))throw Error('Preview storage cannot traverse links or aliases');}
    catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')break;throw error;}
  }
  let entries:string[]=[];try{entries=await readdir(directory);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(entries.length&&(!entries.includes(marker)||await readPrivate(join(directory,marker))!==markerText))throw Error('Refusing unmarked existing storage; choose a fresh isolated preview directory');
  await mkdir(directory,{recursive:true,mode:0o700});await privateDirectory(directory);
  if(!entries.includes(marker)){const file=await open(join(directory,marker),'wx',0o600);try{await file.writeFile(markerText);await file.sync();}finally{await file.close();}}
}
export function previewSecrets(){
  const users=new Map<string,SecretManager>();
  return {
    owner:new SecretManager({env:{},keyring:null}),
    forUser(userId:string){let secrets=users.get(userId);if(!secrets){secrets=new SecretManager({userId,env:{},keyring:null});users.set(userId,secrets);}return secrets;},
    // Explicitly prevent both OAuth integrations from falling back to the
    // production OS vault. Provider API keys may use session-only storage.
    oauthVault:{async get(_key:string){return null;},async set(_key:string,_value:string){throw new AppError('PREVIEW_VAULT','Persistent OAuth credentials are unavailable in the isolated preview.',503);},async remove(_key:string){}},
  };
}
export function createPreviewShutdown(actions:{engine:()=>Promise<unknown>;listeners:()=>Promise<unknown>;store:()=>Promise<unknown>;lock:()=>Promise<unknown>}):()=>Promise<void> {
  let pending:Promise<void>|undefined;
  return ()=>pending??=(async()=>{
    const errors:unknown[]=[];
    try{await actions.engine();}catch(error){errors.push(error);}
    try{await actions.listeners();}catch(error){errors.push(error);}
    // A failed join must leave durable state/lock available for offline recovery.
    if(errors.length)throw new AggregateError(errors,'Preview shutdown incomplete; storage retained for recovery');
    await actions.store();await actions.lock();
  })();
}

export async function runLanPreview(args:string[]):Promise<{close:()=>Promise<void>}> {
  const options=parseLanPreviewOptions(args);assertPreviewInterface(options.lan.host);
  if(process.env.RELAY_DEV==='1')throw Error('Unset RELAY_DEV before starting the isolated LAN preview');
  const tls=await loadLanTls(options.lan);
  let engine:import('../server/orchestration/engine.js').Engine|undefined,store:import('../server/db/store.js').Store|undefined,lock:{release:()=>Promise<void>}|undefined;
  const listeners:Array<{close:()=>Promise<unknown>}>=[];
  const close=createPreviewShutdown({engine:async()=>{await engine?.shutdown();},listeners:async()=>{
    const results=await Promise.allSettled(listeners.map(listener=>listener.close()));const errors=results.filter(result=>result.status==='rejected');
    if(errors.length)throw new AggregateError(errors.map(result=>result.reason),'Preview listeners did not close');
  },store:async()=>{await store?.close();},lock:async()=>{await lock?.release();}});
  try {
    const staticRoot=fileURLToPath(new URL('../dist/',import.meta.url));
    if(!(await lstat(join(staticRoot,'index.html'))).isFile())throw Error('Build the preview web application first');
    await preparePreviewDirectory(options.dataDir);
    const {acquireServiceLock}=await import('../server/host/service-lock.js');lock=await acquireServiceLock(options.dataDir);
    const {recordBackend}=await import('../server/host/backend.js');await recordBackend(options.dataDir,false);
    const {Store}=await import('../server/db/store.js'),{openDatabase}=await import('../server/db/database.js');
    store=new Store(await openDatabase(join(options.dataDir,'postgres')));await store.init();
    if((await store.db.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0]?.value===true)throw Error('Restored storage cannot start a LAN preview before owner recovery');
    const activeStore=store,isolated=previewSecrets();
    const {MeasuredProviders}=await import('../server/models/measured-providers.js');
    const {getResourcePolicy}=await import('../server/hardware/config.js'),{getHardware}=await import('../server/hardware/index.js'),{watchLocalMemory}=await import('../server/hardware/watchdog.js');
    const providers=new MeasuredProviders(store,{secrets:isolated.owner,userSecrets:isolated.forUser,ollamaUrl:'http://127.0.0.1:11434',lmstudioUrl:'http://127.0.0.1:1234',resourcePolicy:()=>getResourcePolicy(activeStore),loadUserPreferences:async userId=>{
      const saved=await activeStore.db.query('SELECT provider,enabled FROM user_provider_connections WHERE user_id=$1',[userId]);
      const user=(await activeStore.db.query('SELECT permissions FROM users WHERE id=$1',[userId]))[0];const granted=(user?.permissions as {providers?:string[]}|undefined)?.providers??[];
      return (['openai','anthropic','gemini','xai','deepseek'] as const).map(provider=>({provider,enabled:granted.includes(provider)&&saved.find(item=>item.provider===provider)?.enabled!==false}));
    }});
    for(const item of await store.db.query('SELECT provider,enabled FROM provider_connections'))providers.setEnabled(item.provider as import('../shared/types.js').ProviderId,item.enabled===true);
    const {GoogleWorkspace}=await import('../server/integrations/google-workspace.js'),{GoogleOAuth}=await import('../server/providers/google-oauth.js');
    const allowedOrigins=async()=>[`http://127.0.0.1:${options.ownerPort}`,`http://localhost:${options.ownerPort}`,options.lan.origin];
    const googleWorkspace=new GoogleWorkspace(store,{allowedOrigins,vault:isolated.oauthVault}),googleOAuth=new GoogleOAuth(store,{allowedOrigins,vault:isolated.oauthVault});providers.setGoogleOAuth(googleOAuth);
    const {ToolBroker}=await import('../server/tools/index.js'),{Engine}=await import('../server/orchestration/engine.js');
    const broker=new ToolBroker(options.dataDir,()=>engine?.isStopped()??true,undefined,store,googleWorkspace);
    engine=new Engine(store,providers,broker,{admit:(model,context)=>providers.admitModel(model,context),watchMemory:(signal,execution)=>watchLocalMemory(signal,async()=>({hardware:await getHardware(),policy:await getResourcePolicy(activeStore)}),execution)});await engine.initialize();
    const {LocalPairing}=await import('../server/auth/pairing.js');const pairing=new LocalPairing(options.dataDir);await pairing.initialize();
    const {createApp}=await import('../server/api/app.js');
    const lanControl={configured:true,listening:false,origin:options.lan.origin,error:null};
    const services={store,providers,broker,engine,pairing,googleWorkspace,googleOAuth,lanControl,remoteControl:{config:null,enabled:false,listening:false}};
    const owner=await createApp(services,{port:options.ownerPort,staticRoot,logging:false});listeners.push(owner);
    await owner.listen({host:options.ownerHost,port:options.ownerPort});
    const lan=await createApp(services,{port:options.lan.port,lan:options.lan,tls,staticRoot,logging:false});listeners.push(lan);
    await lan.listen({host:options.lan.host,port:options.lan.port});lanControl.listening=true;
    // No automatic pairing, invitation, credential, model load or task admission.
    process.stdout.write(JSON.stringify({preview:true,owner:`http://127.0.0.1:${options.ownerPort}`,lan:options.lan.origin,dataDir:options.dataDir,credentials:'session-only; OAuth unavailable',schedules:'runner disabled',externalInference:'no listener'})+'\n');
    return {close};
  }catch(error){try{await close();}catch(cleanup){throw new AggregateError([error,cleanup],'Preview startup and cleanup failed; inspect isolated storage');}throw error;}
  finally{tls.key.fill(0);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const preview=await runLanPreview(process.argv.slice(2));const stop=()=>{void preview.close().then(()=>process.exit(0),()=>{process.stderr.write('Preview shutdown failed; isolated storage retained for recovery.\n');process.exit(1);});};process.once('SIGINT',stop);process.once('SIGTERM',stop);}
  catch(error){process.stderr.write(`LAN preview did not start: ${error instanceof Error?error.message:'Unknown startup failure'}\n`);process.exit(1);}
}
