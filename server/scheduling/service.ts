import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {TaskOptions,TaskStatus} from '../../shared/types.js';
import {reasoningEfforts} from '../../shared/model-controls.js';
import {authorizeOptions,authorizeOwner,type Principal,type User} from '../auth/policy.js';
import {AppError,publicError} from '../core/errors.js';
import type {Sql} from '../db/database.js';
import {Store,row,workspaceScope} from '../db/store.js';
import {verificationContractSchema} from '../orchestration/required-reads.js';

// Scheduled objectives cannot obtain interactive/external action capabilities.
export const scheduledOptionsSchema=z.object({
  depth:z.enum(['fast','balanced','deep','maximum']),modelId:z.string().max(200).regex(/^(ollama|lmstudio)[/:].+/).nullable(),
  modelSelection:z.enum(['preferred','required']).optional(),reasoning:z.enum(['auto','default',...reasoningEfforts]).optional(),efficiency:z.enum(['efficient','standard']).optional(),
  access:z.literal('read_only'),hostAccessConfirmed:z.literal(false).optional(),workspaceId:z.string().uuid().nullable(),contextTokens:z.number().int().min(2048).max(131072),
  cloudPolicy:z.literal('local_only'),network:z.object({mode:z.literal('deny'),allowedOrigins:z.array(z.never()).max(0)}).strict().default({mode:'deny',allowedOrigins:[]}),
  mcpServerIds:z.array(z.never()).max(0).optional(),verification:verificationContractSchema.optional(),
  budget:z.object({maxCalls:z.number().int().min(1).max(64),maxIterations:z.number().int().min(1).max(16),maxSeconds:z.number().int().min(30).max(3600),maxElapsedSeconds:z.number().int().min(30).max(604800).optional(),maxOutputTokens:z.number().int().min(256).max(8192),maxCostUsd:z.literal(0),localOnly:z.literal(true)}).strict(),
}).strict();
export const scheduleInputSchema=z.object({name:z.string().trim().min(1).max(100),objective:z.string().trim().min(1).max(16000),startAt:z.string().datetime(),intervalMinutes:z.number().int().min(15).max(525600).nullable(),missedPolicy:z.enum(['skip','once']),enabled:z.boolean(),confirmed:z.literal(true),options:scheduledOptionsSchema}).strict();
const toggleSchema=z.object({enabled:z.boolean(),confirmed:z.literal(true)}).strict();
export interface Schedule {id:string;userId:string;name:string;objective:string;options:TaskOptions;sessionVersion:number;grantSnapshot:User['permissions'];intervalMinutes:number|null;missedPolicy:'skip'|'once';nextRunAt:string|null;enabled:boolean;archivedAt:string|null;lastError:string|null;revision:number;createdAt:string;updatedAt:string;}
export interface ScheduleRun {id:string;scheduleId:string;userId:string;scheduledAt:string;taskId:string|null;scheduleRevision:number;status:'claimed'|'dispatched'|'skipped'|'interrupted'|'failed';reason:string|null;createdAt:string;taskStatus:TaskStatus|null;}
interface SchedulerEngine {enqueue(id:string):unknown;cancel(id:string):Promise<unknown>;}
const unfinished="('completed','cancelled','failed')";

