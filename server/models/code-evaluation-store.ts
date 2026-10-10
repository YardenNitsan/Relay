import {randomUUID} from 'node:crypto';
import {authorizeOwner,type Principal,type User} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import {assertRestorationReviewed} from '../db/restoration.js';
import {row,type Store} from '../db/store.js';
import type {Sql} from '../db/database.js';
import {EvaluationStore,type EvaluationActor,type EvaluationScope} from './evaluation-store.js';
import {codeEvaluationCases,codeEvaluationEvidence,codeEvaluationIdentitySchema,codeEvaluationProtocol,codeEvaluationReportSchema,type CodeEvaluationIdentity,type CodeEvaluationReport,type CodeSample} from './code-evaluation.js';

export class CodeEvaluationStore {
  constructor(private readonly store:Store){}
  async owner(actor:EvaluationActor,sql:Sql=this.store.db):Promise<void>{const found=(await sql.query('SELECT * FROM users WHERE id=$1',[actor.userId]))[0];const user=found?row<User>(found):undefined;if(!user?.enabled||user.role!=='owner'||user.registrationStatus!=='approved'||user.sessionVersion!==actor.sessionVersion)throw new AppError('REVOKED','Local owner evaluation authorization was revoked.',403);}
  async authorize(scope:EvaluationScope,identity:CodeEvaluationIdentity){await this.owner(scope);await new EvaluationStore(this.store).assertAuthorized(scope,identity.model);}
  async preflightAuthorization(principal:Principal){authorizeOwner(principal);await this.owner({userId:principal.user.id,sessionVersion:principal.user.sessionVersion});await assertRestorationReviewed(this.store);if((await this.store.control()).stopped)throw new AppError('STOPPED','Resume scheduling before running sandbox checks.',409);}
  async runAndRecord(scope:EvaluationScope,identity:CodeEvaluationIdentity,execute:()=>Promise<CodeSample[]>,signal:AbortSignal):Promise<{id:string;report:CodeEvaluationReport}>{
    const verified=codeEvaluationIdentitySchema.parse(identity);await this.authorize(scope,verified);signal.throwIfAborted();const id=randomUUID();
    await this.store.db.transaction(async tx=>{
      await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[scope.userId]);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[scope.taskId]);await this.owner(scope,tx);await new EvaluationStore(this.store).assertAuthorized(scope,verified.model,tx);
      const control=(await tx.query('SELECT value FROM settings WHERE key=$1',['control']))[0].value as {stopped:boolean;generation:number};const task=(await tx.query('SELECT options,calls_used,stop_generation,status FROM tasks WHERE id=$1 AND user_id=$2',[scope.taskId,scope.userId]))[0];
      if(!task||task.status!=='executing'||control.stopped||control.generation!==task.stop_generation)throw new AppError('REVOKED','The executable evaluation is no longer active.',403);
      if((await tx.query('SELECT id FROM model_evaluations WHERE task_id=$1',[scope.taskId])).length)throw new AppError('EVALUATION_EXISTS','An executable evaluation attempt already exists. Interrupted attempts cannot replay.',409);
      if(Number(task.calls_used)+codeEvaluationCases().length>(task.options as {budget:{maxCalls:number}}).budget.maxCalls)throw new AppError('CALL_BUDGET','Executable suite exceeds the remaining model-call budget.',409);
      if(Number((await tx.query('SELECT count(*) AS count FROM model_evaluations WHERE user_id=$1',[scope.userId]))[0].count)>=200)throw new AppError('EVALUATION_CAPACITY','Evaluation history reached its retained account limit.',409);
      signal.throwIfAborted();await tx.query("INSERT INTO model_evaluations(id,user_id,task_id,protocol,identity,status) VALUES ($1,$2,$3,$4,$5,'running')",[id,scope.userId,scope.taskId,codeEvaluationProtocol,JSON.stringify(verified)]);
    });
    try{
      const samples=await execute();await this.authorize(scope,verified);signal.throwIfAborted();const report=codeEvaluationReportSchema.parse({protocol:codeEvaluationProtocol,source:'provider',identity:verified,measuredAt:new Date().toISOString(),samples});
      if(!codeEvaluationEvidence(report,verified)||Buffer.byteLength(JSON.stringify(report))>65536)throw new AppError('EVALUATION_REPORT','Invalid executable evaluation report.');
      await this.store.db.transaction(async tx=>{await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[scope.userId]);await tx.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[scope.taskId]);await this.owner(scope,tx);await new EvaluationStore(this.store).assertAuthorized(scope,verified.model,tx);signal.throwIfAborted();if(!(await tx.query("UPDATE model_evaluations SET status='completed',report=$1,finished_at=now() WHERE id=$2 AND status='running' RETURNING id",[JSON.stringify(report),id])).length)throw new AppError('EVALUATION_INTERRUPTED','Executable evaluation was interrupted.',409);});
      return {id,report};
    }catch(error){await this.store.db.query("UPDATE model_evaluations SET status='failed',finished_at=now() WHERE id=$1 AND status='running'",[id]);throw error;}
  }
  async history(actor:EvaluationActor){await this.owner(actor);const records=await this.store.db.query('SELECT id,task_id,status,identity,created_at,finished_at,report FROM model_evaluations WHERE user_id=$1 AND protocol=$2 ORDER BY created_at DESC,id DESC LIMIT 40',[actor.userId,codeEvaluationProtocol]);return records.map(record=>{const {report,...metadata}=row<Record<string,unknown>>(record);return {...metadata,result:record.status==='completed'?codeEvaluationEvidence(report,record.identity):null};});}
}
