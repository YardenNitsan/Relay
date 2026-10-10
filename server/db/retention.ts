import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../core/errors.js';
import type {Database,Sql} from './database.js';

export const retentionPolicySchema=z.object({
  expiredCredentials:z.boolean().default(false),terminalPayloads:z.boolean().default(false),
  olderThanDays:z.number().int().min(1).max(3650).default(90),batchSize:z.number().int().min(1).max(500).default(100),
}).strict();
export type RetentionPolicy=z.infer<typeof retentionPolicySchema>;
export interface RetentionActor {id:string;sessionVersion:number;}
const kinds=['sessions','lanInvitations','inferenceTokens','stepContexts','callContexts','modelTextEvents'] as const;
type Kind=typeof kinds[number];
export type RetentionCounts=Record<Kind,number>;
export interface RetentionPreview {token:string;expiresAt:string;policy:RetentionPolicy;cutoff:string;counts:RetentionCounts;protectedTasks:number;limited:boolean;}
export interface RetentionResult {appliedAt:string;policy:RetentionPolicy;cutoff:string;counts:RetentionCounts;protectedTasks:number;limited:boolean;}
interface Candidate {id:string;fingerprint:string;}
interface Selection {rows:Record<Kind,Candidate[]>;counts:RetentionCounts;protectedTasks:number;limited:boolean;}
interface Pending {actor:RetentionActor;policy:RetentionPolicy;cutoff:string;expires:number;fingerprint:string;}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const previewLifetime=10*60_000;

// Keep all financial rows, receipts, task identities and protected references.
// Only terminal tasks with no live execution or recovery/evidence reference qualify.
const eligible=`t.status IN ('completed','failed','cancelled')
 AND t.options->>'workspaceId' IS NULL AND COALESCE(t.options->>'access','')<>'unrestricted'
 AND t.execution_lease_id IS NULL AND t.execution_reserved_ms=0
 AND t.execution_wait_kind IS NULL AND t.execution_wait_started_at IS NULL
 AND NOT EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id=t.id AND s.status='running')
 AND NOT EXISTS (SELECT 1 FROM agent_runs a WHERE a.task_id=t.id AND (a.status='running' OR a.finished_at IS NULL))
 AND NOT EXISTS (SELECT 1 FROM model_calls m WHERE m.task_id=t.id AND (m.status='running' OR m.finished_at IS NULL OR m.cost_state<>'settled'))
 AND NOT EXISTS (SELECT 1 FROM tool_calls c WHERE c.task_id=t.id AND (c.status IN ('running','uncertain') OR c.finished_at IS NULL))
 AND NOT EXISTS (SELECT 1 FROM tool_calls c WHERE c.task_id=t.id AND c.name NOT IN ('file_read','file_list','file_search','host_read','host_list','git_status','git_diff','http_get'))
 AND NOT EXISTS (SELECT 1 FROM approvals p WHERE p.task_id=t.id AND p.status='pending')
 AND NOT EXISTS (SELECT 1 FROM checkpoints c WHERE c.task_id=t.id)
 AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.task_id=t.id)
 AND NOT EXISTS (SELECT 1 FROM model_calibrations c WHERE c.task_id=t.id)`;
