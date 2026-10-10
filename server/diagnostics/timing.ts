import type {Database,Sql} from '../db/database.js';
import {AppError} from '../core/errors.js';

const terminal=new Set(['completed','failed','cancelled']);
const states=new Set(['created','analyzing','planning','executing','verifying','completed','waiting_for_approval','waiting_for_user','failed','replanning','cancelled','paused','running','interrupted','uncertain']);
const tools=new Set(['file_read','file_list','file_search','file_write','file_delete','host_read','host_list','host_write','host_delete','git_status','git_diff','terminal','http_get','personal_tasks']);
const checks=new Set(['response','model_review','tool_interrupted','tool_denied','tool_outcome','tool_failed','host_file_state','model_evaluation','required_file_read','command_stale','file_read','file_write','file_delete','command','http_get']);
export const timingSemantics='Durations can overlap. Wall coverage unions recorded intervals within each category; never add category totals or parallel call durations to derive task elapsed time. Queue is the initial creation-to-analysis interval only. Execution counters are durable budget accounting, not CPU time. Open waits and reservations are separate from settled counters. First text is a persisted flush timestamp, not first token. Unknown measurements are null.';
const numeric=(value:unknown):number|null=>{if(value===null||value===undefined||typeof value!=='number'&&typeof value!=='string')return null;const result=Number(value);return Number.isFinite(result)&&result>=0&&result<=Number.MAX_SAFE_INTEGER?result:null;};
const time=(value:unknown):number|null=>{if(value===null||value===undefined)return null;const parsed=new Date(value as string|Date).getTime();return Number.isFinite(parsed)?parsed:null;};
const iso=(value:unknown):string|null=>{const parsed=time(value);return parsed===null?null:new Date(parsed).toISOString();};
const span=(start:unknown,end:unknown):number|null=>{const a=time(start),b=time(end);return a!==null&&b!==null&&b>=a?b-a:null;};
const status=(value:unknown)=>typeof value==='string'&&states.has(value)?value:'other';

