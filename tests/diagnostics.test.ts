import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {openDatabase,type Database} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {exportDiagnostics} from '../server/diagnostics/export.js';
import {taskTiming,intervalUnionMs} from '../server/diagnostics/timing.js';

let db:Database;
const owner={id:'owner',sessionVersion:0};
const secret='private-objective-email@example.test-C:\\private\\api-key';
beforeEach(async()=>{db=await openDatabase();await new Store(db).init();});
afterEach(async()=>{await db.close();});
async function fixture(id='task',user='owner'){
  await db.query('INSERT INTO conversations(id,title,user_id) VALUES ($1,$2,$3)',[id,secret,user]);
  await db.query("INSERT INTO tasks(id,conversation_id,user_id,objective,status,options,result,error,created_at,updated_at,execution_used_ms,approval_wait_ms,resource_wait_ms) VALUES ($1,$1,$2,$3,'completed',$4,$3,$3,now()-interval '10 seconds',now(),4000,1000,2000)",[id,user,secret,JSON.stringify({secret})]);
  await db.query("INSERT INTO task_steps(id,task_id,role,title,dependencies,status,ordinal) VALUES ($1,$1,'worker',$2,'[]','completed',0)",[id,secret]);
  await db.query("INSERT INTO agent_runs(id,task_id,step_id,role,model_id,status,finished_at) VALUES ($1,$1,$1,'worker',$2,'completed',now())",[id,secret]);
  await db.query("INSERT INTO model_calls(id,task_id,agent_id,model_id,status,context,error,input_tokens,output_tokens,usage,started_at,finished_at) VALUES ($1,$1,$1,$2,'completed',$3,$2,10,20,$4,now()-interval '4 seconds',now())",[id,secret,JSON.stringify([{content:secret}]),JSON.stringify({durationMs:3500,loadDurationMs:250,generationTokensPerSecond:20,private:secret})]);
  await db.query("INSERT INTO tool_calls(id,task_id,agent_id,name,arguments,status,result,started_at,finished_at) VALUES ($1,$1,$1,$2,$3,'completed',$2,now()-interval '3 seconds',now())",[id,secret,JSON.stringify({path:secret})]);
  await db.query("INSERT INTO verification(id,task_id,kind,summary,passed,details) VALUES ($1,$1,$2,$2,true,$3)",[id,secret,JSON.stringify({toolCallId:id,path:secret})]);
  await db.query("INSERT INTO events(task_id,type,data,created_at) VALUES ($1,'TASK_ANALYZING',$2,now()-interval '8 seconds'),($1,'MODEL_TEXT',$3,now()-interval '2 seconds')",[id,JSON.stringify({objective:secret}),JSON.stringify({callId:id,text:secret})]);
}
describe('bounded private diagnostics',()=>{
  it('exports only allowlisted metadata with correlated opaque IDs and a content-free audit',async()=>{
    await fixture(secret);const bundle=await exportDiagnostics(db,owner,{});const text=JSON.stringify(bundle);
    expect(text).not.toContain(secret);expect(text).not.toMatch(/example\.test|api-key|private-objective|C:\\\\private/);
    const task=bundle.tasks[0];expect(task.calls[0].taskId).toBe(task.id);expect(task.tools[0].taskId).toBe(task.id);expect(task.checks[0].toolCallId).toBe(task.tools[0].id);expect(task.tools[0].name).toBe('other');expect(task.checks[0].kind).toBe('other');
    expect(task.calls[0].loadDurationMs).toBe(250);expect(task.calls[0].firstTokenMs).toBeNull();expect(task.calls[0].firstTextEventMs).toBeGreaterThan(1000);
    const audit=await db.query("SELECT metadata FROM audit_events WHERE operation='DIAGNOSTICS_EXPORTED'");expect(audit).toHaveLength(1);expect(JSON.stringify(audit)).not.toContain(secret);
    const again=await exportDiagnostics(db,owner,{});expect(again.tasks[0].id).not.toBe(task.id);
  });
  it('keeps account scope, validates live owner version, and bounds the time window',async()=>{
    await fixture();await db.query("INSERT INTO users(id,name,role,permissions) VALUES ('other','Private user','trusted','{}')");await fixture('other-task','other');await fixture('old');await db.query("UPDATE tasks SET created_at=now()-interval '8 days' WHERE id='old'");
    expect((await exportDiagnostics(db,owner,{})).tasks).toHaveLength(1);
    await expect(exportDiagnostics(db,{id:'other',sessionVersion:0},{})).rejects.toMatchObject({code:'DIAGNOSTICS_OWNER'});
    await expect(exportDiagnostics(db,{...owner,sessionVersion:1},{})).rejects.toMatchObject({code:'DIAGNOSTICS_OWNER'});
    await expect(exportDiagnostics(db,owner,{days:8})).rejects.toThrow();await expect(exportDiagnostics(db,owner,{maxTasks:201})).rejects.toThrow();
  });
  it('keeps observed durations distinct from unknown first token and generation measurements',async()=>{
    await fixture();const timing=await taskTiming(db,'task');expect(timing.queueMs).toBeGreaterThan(1000);expect(timing.executionAccountedMs).toBe(4000);expect(timing.approvalWaitMs).toBe(1000);expect(timing.resourceWaitMs).toBe(2000);expect(timing.calls[0].generationDurationMs).toBeNull();expect(timing.calls[0].providerDurationMs).toBe(3500);
    await db.query("UPDATE model_calls SET usage='{\"loadDurationMs\":\"secret\",\"durationMs\":-1}'");const unknown=await taskTiming(db,'task');expect(unknown.calls[0].loadDurationMs).toBeNull();expect(unknown.calls[0].providerDurationMs).toBeNull();
  });
  it('exposes adapter observations separately from runtime counters and buffered text events',async()=>{
    await fixture();await db.query('UPDATE model_calls SET usage=$1',[JSON.stringify({firstContentMs:120,loadWallMs:80,cleanupWallMs:30,streamWallMs:500,loadDurationMs:70})]);
    const call=(await taskTiming(db,'task')).calls[0];
    expect(call).toMatchObject({firstContentMs:120,loadWallMs:80,cleanupWallMs:30,streamWallMs:500,loadDurationMs:70,firstTokenMs:null});
    await db.query('UPDATE model_calls SET usage=$1',[JSON.stringify({firstContentMs:-1,cleanupWallMs:'private'})]);
    expect((await taskTiming(db,'task')).calls[0]).toMatchObject({firstContentMs:null,cleanupWallMs:null,loadWallMs:null});
  });
  it('unions parallel spans without double counting and treats invalid spans as unknown',()=>{
    expect(intervalUnionMs([[0,100],[50,150],[200,225]])).toBe(175);expect(intervalUnionMs([])).toBe(0);expect(intervalUnionMs([[100,0]])).toBeNull();
  });
  it('reports truncation and actual record counts instead of presenting a partial sum as complete',async()=>{
    await fixture();await db.query("INSERT INTO model_calls(id,task_id,agent_id,model_id,status,context,started_at,finished_at) SELECT 'second',task_id,agent_id,model_id,status,context,started_at,finished_at FROM model_calls");
    const timing=await taskTiming(db,'task',{maxRecords:1});expect(timing.counts.calls).toBe(2);expect(timing.calls).toHaveLength(1);expect(timing.truncated.calls).toBe(true);expect(timing.modelCallWallMs).toBeNull();
    await fixture('new');const bundle=await exportDiagnostics(db,owner,{maxTasks:1});expect(bundle.tasks).toHaveLength(1);expect(bundle.truncated.tasks).toBe(true);
  });
  it('keeps unfinished durations and missing queue events unknown',async()=>{
    await fixture();await db.query("UPDATE tasks SET status='paused',execution_wait_kind='approval',execution_wait_started_at=now()-interval '1 second'");await db.query('DELETE FROM events');await db.query("UPDATE model_calls SET status='running',finished_at=NULL");
    const timing=await taskTiming(db,'task');expect(timing.queueMs).toBeNull();expect(timing.calls[0].durationMs).toBeNull();expect(timing.calls[0].elapsedMs).toBeGreaterThan(3000);expect(timing.activeWaitElapsedMs).toBeGreaterThan(500);expect(timing.activeWaitKind).toBe('approval');
    await expect(taskTiming(db,'missing')).rejects.toMatchObject({code:'NOT_FOUND'});
  });
});
