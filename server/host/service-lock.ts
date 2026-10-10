import {lstat,open,unlink,type FileHandle} from 'node:fs/promises';
import {join} from 'node:path';

type LockOptions={isAlive?:(pid:number)=>Promise<boolean>};
const absent=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function assertNoBackup(directory:string){
  try{await lstat(join(directory,'.backup.lock'));}catch(error){if(absent(error))return;throw error;}
  throw new Error('Offline backup holds this directory. Wait for it to finish; inspect a stale backup lock before restarting.');
}
async function alive(pid:number){
  try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}
}
async function removeOwned(path:string,handle:FileHandle){
  const [held,current]=await Promise.all([handle.stat(),lstat(path)]);
  if(!current.isFile()||current.isSymbolicLink()||current.nlink!==1||current.dev!==held.dev||current.ino!==held.ino)throw new Error('Relay lock identity changed; refusing to remove it.');
  await unlink(path);
}

/** The caller must first secure this local data directory with privateDirectory.
 * An exclusive short-lived guard serializes stale PID reclamation. A crash while
 * holding the guard deliberately requires offline inspection, never timed theft.
 * This is cooperative single-host locking, not a hostile same-user boundary.
 */
export async function acquireServiceLock(directory:string,options:LockOptions={}):Promise<{release:()=>Promise<void>}>{
  await assertNoBackup(directory);
  const guardPath=join(directory,'.service-start.lock'),path=join(directory,'service.lock');
  let guard:FileHandle;
  try{guard=await open(guardPath,'wx',0o600);}catch(error){
    if((error as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Relay startup is already in progress. If no process is starting, inspect the interrupted .service-start.lock offline before retrying.');
    throw error;
  }
  let owned:FileHandle|undefined;
  try{
    await guard.writeFile(String(process.pid));
    await assertNoBackup(directory);
    try{
      const info=await lstat(path);
      if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>32)throw new Error('Relay service lock is invalid; inspect it offline.');
      const previous=await open(path,'r');
      try{
        const text=await previous.readFile('utf8'),pid=Number(text);
        if(!/^[1-9]\d*$/.test(text)||!Number.isSafeInteger(pid))throw new Error('Relay service lock is incomplete. Another process may be starting; retry shortly.');
        if(await (options.isAlive??alive)(pid))throw new Error('Relay is already running for this data directory');
        await removeOwned(path,previous);
      }finally{await previous.close();}
    }catch(error){if(!absent(error))throw error;}
    owned=await open(path,'wx',0o600);
    await owned.writeFile(String(process.pid));await owned.sync();
    await assertNoBackup(directory);
  }catch(error){
    if(owned){try{await removeOwned(path,owned);}finally{await owned.close();}}
    throw error;
  }finally{
    try{await removeOwned(guardPath,guard);}finally{await guard.close();}
  }
  const held=owned;let released=false;
  return {release:async()=>{
    if(released)return;released=true;
    try{await removeOwned(path,held);}finally{await held.close();}
  }};
}
