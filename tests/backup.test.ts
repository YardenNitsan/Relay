import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,stat,link,symlink,readdir,statfs} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import {openDatabase} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {createBackup,verifyBackup,restoreBackup,validateBackupPath,requiredBackupSpace,backupPgliteVersion} from '../server/db/backup.js';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,statfs:vi.fn(actual.statfs)};});

let root:string,source:string,backup:string;
const passphrase=Buffer.from('fixture-only-long-backup-passphrase');
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),'relay-backup-test-'));source=join(root,'source');backup=join(root,'encrypted');await mkdir(source);
  await writeFile(join(source,'backend.json'),JSON.stringify({format:1,backend:'embedded'}));
  const db=await openDatabase(join(source,'postgres'));const store=new Store(db);await store.init();
  await db.query("INSERT INTO conversations(id,title) VALUES ('keep','Private conversation')");
  await db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ('old-session','owner','private-csrf',false,'test',0,now()+interval '1 day')");
  await db.query("INSERT INTO inference_tokens(id,user_id,token_hash,label,session_version,expires_at) VALUES ('old-token','owner','private-hash','test',0,now()+interval '1 day')");
  await db.query("INSERT INTO settings(key,value) VALUES ('remote_enabled','true')");await db.close();
  for(const dir of ['artifacts','workspaces','checkpoints','baselines','host-checkpoints','auth','startup'])await mkdir(join(source,dir));
  await writeFile(join(source,'artifacts','private.env'),'secret artifact retained inside encryption');await writeFile(join(source,'checkpoints','keep.json'),'checkpoint bytes');await writeFile(join(source,'auth','owner-pairing.json'),'must not archive');await writeFile(join(source,'startup','setup-host.json'),'must not archive');
  await createBackup({sourceDir:source,backupDir:backup,passphrase});
},90000);
afterAll(async()=>{passphrase.fill(0);await rm(root,{recursive:true,force:true});});
describe('offline encrypted embedded backups',()=>{
  it('refuses an interrupted startup guard without copying it into a restore',async()=>{
    await writeFile(join(source,'.service-start.lock'),'2147483647');
    try{await expect(createBackup({sourceDir:source,backupDir:join(root,'starting'),passphrase})).rejects.toThrow(/startup|service-start/i);}
    finally{await rm(join(source,'.service-start.lock'));}
  });
  it('requires complete snapshot space plus encryption overhead and 5 GiB safety headroom',()=>{
    expect(requiredBackupSpace(1000,3)).toBe(1000+3*28+8*1024**2+4096+5*1024**3);expect(()=>requiredBackupSpace(-1,3)).toThrow();expect(()=>requiredBackupSpace(Number.MAX_SAFE_INTEGER,1)).toThrow();
  });
  it('pins its supported PGlite file format to the installed dependency',async()=>{
    const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.resolve('@electric-sql/pglite')),'utf8'));expect(metadata.version).toBe(backupPgliteVersion);
  });
  it('refuses to create a restore destination when free space cannot preserve the reserve',async()=>{
    const actual=await statfs(root,{bigint:true});vi.mocked(statfs).mockResolvedValueOnce({...actual,bavail:1n});
    const destination=join(root,'low-space');await expect(restoreBackup({backupDir:backup,destinationDir:destination,passphrase})).rejects.toThrow(/disk space|headroom/i);await expect(stat(destination)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('verifies an encrypted snapshot and restores to a new stopped, credential-invalidated data directory',async()=>{
    const verified=await verifyBackup({backupDir:backup,passphrase});expect(verified.files).toBeGreaterThan(2);expect(verified.bytes).toBeGreaterThan(0);
    const restored=await restoreBackup({backupDir:backup,destinationDir:join(root,'restore'),passphrase});expect(restored.dataDirectory).toBe(join(root,'restore','data'));
    expect(await readFile(join(restored.dataDirectory,'artifacts','private.env'),'utf8')).toBe('secret artifact retained inside encryption');expect(await readFile(join(restored.dataDirectory,'checkpoints','keep.json'),'utf8')).toBe('checkpoint bytes');
    await expect(stat(join(restored.dataDirectory,'auth'))).rejects.toMatchObject({code:'ENOENT'});await expect(stat(join(restored.dataDirectory,'startup'))).rejects.toMatchObject({code:'ENOENT'});
    const db=await openDatabase(join(restored.dataDirectory,'postgres'));try{
      expect((await db.query('SELECT title FROM conversations'))[0].title).toBe('Private conversation');expect(await db.query('SELECT id FROM sessions')).toHaveLength(0);expect(await db.query('SELECT id FROM inference_tokens')).toHaveLength(0);
      expect((await db.query("SELECT session_version FROM users WHERE id='owner'"))[0].session_version).toBe(1);
      expect((await db.query("SELECT value FROM settings WHERE key='control'"))[0].value).toMatchObject({stopped:true});expect((await db.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0].value).toBe(true);
      expect(await db.query("SELECT provider FROM provider_connections WHERE provider IN ('openai','anthropic','gemini','xai','deepseek') AND enabled=true")).toHaveLength(0);
    }finally{await db.close();}
    await expect(restoreBackup({backupDir:backup,destinationDir:join(root,'restore'),passphrase})).rejects.toThrow(/exist|new/i);
  },90000);
  it('rejects wrong passphrases without creating a restored directory',async()=>{
    await expect(verifyBackup({backupDir:backup,passphrase:Buffer.from('wrong-fixture-passphrase')})).rejects.toThrow(/authentication|passphrase|integrity/i);
    const dest=join(root,'wrong');await expect(restoreBackup({backupDir:backup,destinationDir:dest,passphrase:Buffer.from('wrong-fixture-passphrase')})).rejects.toThrow();await expect(stat(dest)).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects ciphertext tampering',async()=>{
    const damaged=join(root,'tampered');await cp(backup,damaged,{recursive:true});const manifest=await readFile(join(damaged,'manifest.enc'));manifest[15]^=1;await writeFile(join(damaged,'manifest.enc'),manifest);
    await expect(verifyBackup({backupDir:damaged,passphrase})).rejects.toThrow(/authentication|integrity/i);
  });
  it('authenticates file blobs and never publishes a damaged restore',async()=>{
    const damaged=join(root,'blob-tampered');await cp(backup,damaged,{recursive:true});const blob=(await readdir(join(damaged,'blobs')))[0],path=join(damaged,'blobs',blob),bytes=await readFile(path);bytes[12]^=1;await writeFile(path,bytes);
    await expect(verifyBackup({backupDir:damaged,passphrase})).rejects.toThrow(/integrity|authentication/i);
    const destination=join(root,'bad-restore');await expect(restoreBackup({backupDir:damaged,destinationDir:destination,passphrase})).rejects.toThrow(/integrity|authentication/i);await expect(stat(join(destination,'data'))).rejects.toMatchObject({code:'ENOENT'});
  },90000);
  it('refuses stale backup guards, configured size limits and redirected directory ancestry',async()=>{
    await writeFile(join(source,'.backup.lock'),'2147483647');try{await expect(createBackup({sourceDir:source,backupDir:join(root,'guarded'),passphrase})).rejects.toThrow(/backup.lock/i);expect(await readFile(join(source,'.backup.lock'),'utf8')).toBe('2147483647');}finally{await rm(join(source,'.backup.lock'));}
    await expect(verifyBackup({backupDir:backup,passphrase,limits:{maxBytes:1}})).rejects.toThrow(/size|limit/i);
    const alias=join(root,'alias');await symlink(source,alias,process.platform==='win32'?'junction':'dir');try{await expect(createBackup({sourceDir:alias,backupDir:join(root,'linked-source'),passphrase})).rejects.toThrow(/link|reparse/i);await expect(createBackup({sourceDir:join(alias,'artifacts'),backupDir:join(root,'linked-parent'),passphrase})).rejects.toThrow(/link|reparse/i);}finally{await rm(alias);}
  });
  it('refuses every existing service lock, including a stale PID, and leaves it intact',async()=>{
    for(const pid of [process.pid,2147483647]){await writeFile(join(source,'service.lock'),String(pid));await expect(createBackup({sourceDir:source,backupDir:join(root,`locked-${pid}`),passphrase})).rejects.toThrow(/lock|running|shutdown/i);expect(await readFile(join(source,'service.lock'),'utf8')).toBe(String(pid));await rm(join(source,'service.lock'));}
  });
  it('refuses source/destination overlap, native PostgreSQL markers and hardlinked source files',async()=>{
    await expect(createBackup({sourceDir:source,backupDir:join(source,'backup'),passphrase})).rejects.toThrow(/overlap|outside/i);
    const native=join(root,'native');await mkdir(native);await writeFile(join(native,'backend.json'),'{"format":1,"backend":"postgresql"}');await expect(createBackup({sourceDir:native,backupDir:join(root,'native-backup'),passphrase})).rejects.toThrow(/embedded|PostgreSQL/i);
    await link(join(source,'artifacts','private.env'),join(source,'artifacts','linked'));try{await expect(createBackup({sourceDir:source,backupDir:join(root,'hardlinked'),passphrase})).rejects.toThrow(/link/i);}finally{await rm(join(source,'artifacts','linked'));}
  });
  it.each(['../escape','/absolute','C:/windows','nested\\escape','x/../y','CON','name.','a:b','a//b'])('rejects unsafe portable archive path %s',path=>{expect(()=>validateBackupPath(path)).toThrow();});
  it('validates paths even in an authenticated manifest',async()=>{
    const malicious=join(root,'traversal');await cp(backup,malicious,{recursive:true});const header=JSON.parse(await readFile(join(malicious,'backup.json'),'utf8'));
    const key=scryptSync(passphrase,Buffer.from(header.salt,'hex'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});try{
      const packed=await readFile(join(malicious,'manifest.enc'));const decipher=createDecipheriv('aes-256-gcm',key,packed.subarray(0,12));decipher.setAAD(Buffer.from('relay-backup-v1:manifest'));decipher.setAuthTag(packed.subarray(-16));
      const manifest=JSON.parse(Buffer.concat([decipher.update(packed.subarray(12,-16)),decipher.final()]).toString('utf8'));manifest.files[0].path='../escape';
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('relay-backup-v1:manifest'));const ciphertext=Buffer.concat([cipher.update(JSON.stringify(manifest)),cipher.final()]);await writeFile(join(malicious,'manifest.enc'),Buffer.concat([iv,ciphertext,cipher.getAuthTag()]));
      await expect(restoreBackup({backupDir:malicious,destinationDir:join(root,'unsafe-restore'),passphrase})).rejects.toThrow(/path|manifest/i);
    }finally{key.fill(0);}
  });
});
