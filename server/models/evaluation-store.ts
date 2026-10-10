import {randomUUID} from 'node:crypto';
import type {TaskOptions} from '../../shared/types.js';
import {AppError} from '../core/errors.js';
import {authorizeOptions,type User} from '../auth/policy.js';
import {row,type Store} from '../db/store.js';
import type {Sql} from '../db/database.js';
import {evaluationCases,evaluationEvidence,evaluationIdentitySchema,evaluationProtocol,evaluationReportSchema,runEvaluation,type EvaluationExecutor,type EvaluationIdentity,type EvaluationReport} from './evaluation.js';

export interface EvaluationActor {userId:string;sessionVersion:number;}
export interface EvaluationScope extends EvaluationActor {taskId:string;}
export interface StoredEvaluation {id:string;taskId:string;status:'running'|'completed'|'failed'|'interrupted';protocol:string;identity:EvaluationIdentity;createdAt:string;finishedAt:string|null;result:ReturnType<typeof evaluationEvidence>;}
const maximumReports=200;

/** Internal host service, never an HTTP report-ingestion endpoint. The only write
 * path runs the trusted executor itself; caller-supplied reports are not accepted. */
export class EvaluationStore {
  constructor(private readonly store:Store){}
  /** Fresh durable check for production execution and its revocation watchdog. */
  async assertAuthorized(scope:EvaluationScope,identity:EvaluationIdentity,sql:Sql=this.store.db):Promise<void>{await this.authorize(scope,evaluationIdentitySchema.parse(identity),sql,false,0);}
  private async account(actor:EvaluationActor,sql:Sql=this.store.db):Promise<User>{
    const found=(await sql.query('SELECT * FROM users WHERE id=$1',[actor.userId]))[0];
    const user=found?row<User>(found):undefined;
    if(!user?.enabled||user.sessionVersion!==actor.sessionVersion||user.registrationStatus!==undefined&&user.registrationStatus!=='approved')throw new AppError('REVOKED','Evaluation account permission was revoked.',403);
    return user;
  }
  private async authorize(scope:EvaluationScope,identity:EvaluationIdentity,sql:Sql=this.store.db,lock=false,remainingCalls=1):Promise<void>{
    if(lock){
      await sql.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);
      await sql.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[scope.userId]);
      await sql.query('SELECT id FROM tasks WHERE id=$1 FOR UPDATE',[scope.taskId]);
    }
    const user=await this.account(scope,sql);
    const found=(await sql.query('SELECT * FROM tasks WHERE id=$1 AND user_id=$2',[scope.taskId,scope.userId]))[0];
    if(!found)throw new AppError('NOT_FOUND','Evaluation task not found.',404);
    const control=(await sql.query('SELECT value FROM settings WHERE key=$1',['control']))[0].value as {stopped:boolean;generation:number};
    if(control.stopped||control.generation!==found.stop_generation||found.status!=='executing')throw new AppError('REVOKED','Evaluation task is stopped or no longer executing.',403);
    const options=found.options as TaskOptions;
    authorizeOptions({user,remote:user.role!=='owner',sessionId:'evaluation'},options);
    if(!['ollama','lmstudio'].includes(identity.provider)||!options.budget.localOnly||options.cloudPolicy!==undefined&&options.cloudPolicy!=='local_only')throw new AppError('EVALUATION_LOCAL_ONLY','This evaluation runner currently supports local inference only.',403);
    if(options.modelSelection!=='required'||options.modelId!==identity.modelId||options.contextTokens!==identity.contextTokens||(options.budget.maxOutputTokens??2048)!==identity.executionSettings.maxOutputTokens||options.access!=='read_only'||options.workspaceId||options.hostAccessConfirmed||options.assistantId||options.verification||options.mcpServerIds?.length||options.network&&options.network.mode!=='deny')throw new AppError('EVALUATION_SCOPE','Evaluation task must use the exact model and context/output settings without workspace or action permissions.',403);
    if(!user.permissions.providers.includes(identity.provider))throw new AppError('PROVIDER_DENIED','Evaluation provider is no longer authorized.',403);
    if(Number(found.calls_used)+remainingCalls>options.budget.maxCalls)throw new AppError('CALL_BUDGET','Evaluation task has insufficient remaining calls.',409);
  }
  async runAndRecord(scope:EvaluationScope,identity:EvaluationIdentity,execute:EvaluationExecutor,options:{signal:AbortSignal;maxCalls:number;timeoutMs:number}):Promise<{id:string;report:EvaluationReport}>{
    const verified=evaluationIdentitySchema.parse(identity),count=evaluationCases().length;
    if(!Number.isInteger(options.maxCalls)||options.maxCalls<count||options.maxCalls>64||!Number.isInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>120000)throw new AppError('EVALUATION_BUDGET','Invalid evaluation call or time budget.');
    options.signal.throwIfAborted();const id=randomUUID();
    await this.store.db.transaction(async tx=>{
      await this.authorize(scope,verified,tx,true,count);
      if((await tx.query('SELECT id FROM model_evaluations WHERE task_id=$1',[scope.taskId])).length)throw new AppError('EVALUATION_EXISTS','This task already has an evaluation attempt; interrupted attempts are not replayed.',409);
      if(Number((await tx.query('SELECT count(*) AS count FROM model_evaluations WHERE user_id=$1',[scope.userId]))[0].count)>=maximumReports)throw new AppError('EVALUATION_CAPACITY','Evaluation history has reached its account limit. Export and explicitly review retention before running more.',409);
      options.signal.throwIfAborted();
      await tx.query("INSERT INTO model_evaluations(id,user_id,task_id,protocol,identity,status) VALUES ($1,$2,$3,$4,$5,'running')",[id,scope.userId,scope.taskId,evaluationProtocol,JSON.stringify(verified)]);
    });
    try{
      const report=await runEvaluation(verified,async(sample,execution)=>{
        await this.authorize(scope,verified);execution.signal.throwIfAborted();
        if(!(await this.store.db.query("SELECT id FROM model_evaluations WHERE id=$1 AND user_id=$2 AND status='running'",[id,scope.userId])).length)throw new AppError('EVALUATION_INTERRUPTED','Evaluation attempt was interrupted.',409);
        return execute(sample,execution);
      },{...options,source:'provider'});
      if(!evaluationEvidence(report,verified)||Buffer.byteLength(JSON.stringify(report))>65536)throw new AppError('EVALUATION_REPORT','Evaluation report is invalid or exceeds its storage limit.');
      await this.store.db.transaction(async tx=>{
        await this.authorize(scope,verified,tx,true,0);options.signal.throwIfAborted();
        const updated=await tx.query("UPDATE model_evaluations SET report=$1,status='completed',finished_at=now() WHERE id=$2 AND user_id=$3 AND status='running' RETURNING id",[JSON.stringify(report),id,scope.userId]);
        if(!updated.length)throw new AppError('EVALUATION_INTERRUPTED','Evaluation attempt was interrupted.',409);
      });
      return {id,report};
    }catch(error){
      await this.store.db.query("UPDATE model_evaluations SET status='failed',finished_at=now() WHERE id=$1 AND user_id=$2 AND status='running'",[id,scope.userId]);
      throw error;
    }
  }
  /** Startup-only maintenance, before any executors are admitted. No auto-retry. */
  async recoverInterrupted():Promise<void>{await this.store.db.query("UPDATE model_evaluations SET status='interrupted',finished_at=now() WHERE status='running'");}
  async history(actor:EvaluationActor,limit=20):Promise<StoredEvaluation[]>{
    await this.account(actor);
    if(!Number.isInteger(limit)||limit<1||limit>40)throw new AppError('EVALUATION_LIMIT','History limit must be between 1 and 40.');
    const records=await this.store.db.query('SELECT id,task_id,status,protocol,identity,created_at,finished_at,report FROM model_evaluations WHERE user_id=$1 AND protocol=$3 ORDER BY created_at DESC,id DESC LIMIT $2',[actor.userId,limit,evaluationProtocol]);
    return records.map(record=>{const {report,...metadata}=row<Record<string,unknown>>(record);return {...metadata,result:record.status==='completed'?evaluationEvidence(report,record.identity):null} as unknown as StoredEvaluation;});
  }
  async report(actor:EvaluationActor,id:string):Promise<EvaluationReport>{
    await this.account(actor);const found=(await this.store.db.query("SELECT report,identity FROM model_evaluations WHERE id=$1 AND user_id=$2 AND status='completed' AND protocol=$3",[id,actor.userId,evaluationProtocol]))[0];
    if(!found)throw new AppError('NOT_FOUND','Evaluation report not found.',404);
    const parsed=evaluationReportSchema.safeParse(found.report);
    if(!parsed.success||!evaluationEvidence(parsed.data,found.identity))throw new AppError('EVALUATION_REPORT','Stored evaluation evidence is invalid.',409);
    return parsed.data;
  }
  async evidence(actor:EvaluationActor,identity:EvaluationIdentity):Promise<ReturnType<typeof evaluationEvidence>>{
    await this.account(actor);const verified=evaluationIdentitySchema.parse(identity);
    const records=await this.store.db.query("SELECT report FROM model_evaluations WHERE user_id=$1 AND protocol=$2 AND identity=$3::jsonb AND status='completed' ORDER BY created_at DESC,id DESC LIMIT 10",[actor.userId,evaluationProtocol,JSON.stringify(verified)]);
    for(const record of records){const evidence=evaluationEvidence(record.report,verified);if(evidence)return evidence;}
    return null;
  }
}
