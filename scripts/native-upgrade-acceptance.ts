import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {migrate,migrations} from '../server/db/migrations.js';
import type {Store} from '../server/db/store.js';
import type {TaskOptions} from '../shared/types.js';

/** Runs only after the caller verifies an empty disposable integration database. */
export async function verifyNativeUpgrade(first:Store,second:Store,options:TaskOptions):Promise<string[]> {
  await migrate(first.db,migrations.filter(item=>item.version<=9));
  await first.db.query("INSERT INTO conversations(id,title,user_id) VALUES ('upgrade-conversation','Preserved conversation','owner')");
  await first.db.query("INSERT INTO tasks(id,conversation_id,objective,status,options) VALUES ('upgrade-task','upgrade-conversation','Preserved approval','waiting_for_approval',$1)",[JSON.stringify(options)]);
  await first.db.query("INSERT INTO messages(id,conversation_id,task_id,role,content) VALUES ('upgrade-message','upgrade-conversation','upgrade-task','user','Preserved message')");
  await first.db.query("INSERT INTO approvals(id,task_id,tool_call_id,tool,arguments,reason) VALUES ('upgrade-approval','upgrade-task','upgrade-call','file_write','{\"path\":\"result.txt\"}','Preserved pending approval')");
  await first.db.query("INSERT INTO workspaces(id,name,file_count,owner_user_id) VALUES ('upgrade-workspace','Preserved project',100,'owner')");
  await first.db.query("INSERT INTO memory_notes(id,user_id,workspace_id,title,content) VALUES ('upgrade-memory','owner','upgrade-workspace','Architecture','Preserved approved fact')");
  await first.db.query("INSERT INTO task_schedules(id,user_id,name,objective,options,session_version,grant_snapshot,interval_minutes,missed_policy,next_run_at) VALUES ('upgrade-schedule','owner','Health report','Preserved schedule',$1,0,'{}',60,'once',now()+interval '1 day')",[JSON.stringify(options)]);
  await first.db.query("INSERT INTO users(id,name,role,permissions) VALUES ('upgrade-user','Restricted account','chat','{\"providers\":[\"ollama\"],\"workspaceIds\":[],\"maxAccess\":\"read_only\",\"maxConcurrentTasks\":1,\"maxCallsPerTask\":4,\"maxSecondsPerTask\":60,\"dailyCloudBudgetUsd\":0}')");
  const tables=['conversations','tasks','messages','approvals','workspaces','memory_notes','task_schedules','users'];
  const snapshot=async()=>Promise.all(tables.map(table=>first.db.query(`SELECT * FROM ${table} WHERE id LIKE 'upgrade-%' ORDER BY id`)));
  const before=await snapshot(),history=await first.db.query('SELECT * FROM schema_migrations ORDER BY version');
  let upgrades:Promise<PromiseSettledResult<void>[]>|undefined;
  try {
    await first.db.transaction(async tx=>{
      await tx.query('SELECT pg_advisory_xact_lock(1380273236,1)');
      upgrades=Promise.allSettled([first.init(),second.init()]);
      const end=Date.now()+3000;let waiting=0;
      while(Date.now()<end) {
        waiting=Number((await tx.query("SELECT count(*) AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted AND classid=1380273236 AND objid=1"))[0].count);
        if(waiting===2)break;await delay(20);
      }
      assert.equal(waiting,2,'Both independent upgrades must wait on the actual PostgreSQL advisory lock');
      assert.equal(Number((await tx.query('SELECT max(version) AS version FROM schema_migrations'))[0].version),9);
    });
  } finally {
    for(const result of await upgrades??[])if(result.status==='rejected')throw result.reason;
  }
  assert.deepEqual(await snapshot(),before,'Upgrade must preserve exact historical records and grants');
  assert.deepEqual(await first.db.query('SELECT * FROM schema_migrations WHERE version<=9 ORDER BY version'),history);
  assert.equal(Number((await first.db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version),migrations.at(-1)!.version);
  assert.equal((await first.task('upgrade-task')).options.budget.maxElapsedSeconds,undefined,'Historical deadline policy must remain unchanged');
  assert.ok((await first.db.query("SELECT indexname FROM pg_indexes WHERE indexname='tasks_pending_deadlines'")).length);
  return ['Two independently pooled upgrades wait on the native advisory lock, then apply migration 10 once',
    'Version 9 conversations, messages, pending approvals, scoped memory, schedules, workspaces and restricted grants survive unchanged',
    'Historical task deadline policy and immutable migration ledger are preserved'];
}