const queries:Record<Kind,string>={
  sessions:"SELECT id,md5(row_to_json(s)::text) AS fingerprint FROM sessions s WHERE expires_at <= $1 ORDER BY id LIMIT $2",
  lanInvitations:"SELECT token_hash AS id,md5(row_to_json(i)::text) AS fingerprint FROM lan_invitations i WHERE expires_at <= $1 ORDER BY token_hash LIMIT $2",
  inferenceTokens:"SELECT id,md5(row_to_json(t)::text) AS fingerprint FROM inference_tokens t WHERE expires_at <= $1 AND NOT EXISTS (SELECT 1 FROM inference_requests r WHERE r.token_id=t.id) ORDER BY id LIMIT $2",
  stepContexts:`SELECT s.id,md5(s.context::text||t.updated_at::text||t.status) AS fingerprint FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE t.updated_at <= $1 AND (${eligible}) AND s.context IS NOT NULL AND s.context <> '[]'::jsonb ORDER BY s.id LIMIT $2`,
  callContexts:`SELECT m.id,md5(m.context::text||t.updated_at::text||t.status) AS fingerprint FROM model_calls m JOIN tasks t ON t.id=m.task_id WHERE t.updated_at <= $1 AND (${eligible}) AND m.context <> '[]'::jsonb ORDER BY m.id LIMIT $2`,
  modelTextEvents:`SELECT e.id::text AS id,md5(e.data::text||t.updated_at::text||t.status) AS fingerprint FROM events e JOIN tasks t ON t.id=e.task_id WHERE t.updated_at <= $1 AND (${eligible}) AND e.type='MODEL_TEXT' AND jsonb_typeof(e.data->'text')='string' AND e.data->>'text' <> '' ORDER BY e.id LIMIT $2`,
};
async function select(tx:Sql,policy:RetentionPolicy,cutoff:string):Promise<Selection>{
  const rows={} as Selection['rows'],counts={} as RetentionCounts;let limited=false;
  for(const kind of kinds){
    const enabled=kinds.indexOf(kind)<3?policy.expiredCredentials:policy.terminalPayloads;
    const found=enabled?await tx.query(queries[kind],[cutoff,policy.batchSize+1]):[];
    limited ||= found.length>policy.batchSize;
    rows[kind]=found.slice(0,policy.batchSize).map(row=>({id:String(row.id),fingerprint:String(row.fingerprint)}));counts[kind]=rows[kind].length;
  }
  const protectedTasks=policy.terminalPayloads?Number((await tx.query(`SELECT count(*) AS count FROM tasks t WHERE t.updated_at <= $1 AND NOT (${eligible})`,[cutoff]))[0].count):0;
  return {rows,counts,protectedTasks,limited};
}
async function assertOwner(tx:Sql,actor:RetentionActor,lock=false):Promise<void>{
  if(!actor||typeof actor.id!=='string'||!Number.isSafeInteger(actor.sessionVersion))throw new AppError('RETENTION_OWNER','Current owner authorization is required.',403);
  const user=(await tx.query(`SELECT role,enabled,registration_status,session_version FROM users WHERE id=$1${lock?' FOR UPDATE':''}`,[actor.id]))[0];
  if(!user||user.role!=='owner'||user.enabled!==true||user.registration_status!=='approved'||Number(user.session_version)!==actor.sessionVersion)throw new AppError('RETENTION_OWNER','Current owner authorization is required.',403);
}
const fingerprint=(selection:Selection)=>digest(JSON.stringify(selection.rows));

/** No scheduler, filesystem cleanup or automatic application. The API must also
 * require a local owner session, CSRF and an explicit confirmation action. */
