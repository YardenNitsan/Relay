import Fastify, {type FastifyInstance} from 'fastify';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {ZodError} from 'zod';
import {calibrationRoutes} from '../server/api/calibration.js';
import {authorizeOwner, type Principal, type User} from '../server/auth/policy.js';
import {AppError} from '../server/core/errors.js';
import {openDatabase} from '../server/db/database.js';
import {row, Store} from '../server/db/store.js';
import {evaluationProtocol} from '../server/models/evaluation.js';
import {codeEvaluationProtocol} from '../server/models/code-evaluation.js';
import type {TaskStatus} from '../shared/types.js';

let app:FastifyInstance, store:Store, principal:Principal;
const modelId='ollama/queued-model';
beforeEach(async()=>{
  store=new Store(await openDatabase());await store.init();
  principal={user:row<User>((await store.db.query("SELECT * FROM users WHERE id='owner'"))[0]),remote:false,sessionId:'active-lookup-session'};
  await store.db.query("INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ($1,'owner','csrf',false,'test',$2,now()+interval '1 day')",[principal.sessionId,principal.user.sessionVersion]);
  await store.db.query("INSERT INTO users(id,name,role,permissions) SELECT 'other','Other','trusted',permissions FROM users WHERE id='owner'");
  await store.db.query("INSERT INTO conversations(id,title,user_id) VALUES ('lookup-conversation','Synthetic evaluation lookup','owner')");
  app=Fastify();
  app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof AppError?error.status:error instanceof ZodError?400:500).send({error:error instanceof AppError?error.code:'INVALID'}));
  // The captured principal deliberately remains stale after DB revocation. The
  // endpoint must reuse durable account/session guards, not trust this snapshot.
  // Empty engine/providers also ensure lookup never invokes inference or tools.
  calibrationRoutes(app,store,{} as never,{} as never,()=>{authorizeOwner(principal);return principal;});
});
afterEach(async()=>{await app?.close();await store?.close();});

async function task(id:string,{status='created',protocol=evaluationProtocol,model=modelId,user='owner',date='2026-01-01T00:00:00Z'}:{status?:TaskStatus;protocol?:string;model?:string;user?:string;date?:string}={}){
  await store.db.query("INSERT INTO tasks(id,conversation_id,objective,status,options,user_id,created_at) VALUES ($1,'lookup-conversation','Synthetic evaluation',$2,'{}',$3,$4)",[id,status,user,date]);
  await store.db.query("INSERT INTO model_calibrations(task_id,model_id,context_tokens,protocol,identity) VALUES ($1,$2,8192,$3,'{}')",[id,model,protocol]);
}
const lookup=(protocol:string=evaluationProtocol,model:string=modelId)=>app.inject({method:'GET',url:`/api/models/evaluations/active?${new URLSearchParams({modelId:model,protocol})}`});

describe('active evaluation recovery API',()=>{
  it('recovers queued tasks for both protocols before any evaluation report exists',async()=>{
    await task('capability');await task('coding',{protocol:codeEvaluationProtocol});
    expect(await store.db.query('SELECT id FROM model_evaluations')).toEqual([]);
    for(const [protocol,taskId] of [[evaluationProtocol,'capability'],[codeEvaluationProtocol,'coding']]){
      const response=await lookup(protocol);expect(response.statusCode).toBe(200);expect(response.json()).toEqual({task:{taskId,status:'created'}});
    }
  });
  it('returns only the oldest exact actor/model/protocol match, excluding terminal tasks',async()=>{
    await task('other-account',{user:'other'});await task('other-model',{model:'ollama/other'});await task('ordinary-calibration',{protocol:'relay-calibration-v1'});
    for(const status of ['completed','cancelled','failed'] as const)await task(status,{status});
    await task('z-later',{date:'2026-01-03T00:00:00Z'});await task('b-tie',{date:'2026-01-02T00:00:00Z'});await task('a-oldest',{date:'2026-01-02T00:00:00Z'});
    const response=await lookup();expect(response.statusCode).toBe(200);expect(response.json()).toEqual({task:{taskId:'a-oldest',status:'created'}});
    await store.db.query("UPDATE tasks SET status='completed' WHERE user_id='owner' AND id IN ('a-oldest','b-tie','z-later')");
    expect((await lookup()).json()).toEqual({task:null});
  });
  it('retains paused, waiting and replanning tasks as cancelable work',async()=>{
    await task('unfinished');
    for(const status of ['analyzing','planning','executing','verifying','replanning','paused','waiting_for_user','waiting_for_approval'] as const){
      await store.db.query('UPDATE tasks SET status=$1 WHERE id=$2',[status,'unfinished']);
      const response=await lookup();expect(response.statusCode).toBe(200);expect(response.json()).toEqual({task:{taskId:'unfinished',status}});
    }
  });
  it('does not truncate pending tasks behind a page of newer terminal history or mutate records',async()=>{
    await task('old-pending');
    for(let i=0;i<45;i++)await task(`terminal-${i}`,{status:'completed',date:'2026-01-02T00:00:00Z'});
    const before=await store.db.query('SELECT (SELECT count(*) FROM tasks) AS tasks,(SELECT count(*) FROM events) AS events,(SELECT count(*) FROM audit_events) AS audits,(SELECT count(*) FROM model_calibrations) AS calibrations');
    expect((await lookup()).json()).toEqual({task:{taskId:'old-pending',status:'created'}});
    expect(await store.db.query('SELECT (SELECT count(*) FROM tasks) AS tasks,(SELECT count(*) FROM events) AS events,(SELECT count(*) FROM audit_events) AS audits,(SELECT count(*) FROM model_calibrations) AS calibrations')).toEqual(before);
  });
  it('validates bounded identifiers and exactly the two supported protocols',async()=>{
    const invalid:Record<string,string>[]=[{protocol:evaluationProtocol},{modelId},{modelId:'',protocol:evaluationProtocol},{modelId:'x'.repeat(201),protocol:evaluationProtocol},{modelId,protocol:'relay-calibration-v1'},{modelId,protocol:evaluationProtocol,actor:'other'}];
    for(const query of invalid){
      const response=await app.inject({method:'GET',url:`/api/models/evaluations/active?${new URLSearchParams(query)}`});expect(response.statusCode).toBe(400);
    }
    expect((await lookup(evaluationProtocol,'x'.repeat(200))).statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:`/api/models/evaluations/active?modelId=first&modelId=second&protocol=${evaluationProtocol}`})).statusCode).toBe(400);
  });
  it('requires the local owner rather than a remote owner or local non-owner',async()=>{
    principal.remote=true;expect((await lookup()).statusCode).toBe(403);
    principal.remote=false;principal.user.role='trusted';expect((await lookup()).statusCode).toBe(403);
  });
  it('rechecks a session deleted or expired after request authentication',async()=>{
    await task('private');await store.db.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
    expect((await lookup()).statusCode).toBe(401);
    await store.db.query('DELETE FROM sessions');expect((await lookup()).statusCode).toBe(401);
  });
  it('rechecks disabled, downgraded, unapproved and version-revoked owner accounts',async()=>{
    await task('private');
    for(const change of ["enabled=false","role='trusted'","registration_status='denied'","session_version=session_version+1"]){
      await store.db.query(`UPDATE users SET ${change} WHERE id='owner'`);
      expect([401,403]).toContain((await lookup()).statusCode);
      await store.db.query("UPDATE users SET enabled=true,role='owner',registration_status='approved',session_version=$1 WHERE id='owner'",[principal.user.sessionVersion]);
    }
  });
});
