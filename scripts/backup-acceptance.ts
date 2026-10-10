/** Synthetic stopped-data drill. No production paths or credentials are accepted. */
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {Store} from '../server/db/store.js';
import {openDatabase} from '../server/db/database.js';
import {createBackup,verifyBackup,restoreBackup} from '../server/db/backup.js';

await mkdir('output',{recursive:true});
const directory=await mkdtemp(join(resolve('output'),'backup-acceptance-'));
const source=join(directory,'source'),backup=join(directory,'encrypted');
await mkdir(source);await mkdir(join(source,'artifacts'));
await writeFile(join(source,'backend.json'),JSON.stringify({format:1,backend:'embedded'}));
const key=randomBytes(48),digests=new Map<string,string>();
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const options=JSON.stringify({depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:4096,cloudPolicy:'local_only',budget:{maxCalls:4,maxSeconds:60,maxIterations:3,maxCostUsd:null,localOnly:true}});
const tables=['conversations','tasks','messages','approvals','memory_notes','task_schedules','artifacts','users'];
const snapshot=async(store:Store,expectRevocation=false)=>Promise.all(tables.map(async table=>{
  const rows=await store.db.query(`SELECT ${table==='users'?'id,name,role,enabled,permissions':'*'} FROM ${table} ORDER BY id`);
  // Restore deliberately denies stale pending approvals. Every other retained
  // field, including exact arguments and scope, must still match the source.
  if(expectRevocation&&table==='approvals')for(const row of rows)if(row.status==='pending')row.status='denied';
  return {table,count:rows.length,sha256:hash(JSON.stringify(rows))};
}));
const store=new Store(await openDatabase(join(source,'postgres')));
let before:Awaited<ReturnType<typeof snapshot>>;
try {
  await store.init();
  await store.db.query("INSERT INTO users(id,name,role,permissions) VALUES ('restricted-user','Synthetic reader','chat','{\"providers\":[\"ollama\"],\"workspaceIds\":[],\"maxAccess\":\"read_only\",\"maxConcurrentTasks\":1,\"maxCallsPerTask\":4,\"maxSecondsPerTask\":60,\"dailyCloudBudgetUsd\":0}')");
  await store.db.query("INSERT INTO conversations(id,title,user_id) SELECT 'conversation-'||n,'Synthetic project '||n,'owner' FROM generate_series(1,100) n");
  await store.db.query("INSERT INTO tasks(id,conversation_id,objective,status,options) SELECT 'task-'||n,'conversation-'||((n-1)/20+1),'Synthetic objective '||n,CASE WHEN n<=1990 THEN 'completed' ELSE 'paused' END,$1 FROM generate_series(1,2000) n",[options]);
  await store.db.query("INSERT INTO messages(id,conversation_id,task_id,role,content) SELECT 'message-'||n,'conversation-'||((n-1)/40+1),'task-'||((n-1)/2+1),CASE WHEN n%2=1 THEN 'user' ELSE 'assistant' END,repeat('Synthetic project context. ',80) FROM generate_series(1,4000) n");
  await store.db.query("INSERT INTO approvals(id,task_id,tool_call_id,tool,arguments,reason) SELECT 'approval-'||n,'task-'||(1990+n),'call-'||n,'file_write','{\"path\":\"result.txt\"}','Preserved pending decision' FROM generate_series(1,10) n");
  await store.db.query("INSERT INTO memory_notes(id,user_id,title,content) SELECT 'memory-'||n,'owner','Project fact '||n,'Approved synthetic fact' FROM generate_series(1,50) n");
  await store.db.query("INSERT INTO task_schedules(id,user_id,name,objective,options,session_version,grant_snapshot,interval_minutes,missed_policy,next_run_at) SELECT 'schedule-'||n,'owner','Health '||n,'Synthetic health report',$1,0,'{}',60,'once',now()+interval '1 day' FROM generate_series(1,10) n",[options]);
  for(let n=1;n<=200;n++) {
    const path=`artifacts/result-${n}.txt`,content=`Synthetic artifact ${n}\n${'Verified content\n'.repeat(1024)}`;
    await writeFile(join(source,path),content);digests.set(path,hash(content));
    await store.db.query('INSERT INTO artifacts(id,task_id,name,path,mime) VALUES ($1,$2,$3,$4,$5)',[`artifact-${n}`,`task-${n}`,`result-${n}.txt`,path,'text/plain']);
  }
  await store.db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ('synthetic-session','owner','synthetic-csrf',false,'drill',0,now()+interval '1 day')");
  before=await snapshot(store,true);
} finally {await store.close();}
try {
  const start=performance.now(),created=await createBackup({sourceDir:source,backupDir:backup,passphrase:key});
  const createMs=performance.now()-start,verifyStart=performance.now();
  const verified=await verifyBackup({backupDir:backup,passphrase:key});
  assert.equal(verified.files,created.files);
  const verifyMs=performance.now()-verifyStart,restoreStart=performance.now();
  const restored=await restoreBackup({backupDir:backup,destinationDir:join(directory,'restored'),passphrase:key});
  const restoreMs=performance.now()-restoreStart,copy=new Store(await openDatabase(join(restored.dataDirectory,'postgres')));
  try {
    assert.deepEqual(await snapshot(copy),before,'Historical records, pending decisions and artifact references must survive exactly');
    assert.equal((await copy.db.query('SELECT count(*) AS count FROM sessions'))[0].count,0);
    assert.equal((await copy.db.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0].value,true);
    assert.equal((await copy.control()).stopped,true);
    await assert.rejects(copy.createTask('conversation-1','Must remain stopped',JSON.parse(options)),/stop|restor/i);
    for(const [path,digest] of digests)assert.equal(hash(await readFile(join(restored.dataDirectory,path))),digest);
  } finally {await copy.close();}
  const report={protocol:'relay-encrypted-restore-v1',testedAt:new Date().toISOString(),platform:process.platform,node:process.version,passed:true,records:before!,artifactsVerified:digests.size,backup:created,createMs,verifyMs,restoreMs,checks:['Retained relational hashes match except required pending-approval denial','Every referenced artifact read back and hashed','Sessions revoked and pending approvals denied with arguments retained','Restored execution remains stopped pending review']};
  await writeFile('output/backup-acceptance.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
} finally {key.fill(0);}
