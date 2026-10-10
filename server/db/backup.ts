import {constants} from 'node:fs';
import {lstat,realpath,open,mkdir,opendir,unlink,rename,rm,statfs,type FileHandle} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {createCipheriv,createDecipheriv,createHash,randomBytes,scrypt} from 'node:crypto';
import {z} from 'zod';
import {privateDirectory} from '../host/private-storage.js';
import {openDatabase} from './database.js';
import {Store} from './store.js';
import {relocateManagedWorktrees} from './worktree-relocation.js';
import appPackage from '../../package.json' with {type:'json'};

export interface BackupLimits {maxFiles:number;maxBytes:number;maxFileBytes:number;}
const hardLimits:BackupLimits={maxFiles:20000,maxBytes:8*1024**3,maxFileBytes:2*1024**3};
export interface BackupInput {backupDir:string;passphrase:Buffer;limits?:Partial<BackupLimits>;}
export interface BackupSummary {format:1;backend:'embedded';files:number;bytes:number;createdAt:string;}
export interface RestoreSummary extends BackupSummary {dataDirectory:string;}
const excluded=new Set(['service.lock','.backup.lock','.service-start.lock','auth','startup']);
const blockBytes=64*1024,manifestBytes=8*1024*1024;
// File-format compatibility is tested against this exact installed PGlite release.
export const backupPgliteVersion='0.5.8';
const fileSchema=z.object({path:z.string(),blob:z.string().regex(/^[0-9a-f]{32}\.bin$/),bytes:z.number().int().nonnegative(),sha256:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const manifestSchema=z.object({format:z.literal(1),backend:z.literal('embedded'),producer:z.object({relay:z.string().max(80),pglite:z.literal(backupPgliteVersion)}).strict(),createdAt:z.iso.datetime(),directories:z.array(z.string()).max(20000),files:z.array(fileSchema).max(20000)}).strict();
type Manifest=z.infer<typeof manifestSchema>;
const headerSchema=z.object({format:z.literal(1),cipher:z.literal('aes-256-gcm'),kdf:z.literal('scrypt-N32768-r8-p1'),salt:z.string().regex(/^[0-9a-f]{64}$/)}).strict();
const markerSchema=z.object({format:z.literal(1),backend:z.literal('embedded')}).strict();
const comparable=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
const inside=(base:string,path:string)=>{const rel=relative(comparable(base),comparable(path));return rel===''||rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel);};
function failed(message:string):never {throw new Error(message);}

/** Portable paths deliberately do not apply workspace secret/generated-file filters. */
export function validateBackupPath(path:string):string {
  if(typeof path!=='string'||!path||path.length>2048||/[\\:\x00-\x1f\x7f]/.test(path)||/\p{Cf}/u.test(path)||path.startsWith('/'))failed('Unsafe backup manifest path');
  const parts=path.split('/');
  if(parts.length>32||parts.some(part=>!part||part==='.'||part==='..'||part.length>200||/[. ]$/.test(part)||/[<>"|?*]/.test(part)||/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))failed('Unsafe backup manifest path');
  return path;
}
function limits(input?:Partial<BackupLimits>):BackupLimits {
  const result={...hardLimits,...input};
  for(const key of Object.keys(hardLimits) as (keyof BackupLimits)[])if(!Number.isSafeInteger(result[key])||result[key]<1||result[key]>hardLimits[key])failed('Invalid backup size/file limits');
  return result;
}
export function requiredBackupSpace(bytes:number,files:number):number {
  if(!Number.isSafeInteger(bytes)||bytes<0||!Number.isSafeInteger(files)||files<0)failed('Invalid backup space estimate');
  const required=bytes+files*28+manifestBytes+4096+5*1024**3;if(!Number.isSafeInteger(required))failed('Backup space estimate exceeds supported limits');return required;
}
async function requireDiskSpace(path:string,bytes:number,files:number):Promise<void>{
  const info=await statfs(path,{bigint:true}),available=info.bavail*info.bsize;
  if(info.bsize<=0n||available<BigInt(requiredBackupSpace(bytes,files)))failed('Insufficient backup disk space: snapshot size plus 5 GiB safety headroom is required');
}
function absolute(path:string):string {
  if(typeof path!=='string'||!isAbsolute(path)||path.startsWith('\\\\')||path.startsWith('//'))failed('Backup paths must be absolute local paths');
  const result=resolve(path);if(result===dirname(result))failed('A filesystem root cannot be a backup source or destination');return result;
}
async function directory(path:string):Promise<void>{
  const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink()||comparable(await realpath(path))!==comparable(path))failed('Links or reparse points are not allowed in backup directories');
}
async function inspect(base:string,path:string):Promise<Awaited<ReturnType<typeof lstat>>>{
  validateBackupPath(path);let target=base;
  for(const part of path.split('/')){
    target=join(target,part);const info=await lstat(target);
    if(info.isSymbolicLink()||!info.isDirectory()&&(!info.isFile()||info.nlink!==1)||comparable(await realpath(target))!==comparable(target))failed('Links, hardlinks, reparse points and special files are not supported in backups');
  }
  return lstat(target);
}
async function newDirectory(path:string):Promise<void>{
  await directory(dirname(path));
  try{await mkdir(path,{mode:0o700});}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')failed('Backup destination must be a new directory; it already exists');throw error;}
  await privateDirectory(path);
}
function same(a:{dev:number|bigint;ino:number|bigint;size:number|bigint;mtimeMs:number|bigint;ctimeMs:number|bigint},b:typeof a):boolean {return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;}
async function readHandle(base:string,path:string):Promise<FileHandle>{
  const prior=await inspect(base,path);if(!prior.isFile())failed('Backup entry is not a regular file');
  const handle=await open(join(base,path),constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW));
  const current=await handle.stat();if(!current.isFile()||current.nlink!==1||!same(prior,current)){await handle.close();failed('Backup file changed while opening');}return handle;
}
async function readBounded(base:string,path:string,max:number):Promise<Buffer>{
  const handle=await readHandle(base,path);try{const size=(await handle.stat()).size;if(size>max)failed('Backup metadata exceeds its size limit');const data=Buffer.alloc(size);let at=0;while(at<size){const {bytesRead}=await handle.read(data,at,size-at,at);if(!bytesRead)failed('Backup metadata was truncated');at+=bytesRead;}return data;}finally{await handle.close();}
}
async function writeAll(file:FileHandle,data:Buffer):Promise<void>{let at=0;while(at<data.length){const {bytesWritten}=await file.write(data,at,data.length-at);if(!bytesWritten)failed('Could not write backup data');at+=bytesWritten;}}
async function keyFor(passphrase:Buffer,salt:Buffer):Promise<Buffer>{
  if(!Buffer.isBuffer(passphrase)||passphrase.length<12||passphrase.length>1024)failed('Backup passphrase must contain 12–1024 bytes');
  const copy=Buffer.from(passphrase);try{return await new Promise<Buffer>((accept,reject)=>scrypt(copy,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):accept(key)));}finally{copy.fill(0);}
}
const aad=(id:string)=>Buffer.from(`relay-backup-v1:${id}`);
function encryptBuffer(plain:Buffer,key:Buffer,id:string):Buffer {const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(id));const content=Buffer.concat([cipher.update(plain),cipher.final()]);return Buffer.concat([iv,content,cipher.getAuthTag()]);}
function decryptBuffer(packed:Buffer,key:Buffer,id:string):Buffer {
  try{if(packed.length<28)failed('Truncated encryption');const cipher=createDecipheriv('aes-256-gcm',key,packed.subarray(0,12));cipher.setAAD(aad(id));cipher.setAuthTag(packed.subarray(-16));return Buffer.concat([cipher.update(packed.subarray(12,-16)),cipher.final()]);}
  catch{failed('Backup authentication failed: wrong passphrase or damaged integrity');}
}
async function writeNew(path:string,data:Buffer|string):Promise<void>{const file=await open(path,'wx',0o600);try{await file.writeFile(data);await file.sync();}finally{await file.close();}}
interface SourceFile {path:string;size:number;dev:number|bigint;ino:number|bigint;mtimeMs:number|bigint;ctimeMs:number|bigint;}
async function inventory(root:string,bounds:BackupLimits):Promise<{files:SourceFile[];directories:string[]}>{
  const files:SourceFile[]=[],directories:string[]=[],names=new Set<string>();let bytes=0;
  async function visit(rel:string):Promise<void>{
    const entries=await opendir(join(root,rel));
    for await(const entry of entries){
      if(!rel&&excluded.has(entry.name.toLowerCase()))continue;
      const path=rel?`${rel}/${entry.name}`:entry.name;validateBackupPath(path);
      const normalized=path.normalize('NFC').toLowerCase();if(names.has(normalized))failed('Backup contains nonportable colliding paths');names.add(normalized);
      const info=await inspect(root,path);
      if(info.isDirectory()){directories.push(path);if(directories.length>bounds.maxFiles)failed('Backup directory count exceeds limit');await visit(path);}
      else{const size=Number(info.size);bytes+=size;if(size>bounds.maxFileBytes||bytes>bounds.maxBytes||files.length>=bounds.maxFiles)failed('Backup data exceeds configured size/file limits');files.push({path,size,dev:info.dev,ino:info.ino,mtimeMs:info.mtimeMs,ctimeMs:info.ctimeMs});}
    }
  }
  await visit('');files.sort((a,b)=>a.path.localeCompare(b.path));directories.sort();return {files,directories};
}
async function encryptFile(source:string,file:SourceFile,output:string,blob:string,key:Buffer):Promise<string>{
  const input=await readHandle(source,file.path);let target:FileHandle|undefined;
  try{
    if(!same({...file,size:file.size},await input.stat()))failed('Backup source changed since inventory');
    target=await open(join(output,'blobs',blob),'wx',0o600);const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),hash=createHash('sha256');cipher.setAAD(aad(blob));await writeAll(target,iv);
    const buffer=Buffer.alloc(blockBytes);let count=0;
    while(true){const {bytesRead}=await input.read(buffer,0,buffer.length,null);if(!bytesRead)break;count+=bytesRead;if(count>file.size)failed('Backup source grew while copying');const part=buffer.subarray(0,bytesRead);hash.update(part);await writeAll(target,cipher.update(part));}
    if(count!==file.size||!same({...file,size:file.size},await input.stat()))failed('Backup source changed while copying');
    await writeAll(target,cipher.final());await writeAll(target,cipher.getAuthTag());await target.sync();return hash.digest('hex');
  }finally{await input.close();await target?.close();}
}
function validateManifest(value:unknown,bounds:BackupLimits):Manifest {
  const manifest=manifestSchema.parse(value),paths=new Set<string>(),blobs=new Set<string>();let bytes=0;
  if(manifest.files.length>bounds.maxFiles||manifest.directories.length>bounds.maxFiles)failed('Backup manifest exceeds configured file limit');
  for(const path of [...manifest.directories,...manifest.files.map(file=>file.path)]){
    validateBackupPath(path);if(excluded.has(path.split('/')[0].toLowerCase()))failed('Operational authentication/lock paths are forbidden in a backup manifest');
    const key=path.normalize('NFC').toLowerCase();if(paths.has(key))failed('Duplicate backup manifest path');paths.add(key);
  }
  const dirs=new Set(manifest.directories);
  for(const path of [...manifest.directories,...manifest.files.map(file=>file.path)]){const parent=path.split('/').slice(0,-1).join('/');if(parent&&!dirs.has(parent))failed('Backup manifest path has no declared parent directory');}
  for(const file of manifest.files){bytes+=file.bytes;if(file.bytes>bounds.maxFileBytes||bytes>bounds.maxBytes||blobs.has(file.blob))failed('Backup manifest size or blob identity is invalid');blobs.add(file.blob);}
  if(!manifest.files.some(file=>file.path==='backend.json')||!manifest.files.some(file=>file.path==='postgres/PG_VERSION'))failed('Backup manifest does not contain an embedded database');return manifest;
}
async function load(input:BackupInput):Promise<{root:string;key:Buffer;manifest:Manifest}>{
  const root=absolute(input.backupDir);await directory(root);const bounds=limits(input.limits);
  const header=headerSchema.parse(JSON.parse((await readBounded(root,'backup.json',4096)).toString('utf8'))),key=await keyFor(input.passphrase,Buffer.from(header.salt,'hex'));
  try{
    const plain=decryptBuffer(await readBounded(root,'manifest.enc',manifestBytes+28),key,'manifest');let manifest:Manifest;
    try{manifest=validateManifest(JSON.parse(plain.toString('utf8')),bounds);}finally{plain.fill(0);}
    return {root,key,manifest};
  }catch(error){key.fill(0);throw error;}
}
async function decryptFile(root:string,file:Manifest['files'][number],key:Buffer,destination?:string):Promise<void>{
  const input=await readHandle(root,`blobs/${file.blob}`);let target:FileHandle|undefined;
  try{
    if((await input.stat()).size!==file.bytes+28)failed('Backup blob length failed integrity verification');
    const iv=Buffer.alloc(12),tag=Buffer.alloc(16);if((await input.read(iv,0,12,0)).bytesRead!==12||(await input.read(tag,0,16,file.bytes+12)).bytesRead!==16)failed('Backup blob is truncated');
    const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(file.blob));cipher.setAuthTag(tag);const hash=createHash('sha256');
    if(destination)target=await open(destination,'wx',0o600);const buffer=Buffer.alloc(blockBytes);let at=0;
    while(at<file.bytes){const {bytesRead}=await input.read(buffer,0,Math.min(blockBytes,file.bytes-at),at+12);if(!bytesRead)failed('Backup blob truncated during verification');at+=bytesRead;const plain=cipher.update(buffer.subarray(0,bytesRead));hash.update(plain);if(target)await writeAll(target,plain);plain.fill(0);}
    let last:Buffer;try{last=cipher.final();}catch{failed('Backup blob authentication/integrity failed');}hash.update(last);if(target)await writeAll(target,last);last.fill(0);
    if(hash.digest('hex')!==file.sha256)failed('Backup file digest failed integrity verification');if(target)await target.sync();
  }finally{await input.close();await target?.close();}
}
const summary=(manifest:Manifest):BackupSummary=>({format:1,backend:'embedded',files:manifest.files.length,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),createdAt:manifest.createdAt});
async function releaseLock(path:string,lock:FileHandle):Promise<void>{
  const owned=await lock.stat();await lock.close();const current=await lstat(path).catch(()=>undefined);
  if(current?.dev===owned.dev&&current.ino===owned.ino&&!current.isSymbolicLink())await unlink(path);
}
async function checkLock(root:string,name:string,lock:FileHandle):Promise<void>{
  const owned=await lock.stat(),current=await inspect(root,name);
  if(!same(owned,current)||(await readBounded(root,name,32)).toString()!==String(process.pid))failed('Backup source lock ownership changed');
}