export function intervalUnionMs(intervals:Array<[number,number]>):number|null {
  if(intervals.some(([start,end])=>!Number.isFinite(start)||!Number.isFinite(end)||end<start))return null;
  const sorted=[...intervals].sort((a,b)=>a[0]-b[0]);let total=0,start:number|undefined,end=0;
  for(const [a,b] of sorted){if(start===undefined){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{total+=end-start;start=a;end=b;}}
  return total+(start===undefined?0:end-start);
}
export interface CallTiming {id:string;taskId:string;agentId:string;status:string;startedAt:string|null;finishedAt:string|null;durationMs:number|null;elapsedMs:number|null;providerDurationMs:number|null;loadDurationMs:number|null;firstContentMs:number|null;loadWallMs:number|null;cleanupWallMs:number|null;streamWallMs:number|null;generationDurationMs:null;firstTokenMs:null;firstTextEventMs:number|null;inputTokens:number|null;outputTokens:number|null;generationTokensPerSecond:number|null;}
export interface ToolTiming {id:string;taskId:string;agentId:string;name:string;status:string;startedAt:string|null;finishedAt:string|null;durationMs:number|null;elapsedMs:number|null;}
export interface CheckTiming {id:string;taskId:string;toolCallId:string|null;kind:string;passed:boolean;createdAt:string|null;}
export interface TaskTiming {id:string;status:string;observedAt:string;createdAt:string|null;updatedAt:string|null;elapsedMs:number|null;queueMs:number|null;executionAccountedMs:number|null;executionReservedMs:number|null;approvalWaitMs:number|null;resourceWaitMs:number|null;activeWaitKind:'approval'|'resource'|null;activeWaitElapsedMs:number|null;modelCallWallMs:number|null;toolWallMs:number|null;counts:{calls:number;tools:number;checks:number};truncated:{calls:boolean;tools:boolean;checks:boolean};calls:CallTiming[];tools:ToolTiming[];checks:CheckTiming[];semantics:string;}

/** Internal batch primitive. Callers authorize IDs and provide a consistent SQL snapshot. */
export async function collectTaskTimings(sql:Sql,ids:string[],maxRecords=2000):Promise<TaskTiming[]> {
  if(ids.length>200||!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>2000)throw new AppError('DIAGNOSTICS_LIMIT','Invalid diagnostic record limit.');
  if(!ids.length)return [];
  // No objectives, options, contexts, results, errors, model IDs or full JSON blobs.
  const tasks=await sql.query(`SELECT t.id,t.status,t.created_at,t.updated_at,t.execution_used_ms,t.execution_reserved_ms,t.approval_wait_ms,t.resource_wait_ms,t.execution_wait_kind,t.execution_wait_started_at,
    transaction_timestamp() AS observed_at,
    (SELECT min(created_at) FROM events WHERE task_id=t.id AND type='TASK_ANALYZING') AS analysis_at,
    (SELECT count(*) FROM model_calls WHERE task_id=t.id) AS call_count,
    (SELECT count(*) FROM tool_calls WHERE task_id=t.id) AS tool_count,
    (SELECT count(*) FROM verification WHERE task_id=t.id) AS check_count
    FROM tasks t WHERE t.id=ANY($1::text[]) ORDER BY t.created_at DESC,t.id`,[ids]);
  const usage=(field:string)=>`CASE WHEN jsonb_typeof(m.usage->'${field}')='number' THEN m.usage->'${field}' ELSE NULL END`;
  const calls=await sql.query(`SELECT m.id,m.task_id,m.agent_id,m.status,m.started_at,m.finished_at,m.input_tokens,m.output_tokens,
    ${usage('durationMs')} AS provider_duration,${usage('loadDurationMs')} AS load_duration,${usage('generationTokensPerSecond')} AS generation_speed,
    ${usage('firstContentMs')} AS first_content,${usage('loadWallMs')} AS load_wall,${usage('cleanupWallMs')} AS cleanup_wall,${usage('streamWallMs')} AS stream_wall,
    (SELECT min(e.created_at) FROM events e WHERE e.task_id=m.task_id AND e.type='MODEL_TEXT' AND e.data->>'callId'=m.id AND e.created_at>=m.started_at AND (m.finished_at IS NULL OR e.created_at<=m.finished_at)) AS first_text_at
    FROM model_calls m WHERE m.task_id=ANY($1::text[]) ORDER BY m.started_at,m.id LIMIT $2`,[ids,maxRecords]);
  const toolRows=await sql.query('SELECT id,task_id,agent_id,name,status,started_at,finished_at FROM tool_calls WHERE task_id=ANY($1::text[]) ORDER BY started_at,id LIMIT $2',[ids,maxRecords]);
  const checkRows=await sql.query(`SELECT v.id,v.task_id,v.kind,v.passed,v.created_at,
    (SELECT c.id FROM tool_calls c WHERE c.task_id=v.task_id AND c.id=v.details->>'toolCallId') AS tool_call_id
    FROM verification v WHERE v.task_id=ANY($1::text[]) ORDER BY v.sequence LIMIT $2`,[ids,maxRecords]);
  return tasks.map(task=>{
    const observedAt=iso(task.observed_at)!;
    const durations=(record:Record<string,unknown>)=>({startedAt:iso(record.started_at),finishedAt:iso(record.finished_at),durationMs:span(record.started_at,record.finished_at),elapsedMs:span(record.started_at,record.finished_at??observedAt)});
    const callList:CallTiming[]=calls.filter(row=>row.task_id===task.id).map(row=>({id:String(row.id),taskId:String(row.task_id),agentId:String(row.agent_id),status:status(row.status),...durations(row),providerDurationMs:numeric(row.provider_duration),loadDurationMs:numeric(row.load_duration),firstContentMs:numeric(row.first_content),loadWallMs:numeric(row.load_wall),cleanupWallMs:numeric(row.cleanup_wall),streamWallMs:numeric(row.stream_wall),generationDurationMs:null,firstTokenMs:null,firstTextEventMs:span(row.started_at,row.first_text_at),inputTokens:numeric(row.input_tokens),outputTokens:numeric(row.output_tokens),generationTokensPerSecond:numeric(row.generation_speed)}));
    const toolList:ToolTiming[]=toolRows.filter(row=>row.task_id===task.id).map(row=>({id:String(row.id),taskId:String(row.task_id),agentId:String(row.agent_id),name:tools.has(String(row.name))?String(row.name):'other',status:status(row.status),...durations(row)}));
    const checkList:CheckTiming[]=checkRows.filter(row=>row.task_id===task.id).map(row=>({id:String(row.id),taskId:String(row.task_id),toolCallId:row.tool_call_id===null?null:String(row.tool_call_id),kind:checks.has(String(row.kind))?String(row.kind):'other',passed:row.passed===true,createdAt:iso(row.created_at)}));
    const counts={calls:Number(task.call_count),tools:Number(task.tool_count),checks:Number(task.check_count)},truncated={calls:counts.calls>callList.length,tools:counts.tools>toolList.length,checks:counts.checks>checkList.length};
    const coverage=(list:Array<{startedAt:string|null;finishedAt:string|null}>,cut:boolean)=>cut?null:intervalUnionMs(list.map(row=>[time(row.startedAt)??NaN,time(row.finishedAt??observedAt)??NaN]));
    const activeWaitKind=task.execution_wait_kind==='approval'||task.execution_wait_kind==='resource'?task.execution_wait_kind:null;
    return {id:String(task.id),status:status(task.status),observedAt,createdAt:iso(task.created_at),updatedAt:iso(task.updated_at),elapsedMs:span(task.created_at,terminal.has(String(task.status))?task.updated_at:observedAt),queueMs:span(task.created_at,task.analysis_at),executionAccountedMs:numeric(task.execution_used_ms),executionReservedMs:numeric(task.execution_reserved_ms),approvalWaitMs:numeric(task.approval_wait_ms),resourceWaitMs:numeric(task.resource_wait_ms),activeWaitKind,activeWaitElapsedMs:activeWaitKind?span(task.execution_wait_started_at,observedAt):null,modelCallWallMs:coverage(callList,truncated.calls),toolWallMs:coverage(toolList,truncated.tools),counts,truncated,calls:callList,tools:toolList,checks:checkList,semantics:timingSemantics};
  });
}
/** Authorization belongs to the calling route; this never accepts a user-supplied SQL filter. */
export async function taskTiming(db:Database,taskId:string,options:{maxRecords?:number}={}):Promise<TaskTiming>{
  return db.transaction(async tx=>{await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='10s'");const result=(await collectTaskTimings(tx,[taskId],options.maxRecords??500))[0];if(!result)throw new AppError('NOT_FOUND','Task not found.',404);return result;});
}