export class ScheduleService {
  private timer:ReturnType<typeof setTimeout>|undefined;
  private pending:Promise<void>|undefined;
  private running=false;
  private observedDue=new Map<string,number>();
  private lastPollAt:number|null=null;
  private readonly now:()=>number;
  constructor(private readonly store:Store,private readonly engine:SchedulerEngine,config:{now?:()=>number}={}){this.now=config.now??Date.now;}
  private async principal(tx:Sql,actor:Principal,lock=false):Promise<Principal>{
    authorizeOwner(actor);
    const found=(await tx.query(`SELECT * FROM users WHERE id=$1${lock?' FOR UPDATE':''}`,[actor.user.id]))[0];
    if(!found)throw new AppError('USER_DISABLED','The scheduling account is unavailable.',403);
    const user=row<User>(found);authorizeOwner({...actor,user});
    if(!user.enabled||user.registrationStatus&&user.registrationStatus!=='approved')throw new AppError('USER_DISABLED','The scheduling account is disabled.',403);
    if(user.sessionVersion!==actor.user.sessionVersion)throw new AppError('REVOKED','Scheduling authorization was revoked. Enable the schedule again from a current owner session.',403);
    return {...actor,user};
  }
  private async lock(tx:Sql,actor:Principal){await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);return this.principal(tx,actor,true);}
  private async scoped(tx:Sql,actor:Principal,id:string,lock=false):Promise<Schedule>{const found=(await tx.query(`SELECT * FROM task_schedules WHERE id=$1 AND user_id=$2${lock?' FOR UPDATE':''}`,[id,actor.user.id]))[0];if(!found)throw new AppError('NOT_FOUND','Schedule not found.',404);return row<Schedule>(found);}
  private async options(tx:Sql,actor:Principal,raw:unknown):Promise<TaskOptions>{
    const options=scheduledOptionsSchema.parse(raw);const workspace=await workspaceScope(tx,options.workspaceId);
    if(options.workspaceId&&!workspace)throw new AppError('WORKSPACE_DENIED','The scheduled workspace is no longer available.',403);
    return authorizeOptions(actor,options,workspace);
  }
  async create(actor:Principal,raw:unknown):Promise<Schedule>{
    const input=scheduleInputSchema.parse(raw);if(Date.parse(input.startAt)<=this.now())throw new AppError('SCHEDULE_TIME','Choose a future start time.');
    return this.store.db.transaction(async tx=>{const current=await this.lock(tx,actor);const options=await this.options(tx,current,input.options);
      if(Number((await tx.query('SELECT count(*) AS count FROM task_schedules WHERE user_id=$1',[current.user.id]))[0].count)>=50)throw new AppError('SCHEDULE_CAPACITY','This account has reached the 50-schedule retention limit.',409);
      return row<Schedule>((await tx.query('INSERT INTO task_schedules(id,user_id,name,objective,options,session_version,grant_snapshot,interval_minutes,missed_policy,next_run_at,enabled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),current.user.id,input.name,input.objective,JSON.stringify(options),current.user.sessionVersion,JSON.stringify(current.user.permissions),input.intervalMinutes,input.missedPolicy,input.startAt,input.enabled]))[0]);
    });
  }
  async list(actor:Principal):Promise<Schedule[]>{await this.principal(this.store.db,actor);return (await this.store.db.query('SELECT * FROM task_schedules WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 50',[actor.user.id])).map(r=>row<Schedule>(r));}
  async runs(actor:Principal,id:string):Promise<ScheduleRun[]>{await this.principal(this.store.db,actor);await this.scoped(this.store.db,actor,id);return (await this.store.db.query('SELECT r.*,t.status AS task_status FROM schedule_runs r LEFT JOIN tasks t ON t.id=r.task_id WHERE r.schedule_id=$1 AND r.user_id=$2 ORDER BY r.scheduled_at DESC,r.id LIMIT 50',[id,actor.user.id])).map(r=>row<ScheduleRun>(r));}
  async setEnabled(actor:Principal,id:string,raw:unknown):Promise<Schedule>{
    const input=toggleSchema.parse(raw);const result=await this.store.db.transaction(async tx=>{
      const current=await this.lock(tx,actor);const schedule=await this.scoped(tx,current,id,true);
      if(schedule.archivedAt)throw new AppError('SCHEDULE_ARCHIVED','An archived schedule cannot be enabled.',409);
      if(input.enabled){await this.options(tx,current,schedule.options);if(!schedule.nextRunAt)throw new AppError('SCHEDULE_FINISHED','This one-time schedule has finished. Create a new schedule.',409);}
      return row<Schedule>((await tx.query('UPDATE task_schedules SET enabled=$1,session_version=$2,grant_snapshot=$3,revision=revision+1,last_error=NULL,updated_at=now() WHERE id=$4 RETURNING *',[input.enabled,current.user.sessionVersion,JSON.stringify(current.user.permissions),id]))[0]);
    });if(!input.enabled)await this.cancelUnfinished(id,actor.user.id);return result;
  }
  async archive(actor:Principal,id:string):Promise<void>{await this.store.db.transaction(async tx=>{const current=await this.lock(tx,actor);await this.scoped(tx,current,id,true);await tx.query('UPDATE task_schedules SET enabled=false,archived_at=now(),revision=revision+1,updated_at=now() WHERE id=$1',[id]);});await this.cancelUnfinished(id,actor.user.id);}
  private async cancelUnfinished(id:string,userId:string){const tasks=await this.store.db.query(`SELECT t.id FROM schedule_runs r JOIN tasks t ON t.id=r.task_id WHERE r.schedule_id=$1 AND r.user_id=$2 AND t.status NOT IN ${unfinished}`,[id,userId]);for(const task of tasks)await this.engine.cancel(String(task.id));}
  /** Startup only, after Engine recovery. Never redispatch an interrupted occurrence. */
  async recoverInterrupted(){await this.store.db.query("UPDATE schedule_runs SET status='interrupted',reason='Dispatch or execution was interrupted. Review the linked task; this occurrence will not replay automatically.' WHERE status IN ('claimed','dispatched') AND (task_id IS NULL OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=schedule_runs.task_id AND t.status IN ('created','paused','cancelled','failed')))");}
  tick():Promise<void>{if(this.pending)return this.pending;this.pending=this.tickOnce().finally(()=>{this.pending=undefined;});return this.pending;}
  private async tickOnce(){
    // Updating updated_at on every attempt rotates blocked work behind other due schedules.
    // Remember first discovery of the bounded due set. Our own serial dispatch
    // and quota waits are queue time, not a missed occurrence after downtime.
    const polledAt=this.now();
    const dueRows=await this.store.db.query('SELECT * FROM task_schedules WHERE enabled AND archived_at IS NULL AND next_run_at<=$1 ORDER BY updated_at,next_run_at,id LIMIT 50',[new Date(polledAt).toISOString()]);
    if(this.lastPollAt===null||polledAt<this.lastPollAt||polledAt-this.lastPollAt>60_000)this.observedDue.clear();
    this.lastPollAt=polledAt;
    const key=(schedule:Schedule)=>`${schedule.id}/${schedule.nextRunAt}/${schedule.revision}`;
    const dueSchedules=dueRows.map(saved=>row<Schedule>(saved));
    this.observedDue=new Map(dueSchedules.map(schedule=>[key(schedule),this.observedDue.get(key(schedule))??polledAt]));
    const due=dueRows[0];if(!due)return;
    const candidate=row<Schedule>(due);let claimed:{runId:string;taskId:string;actor:Principal;revision:number}|undefined;
    try{claimed=await this.store.db.transaction(async tx=>{
      const control=(await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']))[0].value as {stopped:boolean};
      if(control.stopped||(await tx.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0]?.value===true){this.observedDue.clear();return;}
      const actor=await this.principal(tx,{user:{id:candidate.userId,role:'owner',sessionVersion:candidate.sessionVersion} as User,remote:false,sessionId:'schedule'},true);
      const schedule=await this.scoped(tx,actor,candidate.id,true);if(!schedule.enabled||schedule.archivedAt||!schedule.nextRunAt||Date.parse(schedule.nextRunAt)>this.now())return;
      // Reread authorization from the locked schedule, not the earlier candidate.
      if(schedule.sessionVersion!==actor.user.sessionVersion)throw new AppError('REVOKED','Scheduling authorization was revoked.',403);
      const options=await this.options(tx,actor,schedule.options);
      if(Number((await tx.query('SELECT count(*) AS count FROM schedule_runs WHERE user_id=$1',[actor.user.id]))[0].count)>=5000)throw new AppError('SCHEDULE_CAPACITY','Schedule history reached its 5,000-run retention limit. Scheduling is paused; no history was deleted.',409);
      if((await tx.query(`SELECT t.id FROM schedule_runs r JOIN tasks t ON t.id=r.task_id WHERE r.schedule_id=$1 AND t.status NOT IN ${unfinished} LIMIT 1`,[schedule.id])).length)throw new AppError('SCHEDULE_BUSY','A previous scheduled task is unfinished. Review or cancel it.',409);
      const scheduledAt=Date.parse(schedule.nextRunAt),now=this.now(),firstObserved=this.observedDue.get(key(schedule))??now;
      const skipped=schedule.missedPolicy==='skip'&&firstObserved-scheduledAt>60_000;
      const next=schedule.intervalMinutes?new Date(scheduledAt+(Math.floor(Math.max(0,now-scheduledAt)/(schedule.intervalMinutes*60_000))+1)*schedule.intervalMinutes*60_000).toISOString():null;
      const runId=randomUUID();
      const receipt=await tx.query('INSERT INTO schedule_runs(id,schedule_id,user_id,scheduled_at,schedule_revision,status,reason) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(schedule_id,scheduled_at) DO NOTHING RETURNING id',[runId,schedule.id,actor.user.id,schedule.nextRunAt,schedule.revision,skipped?'skipped':'claimed',skipped?'Missed occurrence skipped according to its policy.':null]);if(!receipt.length)return;
      let taskId:string|undefined;
      if(!skipped){const created=await this.store.createTaskInTransaction(tx,randomUUID(),schedule.objective,options,actor.user.id,actor.user.sessionVersion,true);taskId=created.task.id;await tx.query('UPDATE schedule_runs SET task_id=$1 WHERE id=$2',[taskId,runId]);}
      await tx.query('UPDATE task_schedules SET next_run_at=$1,enabled=$2,last_error=NULL,updated_at=now() WHERE id=$3',[next,!!next,schedule.id]);
      return taskId?{runId,taskId,actor,revision:schedule.revision}:undefined;
    });}catch(error){const transient=error instanceof AppError&&['USER_TASK_QUOTA','SCHEDULE_BUSY'].includes(error.code);await this.store.db.query('UPDATE task_schedules SET last_error=$1,enabled=CASE WHEN $2 THEN enabled ELSE false END,updated_at=now() WHERE id=$3 AND revision=$4',[publicError(error),transient,candidate.id,candidate.revision]);return;}
    if(!claimed)return;
    try{
      const admitted=await this.store.db.transaction(async tx=>{
        const control=(await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']))[0].value as {stopped:boolean;generation:number};
        const actor=await this.principal(tx,claimed.actor,true);const schedule=await this.scoped(tx,actor,candidate.id,true);await this.options(tx,actor,schedule.options);
        const task=(await tx.query('SELECT status,stop_generation FROM tasks WHERE id=$1 FOR UPDATE',[claimed.taskId]))[0];
        const restorationPending=(await tx.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0]?.value===true;
        if(control.stopped||restorationPending||schedule.revision!==claimed.revision||schedule.archivedAt||task.status!=='created'||task.stop_generation!==control.generation)throw new AppError('SCHEDULE_INTERRUPTED','Schedule was stopped or changed before dispatch.',409);
        return (await tx.query("UPDATE schedule_runs SET status='dispatched' WHERE id=$1 AND status='claimed' RETURNING id",[claimed.runId])).length>0;
      });
      if(admitted)this.engine.enqueue(claimed.taskId);
    }catch(error){await this.store.db.query("UPDATE schedule_runs SET status='interrupted',reason=$1 WHERE id=$2",[publicError(error),claimed.runId]);await this.engine.cancel(claimed.taskId);}
  }
  async start(){if(this.running)return;await this.recoverInterrupted();this.running=true;const loop=async()=>{try{await this.tick();}catch{/* Keep the bounded polling loop alive after a transient database failure. */}finally{if(this.running){this.timer=setTimeout(()=>{void loop();},15_000);this.timer.unref();}}};this.timer=setTimeout(()=>{void loop();},0);this.timer.unref();}
  async stop(){this.running=false;if(this.timer)clearTimeout(this.timer);await this.pending;this.observedDue.clear();this.lastPollAt=null;}
}