export async function createBackup(input:BackupInput&{sourceDir:string}):Promise<BackupSummary>{
  const source=absolute(input.sourceDir),output=absolute(input.backupDir),bounds=limits(input.limits);if(inside(source,output)||inside(output,source))failed('Backup destination must be outside and not overlap the source');await directory(source);
  try{markerSchema.parse(JSON.parse((await readBounded(source,'backend.json',4096)).toString('utf8')));}catch{failed('Only an explicitly marked embedded PGlite directory supports this offline backup; PostgreSQL requires native backup tooling');}
  let guard:FileHandle;try{guard=await open(join(source,'.backup.lock'),'wx',0o600);}catch{failed('Source .backup.lock must be absent; another backup or an interrupted backup requires review');}
  let lock:FileHandle|undefined;
  let key:Buffer|undefined;
  try{
    await guard.writeFile(String(process.pid));await guard.sync();
    try{await lstat(join(source,'.service-start.lock'));failed('Relay startup guard exists. Finish startup/shutdown or inspect the interrupted .service-start.lock before backup');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    try{lock=await open(join(source,'service.lock'),'wx',0o600);}catch{failed('Source service.lock must be absent. Fully shut down Relay; stale locks are also refused');}
    await lock.writeFile(String(process.pid));await lock.sync();const initial=await inventory(source,bounds);await directory(dirname(output));await requireDiskSpace(dirname(output),initial.files.reduce((sum,file)=>sum+file.size,0),initial.files.length);await newDirectory(output);await mkdir(join(output,'blobs'),{mode:0o700});
    const salt=randomBytes(32);key=await keyFor(input.passphrase,salt);const manifest:Manifest={format:1,backend:'embedded',producer:{relay:appPackage.version,pglite:backupPgliteVersion},createdAt:new Date().toISOString(),directories:initial.directories,files:[]};
    for(const file of initial.files){await checkLock(source,'.backup.lock',guard);await checkLock(source,'service.lock',lock);const blob=`${randomBytes(16).toString('hex')}.bin`;manifest.files.push({path:file.path,blob,bytes:file.size,sha256:await encryptFile(source,file,output,blob,key)});}
    if(JSON.stringify(initial)!==JSON.stringify(await inventory(source,bounds)))failed('Backup source changed while copying; snapshot was not completed');validateManifest(manifest,bounds);
    const plain=Buffer.from(JSON.stringify(manifest));try{if(plain.length>manifestBytes)failed('Backup manifest exceeds its size limit');await writeNew(join(output,'manifest.enc'),encryptBuffer(plain,key,'manifest'));}finally{plain.fill(0);}
    // Header is the completion marker: interrupted snapshots are never accepted.
    await checkLock(source,'.backup.lock',guard);await checkLock(source,'service.lock',lock);
    await writeNew(join(output,'backup.json'),JSON.stringify({format:1,cipher:'aes-256-gcm',kdf:'scrypt-N32768-r8-p1',salt:salt.toString('hex')}));return summary(manifest);
  }finally{
    key?.fill(0);try{if(lock)await releaseLock(join(source,'service.lock'),lock);}finally{await releaseLock(join(source,'.backup.lock'),guard);}
  }
}
export async function verifyBackup(input:BackupInput):Promise<BackupSummary>{
  const {root,key,manifest}=await load(input);try{for(const file of manifest.files)await decryptFile(root,file,key);return summary(manifest);}finally{key.fill(0);}
}
export async function restoreBackup(input:BackupInput&{destinationDir:string}):Promise<RestoreSummary>{
  const destination=absolute(input.destinationDir),backup=absolute(input.backupDir);if(inside(backup,destination)||inside(destination,backup))failed('Restore destination must not overlap the encrypted backup');
  const {root,key,manifest}=await load(input);let stage:string|undefined;let identity:Awaited<ReturnType<typeof lstat>>|undefined;
  try{
    await directory(dirname(destination));await requireDiskSpace(dirname(destination),summary(manifest).bytes,manifest.files.length);
    await newDirectory(destination);stage=join(destination,`.staging-${randomBytes(16).toString('hex')}`);await mkdir(stage,{mode:0o700});identity=await lstat(stage);
    await writeNew(join(stage,'service.lock'),String(process.pid));
    for(const dir of [...manifest.directories].sort((a,b)=>a.split('/').length-b.split('/').length))await mkdir(join(stage,dir),{mode:0o700});
    for(const file of manifest.files)await decryptFile(root,file,key,join(stage,file.path));
    markerSchema.parse(JSON.parse((await readBounded(stage,'backend.json',4096)).toString('utf8')));
    const dataDirectory=join(destination,'data');
    // Only authenticated staging is repaired; old absolute pointers are never followed.
    // Git must not run here: these bindings become usable only after the final rename.
    const relocation=await relocateManagedWorktrees(stage,dataDirectory);
    const db=await openDatabase(join(stage,'postgres'));
    try{
      const store=new Store(db);await store.init();await store.recover();
      await db.transaction(async tx=>{
        await tx.exec('DELETE FROM sessions; DELETE FROM inference_tokens; DELETE FROM lan_invitations; UPDATE users SET session_version=session_version+1');
        await tx.query("UPDATE settings SET value=jsonb_build_object('stopped',true,'generation',COALESCE((value->>'generation')::integer,0)+1) WHERE key='control'");
        await tx.query("INSERT INTO settings(key,value) VALUES ('remote_enabled','false'),('restoration_pending','true') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value");
        for(const provider of ['openai','anthropic','gemini','xai','deepseek']){
          await tx.query('INSERT INTO provider_connections(provider,enabled) VALUES ($1,false) ON CONFLICT(provider) DO UPDATE SET enabled=false',[provider]);
          await tx.query('INSERT INTO user_provider_connections(user_id,provider,enabled) SELECT id,$1,false FROM users ON CONFLICT(user_id,provider) DO UPDATE SET enabled=false',[provider]);
        }
        await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('BACKUP_RESTORED',$1)",[JSON.stringify({format:1,createdAt:manifest.createdAt,restorationPending:true,credentialsInvalidated:true,repairedWorktrees:relocation.repaired})]);
      });
    }finally{await db.close();}
    await unlink(join(stage,'service.lock'));await rename(stage,dataDirectory);stage=undefined;return {...summary(manifest),dataDirectory};
  }finally{
    key.fill(0);
    if(stage&&identity){const current=await lstat(stage).catch(()=>undefined);if(current?.dev===identity.dev&&current.ino===identity.ino&&!current.isSymbolicLink()&&inside(destination,stage)&&comparable(await realpath(stage))===comparable(stage))await rm(stage,{recursive:true,force:true});}
  }
}
