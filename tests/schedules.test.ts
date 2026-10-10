import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {openDatabase} from '../server/db/database.js';
import {Store,row} from '../server/db/store.js';
import {ScheduleService} from '../server/scheduling/service.js';
import {reviewRestoration} from '../server/db/restoration.js';
import type {Principal,User} from '../server/auth/policy.js';

let store:Store,service:ScheduleService,actor:Principal,now:number,queued:string[],cancelled:string[];
const options={depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:4096,cloudPolicy:'local_only',network:{mode:'deny',allowedOrigins:[]},budget:{maxCalls:4,maxIterations:4,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}};
const input=()=>({name:'Daily review',objective:'Explain the supplied architecture notes',startAt:new Date(now+60_000).toISOString(),intervalMinutes:15,missedPolicy:'once',enabled:true,confirmed:true,options});
beforeEach(async()=>{store=new Store(await openDatabase());await store.init();now=Date.parse('2026-10-10T12:00:00Z');queued=[];cancelled=[];actor={user:row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]),remote:false,sessionId:'fixture'};service=new ScheduleService(store,{enqueue:(id:string)=>{queued.push(id);},cancel:async(id:string)=>{cancelled.push(id);await store.transition(id,'cancelled');}},{now:()=>now});});
afterEach(async()=>{await service.stop();await store.close();});
describe('durable owner schedules',()=>{
  it('requires explicit confirmation and rejects expanded capabilities and remote owners',async()=>{
    await expect(service.create(actor,{...input(),confirmed:false})).rejects.toThrow();
    for(const change of [{access:'workspace'},{modelId:'openai/gpt-5'},{assistantId:'personal'},{network:{mode:'ask',allowedOrigins:[]}},{mcpServerIds:['server']},{budget:{...options.budget,localOnly:false}}])await expect(service.create(actor,{...input(),options:{...options,...change}})).rejects.toThrow();
    await expect(service.create({...actor,remote:true},input())).rejects.toMatchObject({code:'OWNER_ONLY'});
    expect(await service.list(actor)).toEqual([]);
  });
  it('claims one occurrence atomically and advances overdue intervals without catch-up',async()=>{
    const schedule=await service.create(actor,input());now+=3_660_000;await Promise.all([service.tick(),service.tick()]);
    expect(queued).toHaveLength(1);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'dispatched',taskId:queued[0]});
    const saved=(await service.list(actor))[0];expect(Date.parse(saved.nextRunAt!)).toBeGreaterThan(now);
    expect((await store.task(queued[0])).options).toMatchObject(options);
    expect((await store.conversations()).length).toBe(1);
  });
  it('skips missed one-time work and does not infer permission from elapsed time',async()=>{
    const schedule=await service.create(actor,{...input(),intervalMinutes:null,missedPolicy:'skip'});now+=300_000;await service.tick();
    expect(queued).toEqual([]);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'skipped',taskId:null});
    expect((await service.list(actor))[0]).toMatchObject({enabled:false,nextRunAt:null});
  });
  it('keeps paused or unfinished work from recurring and cancels it on disable',async()=>{
    const schedule=await service.create(actor,input());now+=60_000;await service.tick();await store.db.query("UPDATE tasks SET status='paused' WHERE id=$1",[queued[0]]);now+=900_000;await service.tick();expect(queued).toHaveLength(1);
    await service.setEnabled(actor,schedule.id,{enabled:false,confirmed:true});expect(cancelled).toEqual(queued);
  });
  it('revokes background authorization when the granting session changes',async()=>{
    await service.create(actor,input());await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");now+=60_000;await service.tick();expect(queued).toEqual([]);
    await expect(service.list(actor)).rejects.toMatchObject({code:'REVOKED'});
    expect((await service.list({...actor,user:{...actor.user,sessionVersion:1}}))[0]).toMatchObject({enabled:false});
  });
  it('rolls back conversation and claim when ordinary task admission rejects its quota',async()=>{
    await store.db.query("UPDATE users SET permissions=jsonb_set(permissions,'{maxConcurrentTasks}','1') WHERE id='owner'");const c=await store.createConversation();await store.createTask(c.id,'existing task',options as never);
    const schedule=await service.create(actor,input());now+=60_000;await service.tick();expect(queued).toEqual([]);expect(await service.runs(actor,schedule.id)).toEqual([]);expect(await store.conversations()).toHaveLength(1);
    expect((await service.list(actor))[0]).toMatchObject({enabled:true});
  });
  it('does not replay a dispatched task after recovery pauses it',async()=>{
    const schedule=await service.create(actor,{...input(),intervalMinutes:null});now+=60_000;await service.tick();await store.db.query("UPDATE tasks SET status='paused' WHERE id=$1",[queued[0]]);await service.recoverInterrupted();await service.tick();
    expect(queued).toHaveLength(1);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'interrupted',taskStatus:'paused'});
  });
  it('scopes schedule reads and writes to the local account',async()=>{
    const schedule=await service.create(actor,input());await store.db.query("INSERT INTO users(id,name,role,permissions) SELECT 'other','Other','owner',permissions FROM users WHERE id='owner'");
    const other={...actor,user:{...actor.user,id:'other'}};expect(await service.list(other)).toEqual([]);await expect(service.runs(other,schedule.id)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(service.archive(other,schedule.id)).rejects.toMatchObject({code:'NOT_FOUND'});
  });
  it('rotates a blocked old occurrence behind other due schedules',async()=>{
    const first=await service.create(actor,input());now+=60_000;await service.tick();await store.db.query("UPDATE tasks SET status='paused' WHERE id=$1",[queued[0]]);
    const second=await service.create(actor,{...input(),name:'Independent'});now+=900_000;
    await service.tick();await service.tick();expect(queued).toHaveLength(2);expect(await service.runs(actor,first.id)).toHaveLength(1);expect(await service.runs(actor,second.id)).toHaveLength(1);
  });
  it('does not mark an on-time observed occurrence missed because serial polling has a backlog',async()=>{
    const schedules=[];for(let index=0;index<7;index++)schedules.push(await service.create(actor,{...input(),name:`Due together ${index}`,intervalMinutes:null,missedPolicy:'skip'}));
    now+=60_000;
    for(let index=0;index<7;index++){
      await service.tick();
      if(queued[index])await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[queued[index]]);
      now+=15_000;
    }
    expect(queued).toHaveLength(7);
    for(const schedule of schedules)expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'dispatched'});
  });
  it.each(['polling gap','emergency stop'] as const)('forgets queued on-time observations after %s',async reason=>{
    await store.db.query("UPDATE users SET permissions=jsonb_set(permissions,'{maxConcurrentTasks}','1') WHERE id='owner'");
    const conversation=await store.createConversation(),active=await store.createTask(conversation.id,'Occupy account slot',options as never);
    const schedule=await service.create(actor,{...input(),intervalMinutes:null,missedPolicy:'skip'});now+=60_000;await service.tick();
    expect(await service.runs(actor,schedule.id)).toEqual([]);
    if(reason==='emergency stop'){now+=45_000;await store.setStopped(true);await service.tick();await store.setStopped(false);now+=30_000;}
    else now+=120_000;
    await store.db.query("UPDATE tasks SET status='completed' WHERE id=$1",[active.task.id]);await service.tick();
    expect(queued).toEqual([]);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'skipped'});
  });
  it('prevents duplicate claims across independent scheduler instances',async()=>{
    const schedule=await service.create(actor,{...input(),intervalMinutes:null});now+=60_000;
    const second=new ScheduleService(store,{enqueue:(id:string)=>{queued.push(id);},cancel:async()=>{}},{now:()=>now});
    await Promise.all([service.tick(),second.tick()]);expect(queued).toHaveLength(1);expect(await service.runs(actor,schedule.id)).toHaveLength(1);
  });
  it('cancels a committed claim disabled before dispatch',async()=>{
    const schedule=await service.create(actor,input());now+=60_000;
    const transaction=store.db.transaction.bind(store.db);let intercepted=false;
    store.db.transaction=async callback=>{const result=await transaction(callback);if(!intercepted&&result&&typeof result==='object'&&'runId' in result){intercepted=true;await service.setEnabled(actor,schedule.id,{enabled:false,confirmed:true});}return result;};
    await service.tick();expect(intercepted).toBe(true);expect(queued).toEqual([]);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'interrupted',taskStatus:'cancelled'});
  });
  it('does not advance a due occurrence during emergency stop',async()=>{
    const schedule=await service.create(actor,input());now+=60_000;await store.setStopped(true);await service.tick();expect(queued).toEqual([]);expect(await service.runs(actor,schedule.id)).toEqual([]);
    await store.setStopped(false);await service.tick();expect(queued).toHaveLength(1);
  });
  it('keeps pending restoration inert and dispatches after owner review without recreating the scheduler',async()=>{
    const schedule=await service.create(actor,input());now+=60_000;
    await store.db.query("INSERT INTO settings(key,value) VALUES ('restoration_pending','true')");
    // Defense in depth: even an accidentally unstopped control cannot admit work.
    await store.setStopped(false);await service.tick();
    expect(queued).toEqual([]);expect(await service.runs(actor,schedule.id)).toEqual([]);
    expect((await service.list(actor))[0]).toMatchObject({enabled:true,nextRunAt:schedule.nextRunAt});
    await reviewRestoration(store,actor);await service.tick();
    expect(queued).toHaveLength(1);expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'dispatched'});
  });
  it('rechecks pending restoration after a claim commits and before dispatch',async()=>{
    const schedule=await service.create(actor,input());now+=60_000;
    const transaction=store.db.transaction.bind(store.db);let intercepted=false;
    store.db.transaction=async callback=>{const result=await transaction(callback);if(!intercepted&&result&&typeof result==='object'&&'runId' in result){intercepted=true;await store.db.query("INSERT INTO settings(key,value) VALUES ('restoration_pending','true')");}return result;};
    await service.tick();expect(intercepted).toBe(true);expect(queued).toEqual([]);
    expect((await service.runs(actor,schedule.id))[0]).toMatchObject({status:'interrupted',taskStatus:'cancelled'});
  });
  it('rechecks narrowed budgets and refuses missing workspaces at dispatch',async()=>{
    const schedule=await service.create(actor,input());await store.db.query("UPDATE users SET permissions=jsonb_set(permissions,'{maxCallsPerTask}','1') WHERE id='owner'");now+=60_000;await service.tick();expect(queued).toEqual([]);expect((await service.list(actor))[0]).toMatchObject({id:schedule.id,enabled:false});
    await expect(service.create(actor,{...input(),options:{...options,workspaceId:'00000000-0000-4000-8000-000000000001'}})).rejects.toMatchObject({code:'WORKSPACE_DENIED'});
  });
  it('enforces bounded retained schedule history without deleting it',async()=>{
    const schedule=await service.create(actor,input());await store.db.query("INSERT INTO task_schedules(id,user_id,name,objective,options,session_version,grant_snapshot,missed_policy,enabled) SELECT 'retained-'||n,user_id,name,objective,options,session_version,grant_snapshot,missed_policy,false FROM task_schedules CROSS JOIN generate_series(1,49) n WHERE id=$1",[schedule.id]);
    await expect(service.create(actor,input())).rejects.toMatchObject({code:'SCHEDULE_CAPACITY'});expect(await service.list(actor)).toHaveLength(50);
  });
});
