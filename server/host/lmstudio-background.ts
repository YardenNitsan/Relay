import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join,isAbsolute,dirname} from 'node:path';
import {stat,readdir} from 'node:fs/promises';

type StartupResult={state:'running'|'started'|'disabled'|'unavailable';message:string};
interface Dependencies {env?:NodeJS.ProcessEnv;probe?:()=>Promise<boolean|null>;find?:()=>Promise<string|null>;headless?:(cli:string)=>Promise<boolean>;run?:(file:string,args:string[])=>Promise<unknown>;}
const exec=promisify(execFile);
export function lmStudioEnvironment(source:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const allowed=new Set(['path','systemroot','windir','home','userprofile','localappdata','appdata','temp','tmp','comspec','programfiles','programfiles(x86)','programdata','xdg_config_home','xdg_data_home','xdg_cache_home','xdg_runtime_dir','display','wayland_display','dbus_session_bus_address','lang']);
  return {...Object.fromEntries(Object.entries(source).filter(([key,value])=>allowed.has(key.toLowerCase())&&value!==undefined)),LMS_SERVER_HOST:'127.0.0.1'};
}
/** Fixed local startup operation. Never exposed through an agent tool or remote user input. */
export async function startLmStudioBackground(deps:Dependencies={}):Promise<StartupResult>{
  const env=deps.env??process.env;
  if(env.RELAY_LMSTUDIO_AUTOSTART==='0'||env.RELAY_LMSTUDIO_URL&&env.RELAY_LMSTUDIO_URL!=='http://127.0.0.1:1234')return {state:'disabled',message:'LM Studio background startup is disabled or a custom endpoint is configured.'};
  const probe=deps.probe??(async()=>{
    try{
      const response=await fetch('http://127.0.0.1:1234/api/v1/models',{redirect:'error',signal:AbortSignal.timeout(2000)});
      // A protected listener is already running. Do not change its authentication.
      if(response.status===401||response.status===403){await response.body?.cancel();return true;}
      if(!response.ok){await response.body?.cancel();return null;}
      const data=await response.json() as {models?:unknown};return Array.isArray(data.models)?true:null;
    }catch(error){const cause=(error as {cause?:{code?:string}}).cause;return cause?.code==='ECONNREFUSED'?false:null;}
  });
  try{
    const current=await probe();
    if(current===true)return {state:'running',message:'LM Studio server is already running; existing settings were preserved.'};
    if(current===null)return {state:'unavailable',message:'Port 1234 could not be identified safely; no runtime was started.'};
    const find=deps.find??(async()=>{
      const location=env.RELAY_LMS_PATH??join(homedir(),'.lmstudio','bin',process.platform==='win32'?'lms.exe':'lms');
      if(!isAbsolute(location))return null;
      try{return (await stat(location)).isFile()?location:null;}catch{return null;}
    });
    const executable=await find();
    if(!executable)return {state:'unavailable',message:'LM Studio CLI is not installed at its standard location. Install llmster or set RELAY_LMS_PATH to its absolute path.'};
    const headless=deps.headless??(async(cli:string)=>{
      const directory=join(dirname(dirname(cli)),'llmster');
      try{
        for(const entry of (await readdir(directory,{withFileTypes:true})).filter(entry=>entry.isDirectory()).slice(0,100)){
          try{if((await stat(join(directory,entry.name,process.platform==='win32'?'llmster.exe':'llmster'))).isFile())return true;}catch{/* Other version directory. */}
        }
      }catch{/* Headless distribution is not installed. */}
      return false;
    });
    if(!await headless(executable))return {state:'unavailable',message:'Install the official llmster background service once. Relay will not launch the LM Studio desktop app automatically.'};
    const run=deps.run??((file,args)=>exec(file,args,{windowsHide:true,timeout:30000,maxBuffer:65536,env:lmStudioEnvironment(process.env)}));
    await run(executable,['daemon','up','--json']);
    await run(executable,['server','start','--bind','127.0.0.1','--port','1234']);
    if(await probe()!==true)throw new Error('Startup did not expose the catalog');
    return {state:'started',message:'LM Studio background service started on localhost:1234. No model was loaded.'};
  }catch{return {state:'unavailable',message:'LM Studio background startup failed. Relay remains available; inspect LM Studio or install its supported llmster service.'};}
}
