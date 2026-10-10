import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {openDatabase,type Database} from '../server/db/database.js';
import {Store} from '../server/db/store.js';
import {RetentionService} from '../server/db/retention.js';

let db:Database,service:RetentionService;
const owner={id:'owner',sessionVersion:0};
const policy={expiredCredentials:true,terminalPayloads:true,olderThanDays:30,batchSize:100};
beforeEach(async()=>{db=await openDatabase();await new Store(db).init();service=new RetentionService(db);});
afterEach(async()=>{await db.close();});
async function fixture(id='old',status='completed'){
  await db.query("INSERT INTO conversations(id,title) VALUES ($1,'Preserved conversation')",[id]);
  await db.query("INSERT INTO tasks(id,conversation_id,objective,status,options,result,updated_at) VALUES ($1,$1,'Keep objective',$2,'{}','Keep answer',now()-interval '60 days')",[id,status]);
  await db.query("INSERT INTO task_steps(id,task_id,role,title,dependencies,status,ordinal,context,output) VALUES ($1,$1,'worker','Keep title','[]','completed',0,$2,'Keep result')",[id,JSON.stringify([{role:'assistant',content:'private context'}])]);
  await db.query("INSERT INTO agent_runs(id,task_id,step_id,role,model_id,status,finished_at) VALUES ($1,$1,$1,'worker','fixture','completed',now()-interval '60 days')",[id]);
  await db.query("INSERT INTO model_calls(id,task_id,agent_id,model_id,status,context,input_tokens,output_tokens,cost_usd,reserved_cost_usd,cost_state,finished_at) VALUES ($1,$1,$1,'fixture','completed',$2,10,20,0.12,0.2,'settled',now()-interval '60 days')",[id,JSON.stringify([{role:'user',content:'private prompt'}])]);
  await db.query("INSERT INTO tool_calls(id,task_id,agent_id,name,arguments,status,result,finished_at) VALUES ($1,$1,$1,'file_read','{\"path\":\"keep.txt\"}','completed','Keep authoritative receipt',now())",[id]);
  await db.query("INSERT INTO events(task_id,type,data) VALUES ($1,'MODEL_TEXT','{\"text\":\"duplicate stream\",\"callId\":\"keep-ref\"}'),($1,'TOOL_COMPLETED','{\"content\":\"Keep receipt\"}')",[id]);
  await db.query("INSERT INTO audit_events(task_id,operation,metadata) VALUES ($1,'KEEP_AUDIT','{\"hash\":\"keep\"}')",[id]);
}
describe('explicit bounded retention',()=>{
  it('previews without changing data, then redacts only allowed payloads and preserves identities/cost/evidence',async()=>{
    await fixture();const preview=await service.preview(owner,policy);expect(preview.counts).toMatchObject({stepContexts:1,callContexts:1,modelTextEvents:1});
    expect((await db.query('SELECT context FROM task_steps'))[0].context).not.toBeNull();
    const result=await service.apply(owner,preview.token);expect(result.counts).toEqual(preview.counts);
    expect((await db.query('SELECT context,output FROM task_steps'))[0]).toEqual({context:null,output:'Keep result'});
    expect((await db.query('SELECT context,input_tokens,output_tokens,cost_usd,reserved_cost_usd,cost_state FROM model_calls'))[0]).toEqual({context:[],input_tokens:10,output_tokens:20,cost_usd:0.12,reserved_cost_usd:0.2,cost_state:'settled'});
    expect((await db.query('SELECT arguments,result FROM tool_calls'))[0]).toEqual({arguments:{path:'keep.txt'},result:'Keep authoritative receipt'});
    const events=await db.query('SELECT type,data FROM events ORDER BY id');expect(events).toHaveLength(2);expect(events[0].data).toMatchObject({text:'',callId:'keep-ref',retention:{redacted:true}});expect(events[1].data).toEqual({content:'Keep receipt'});
    expect((await db.query('SELECT objective,result FROM tasks'))[0]).toEqual({objective:'Keep objective',result:'Keep answer'});
    expect((await db.query("SELECT metadata FROM audit_events WHERE operation='KEEP_AUDIT'"))[0].metadata).toEqual({hash:'keep'});
    expect(await db.query("SELECT id FROM audit_events WHERE operation='RETENTION_APPLIED'")).toHaveLength(1);
    await expect(service.apply(owner,preview.token)).rejects.toMatchObject({code:'RETENTION_PREVIEW'});
  });
  it('preserves all resumable states and checkpoint/artifact/uncertain financial references',async()=>{
    for(const status of ['paused','waiting_for_user','waiting_for_approval','executing','queued'])await fixture(status,status);
    await fixture('checkpoint');await db.query("INSERT INTO checkpoints(id,task_id,path,metadata) VALUES ('cp','checkpoint','keep-path','{}')");
    await fixture('artifact');await db.query("INSERT INTO artifacts(id,task_id,name,path,mime) VALUES ('a','artifact','keep','keep-path','text/plain')");
    await fixture('uncertain');await db.query("UPDATE model_calls SET cost_state='uncertain' WHERE id='uncertain'");
    const preview=await service.preview(owner,policy);expect(preview.counts.stepContexts).toBe(0);expect(preview.protectedTasks).toBe(8);await service.apply(owner,preview.token);
    expect(await db.query('SELECT id FROM task_steps WHERE context IS NOT NULL')).toHaveLength(8);
  });
  it('rejects stale previews when status, payload or references change, without partially applying credentials',async()=>{
    await fixture();await db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ('expired','owner','private-csrf',false,'test',0,now()-interval '60 days')");
    const preview=await service.preview(owner,policy);await db.query("UPDATE tasks SET status='paused' WHERE id='old'");
    await expect(service.apply(owner,preview.token)).rejects.toMatchObject({code:'RETENTION_STALE'});expect(await db.query('SELECT id FROM sessions')).toHaveLength(1);expect((await db.query('SELECT context FROM task_steps'))[0].context).not.toBeNull();
  });
  it('requires current durable owner authority and consumes previews on a rejected apply',async()=>{
    await expect(service.preview({id:'nobody',sessionVersion:0},policy)).rejects.toMatchObject({code:'RETENTION_OWNER'});
    const preview=await service.preview(owner,policy);await db.query("UPDATE users SET session_version=1 WHERE id='owner'");
    await expect(service.apply(owner,preview.token)).rejects.toMatchObject({code:'RETENTION_OWNER'});
    await expect(service.apply({id:'owner',sessionVersion:1},preview.token)).rejects.toMatchObject({code:'RETENTION_PREVIEW'});
  });
  it('deletes only sufficiently expired credentials and retains tokens referenced by usage history',async()=>{
    await db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ('old','owner','secret',false,'test',0,now()-interval '60 days'),('recent','owner','secret',false,'test',0,now()-interval '1 day'),('live','owner','secret',false,'test',0,now()+interval '1 day')");
    await db.query("INSERT INTO lan_invitations(token_hash,user_id,session_version,expires_at) VALUES ('secret-hash','owner',0,now()-interval '60 days')");
    await db.query("INSERT INTO inference_tokens(id,user_id,token_hash,label,session_version,expires_at) VALUES ('used','owner','hash-used','used',0,now()-interval '60 days'),('unused','owner','hash-unused','unused',0,now()-interval '60 days')");
    await db.query("INSERT INTO inference_requests(id,user_id,token_id,model_id,status) VALUES ('r','owner','used','fixture','completed')");
    const preview=await service.preview(owner,policy);expect(preview.counts).toMatchObject({sessions:1,lanInvitations:1,inferenceTokens:1});expect(JSON.stringify(preview)).not.toMatch(/secret-hash|hash-unused/);
    await service.apply(owner,preview.token);expect((await db.query('SELECT id FROM inference_tokens'))[0].id).toBe('used');expect(await db.query('SELECT id FROM sessions')).toHaveLength(2);
  });
  it('defaults to no cleanup, strictly validates policy and bounds one apply',async()=>{
    await fixture('a');await fixture('b');expect((await service.preview(owner,{})).counts.stepContexts).toBe(0);
    await expect(service.preview(owner,{...policy,table:'tasks'})).rejects.toThrow();await expect(service.preview(owner,{...policy,olderThanDays:0})).rejects.toThrow();
    const preview=await service.preview(owner,{...policy,batchSize:1});expect(preview.limited).toBe(true);expect(preview.counts.stepContexts).toBe(1);await service.apply(owner,preview.token);expect(await db.query('SELECT id FROM task_steps WHERE context IS NOT NULL')).toHaveLength(1);
  });
  it.each(['payload','checkpoint','token-reference'])('rejects a changed %s even when counts would otherwise match',async change=>{
    await fixture();await db.query("INSERT INTO inference_tokens(id,user_id,token_hash,label,session_version,expires_at) VALUES ('unused','owner','hash','label',0,now()-interval '60 days')");
    const preview=await service.preview(owner,policy);
    if(change==='payload')await db.query("UPDATE task_steps SET context='[{\"role\":\"assistant\",\"content\":\"changed\"}]' WHERE id='old'");
    if(change==='checkpoint')await db.query("INSERT INTO checkpoints(id,task_id,path,metadata) VALUES ('new','old','recovery-path','{}')");
    if(change==='token-reference')await db.query("INSERT INTO inference_requests(id,user_id,token_id,model_id,status) VALUES ('new','owner','unused','fixture','running')");
    await expect(service.apply(owner,preview.token)).rejects.toMatchObject({code:'RETENTION_STALE'});
    expect((await db.query('SELECT context FROM task_steps'))[0].context).not.toBeNull();expect(await db.query('SELECT id FROM inference_tokens')).toHaveLength(1);
  });
  it('rolls back redaction and credential deletion if writing its audit receipt fails',async()=>{
    await fixture();await db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ('old','owner','secret',false,'test',0,now()-interval '60 days')");
    const failing:Database={...db,transaction:callback=>db.transaction(tx=>callback({...tx,query:async(sql,params)=>{if(sql.includes("'RETENTION_APPLIED'"))throw new Error('private SQL failure');return tx.query(sql,params);}}))};
    const retention=new RetentionService(failing),preview=await retention.preview(owner,policy);
    await expect(retention.apply(owner,preview.token)).rejects.toMatchObject({code:'RETENTION_FAILED'});
    expect(await db.query('SELECT id FROM sessions')).toHaveLength(1);expect((await db.query('SELECT context FROM task_steps'))[0].context).not.toBeNull();
    expect(await db.query("SELECT id FROM audit_events WHERE operation='RETENTION_APPLIED'")).toHaveLength(0);
  });
  it('consumes a preview exactly once under concurrent apply calls',async()=>{
    await fixture();const preview=await service.preview(owner,policy);
    const results=await Promise.allSettled([service.apply(owner,preview.token),service.apply(owner,preview.token)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(await db.query("SELECT id FROM audit_events WHERE operation='RETENTION_APPLIED'")).toHaveLength(1);
  });
  it('expires preview tokens and bounds the outstanding preview cache',async()=>{
    let now=Date.now();const retention=new RetentionService(db,()=>now),first=await retention.preview(owner,{});
    for(let i=1;i<16;i++)await retention.preview(owner,{});
    await expect(retention.preview(owner,{})).rejects.toMatchObject({code:'RETENTION_LIMIT'});
    now+=600001;await expect(retention.apply(owner,first.token)).rejects.toMatchObject({code:'RETENTION_PREVIEW'});expect((await retention.preview(owner,{})).token).toHaveLength(43);
  });
  it('protects possible filesystem-only checkpoint references without relying on SQL checkpoint rows',async()=>{
    await fixture('workspace');await fixture('host');await fixture('mutation');
    await db.query("UPDATE tasks SET options='{\"workspaceId\":\"managed-workspace\"}' WHERE id='workspace'");
    await db.query("UPDATE tasks SET options='{\"access\":\"unrestricted\"}' WHERE id='host'");
    await db.query("UPDATE tool_calls SET name='file_write' WHERE id='mutation'");
    expect(await db.query('SELECT id FROM checkpoints')).toHaveLength(0);
    const preview=await service.preview(owner,policy);expect(preview.protectedTasks).toBe(3);expect(preview.counts.stepContexts).toBe(0);expect(preview.counts.modelTextEvents).toBe(0);
  });
});