export class RetentionService {
  private readonly previews=new Map<string,Pending>();
  constructor(private readonly db:Database,private readonly now:()=>number=Date.now){}
  async preview(actor:RetentionActor,input:unknown):Promise<RetentionPreview>{
    const policy=retentionPolicySchema.parse(input),now=this.now();
    for(const [key,pending] of this.previews)if(pending.expires<=now)this.previews.delete(key);
    if(this.previews.size>=16)throw new AppError('RETENTION_LIMIT','Too many outstanding retention previews. Wait for an existing preview to expire.',429);
    const snapshot=await this.db.transaction(async tx=>{
      await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await tx.exec("SET LOCAL statement_timeout='10s'");
      await assertOwner(tx,actor);
      const time=(await tx.query('SELECT clock_timestamp() AS current_time'))[0].current_time;
      const cutoff=new Date(new Date(time as string|Date).getTime()-policy.olderThanDays*86_400_000).toISOString();
      return {cutoff,selection:await select(tx,policy,cutoff)};
    });
    // Concurrent previews cannot exceed the process-local bound after their reads.
    if(this.previews.size>=16)throw new AppError('RETENTION_LIMIT','Too many outstanding retention previews.',429);
    const token=randomBytes(32).toString('base64url'),expires=this.now()+previewLifetime;
    this.previews.set(digest(token),{actor:{...actor},policy,cutoff:snapshot.cutoff,expires,fingerprint:fingerprint(snapshot.selection)});
    const {counts,protectedTasks,limited}=snapshot.selection;
    return {token,expiresAt:new Date(expires).toISOString(),policy:{...policy},cutoff:snapshot.cutoff,counts,protectedTasks,limited};
  }
  async apply(actor:RetentionActor,token:string):Promise<RetentionResult>{
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw new AppError('RETENTION_PREVIEW','Request a new retention preview before applying.',409);
    const key=digest(token),pending=this.previews.get(key);this.previews.delete(key);
    if(!pending||pending.expires<=this.now())throw new AppError('RETENTION_PREVIEW','This retention preview expired or was already consumed. Request a new preview.',409);
    try{return await this.db.transaction(async tx=>{
      await tx.exec("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='10s'");
      // Existing control-plane lock order: global control, then actor. A busy
      // mutation table fails immediately; EXCLUSIVE also blocks locking reads
      // and uncoordinated inserts while eligibility is rechecked and redacted.
      await tx.query("SELECT value FROM settings WHERE key='control' FOR UPDATE");
      await assertOwner(tx,actor,true);
      if(actor.id!==pending.actor.id||actor.sessionVersion!==pending.actor.sessionVersion)throw new AppError('RETENTION_OWNER','The preview belongs to a different owner session.',403);
      await tx.exec('LOCK TABLE tasks,task_steps,agent_runs,model_calls,tool_calls,approvals,checkpoints,artifacts,model_calibrations,events,sessions,lan_invitations,inference_tokens,inference_requests IN EXCLUSIVE MODE NOWAIT');
      if(pending.expires<=this.now())throw new AppError('RETENTION_PREVIEW','The preview expired while waiting. Request a new preview.',409);
      const selected=await select(tx,pending.policy,pending.cutoff);
      if(fingerprint(selected)!==pending.fingerprint)throw new AppError('RETENTION_STALE','Eligible records changed since preview. Nothing was removed; request a new preview.',409);
      const ids=(kind:Kind)=>selected.rows[kind].map(row=>row.id);
      if(selected.counts.sessions)await tx.query('DELETE FROM sessions WHERE id=ANY($1::text[])',[ids('sessions')]);
      if(selected.counts.lanInvitations)await tx.query('DELETE FROM lan_invitations WHERE token_hash=ANY($1::text[])',[ids('lanInvitations')]);
      if(selected.counts.inferenceTokens)await tx.query('DELETE FROM inference_tokens WHERE id=ANY($1::text[])',[ids('inferenceTokens')]);
      if(selected.counts.stepContexts)await tx.query('UPDATE task_steps SET context=NULL WHERE id=ANY($1::text[])',[ids('stepContexts')]);
      if(selected.counts.callContexts)await tx.query("UPDATE model_calls SET context='[]'::jsonb WHERE id=ANY($1::text[])",[ids('callContexts')]);
      const appliedAt=new Date(this.now()).toISOString();
      if(selected.counts.modelTextEvents)await tx.query("UPDATE events SET data=(data-'text')||jsonb_build_object('text','','retention',jsonb_build_object('redacted',true,'appliedAt',$2::text)) WHERE id=ANY($1::bigint[])",[ids('modelTextEvents'),appliedAt]);
      const result={appliedAt,policy:pending.policy,cutoff:pending.cutoff,counts:selected.counts,protectedTasks:selected.protectedTasks,limited:selected.limited};
      await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('RETENTION_APPLIED',$1)",[JSON.stringify({...result,actorId:actor.id,actorSessionVersion:actor.sessionVersion})]);
      return result;
    });}catch(error){
      if(error instanceof AppError)throw error;
      throw new AppError('RETENTION_FAILED','Retention could not acquire a safe database window or complete its transaction. No changes were committed; request a new preview.',409);
    }
  }
}
