import { spawn } from 'node:child_process';
import { access, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { constants } from 'node:fs';

export async function trustedGitBinary():Promise<string> {
  const candidates=process.platform==='win32'
    ? [process.env.ProgramFiles&&join(process.env.ProgramFiles,'Git','cmd','git.exe'),process.env.LOCALAPPDATA&&join(process.env.LOCALAPPDATA,'Programs','Git','cmd','git.exe'),process.env['ProgramFiles(x86)']&&join(process.env['ProgramFiles(x86)'],'Git','cmd','git.exe')]
    : ['/usr/bin/git','/usr/local/bin/git',...(process.platform==='darwin'?['/opt/homebrew/bin/git']:[])];
  for(const candidate of candidates)if(candidate){try{await access(candidate,constants.X_OK);return await realpath(candidate);}catch{/* Try the next standard installation. */}}
  throw new Error('Git inspection unavailable: install Git in a standard operating-system location');
}
function environment(binary:string,directory:string,emptyFile:string):NodeJS.ProcessEnv {
  const result:NodeJS.ProcessEnv={
    PATH:process.platform==='win32'?[dirname(binary),join(process.env.SystemRoot??'C:\\Windows','System32')].join(';'):'/usr/bin:/bin',
    HOME:directory,USERPROFILE:directory,XDG_CONFIG_HOME:directory,TEMP:directory,TMP:directory,TMPDIR:directory,
    GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_SYSTEM:emptyFile,GIT_CONFIG_GLOBAL:emptyFile,GIT_CONFIG_COUNT:'0',GIT_ATTR_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',
    LC_ALL:'C',LANG:'C',
  };
  for(const name of ['SystemRoot','WINDIR'])if(process.env[name])result[name]=process.env[name];
  return result;
}
export type GitExecution={binary:string;directory:string;emptyDirectory:string;emptyFile:string;signal:AbortSignal};
export async function gitCommand(execution:GitExecution,args:string[],input?:Iterable<Buffer>,limit=32768):Promise<{stdout:string;truncated:boolean}> {
  execution.signal.throwIfAborted();
  const global=['--no-pager','-c',`core.hooksPath=${execution.emptyDirectory}`,'-c','core.fsmonitor=false','-c',`core.attributesFile=${execution.emptyFile}`,'-c','diff.external=','-c','credential.helper=','-c','protocol.allow=never','-c','maintenance.auto=false','-c','gc.auto=0','-c','core.quotePath=false'];
  return new Promise((resolve,reject)=>{
    const child=spawn(execution.binary,[...global,...args],{cwd:execution.directory,env:environment(execution.binary,execution.directory,execution.emptyFile),windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const chunks:Buffer[]=[];let length=0;let truncated=false;let stderr='';let failure:Error|undefined;
    const cancel=()=>{failure=new Error('Git inspection cancelled');child.kill();};
    execution.signal.addEventListener('abort',cancel,{once:true});
    if(execution.signal.aborted)cancel();
    child.stdout.on('data',(data:Buffer)=>{const remaining=Math.max(0,limit-length);if(data.length>remaining)truncated=true;if(remaining)chunks.push(data.subarray(0,remaining));length+=Math.min(data.length,remaining);});
    child.stderr.on('data',(data:Buffer)=>{if(stderr.length<8192)stderr+=data.toString('utf8').slice(0,8192-stderr.length);});
    child.on('error',error=>{failure=error;});child.stdin.on('error',()=>{failure??=new Error('Git input stream failed');});
    child.on('close',code=>{
      execution.signal.removeEventListener('abort',cancel);
      if(failure)reject(failure);else if(code!==0)reject(new Error(`Git inspection failed (${code}): ${stderr.trim().slice(0,1024)}`));
      else resolve({stdout:Buffer.concat(chunks).toString('utf8'),truncated});
    });
    const iterator=input?.[Symbol.iterator]();
    const pump=()=>{
      if(child.stdin.destroyed || failure)return;
      try {
        if(iterator)while(true){execution.signal.throwIfAborted();const item=iterator.next();if(item.done)break;if(!child.stdin.write(item.value)){child.stdin.once('drain',pump);return;}}
        child.stdin.end();
      }catch(error){failure=error instanceof Error?error:new Error('Git input failed');child.kill();}
    };
    pump();
  });
}
