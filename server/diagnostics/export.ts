import {createHmac,randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {Database} from '../db/database.js';
import {AppError} from '../core/errors.js';
import {collectTaskTimings,type TaskTiming,timingSemantics} from './timing.js';

const inputSchema=z.object({days:z.number().int().min(1).max(7).default(7),maxTasks:z.number().int().min(1).max(200).default(200)}).strict();
export interface DiagnosticsActor {id:string;sessionVersion:number;}
export interface DiagnosticsBundle {format:1;scope:'own_account';generatedAt:string;window:{days:number;since:string};tasks:TaskTiming[];counts:{matchingTasks:number;exportedTasks:number};truncated:{tasks:boolean;records:boolean;bytes:boolean};semantics:string;}
const maxBytes=2*1024*1024;

/** API must additionally require the local owner's authenticated session/CSRF. */
export async function exportDiagnostics(db:Database,actor:DiagnosticsActor,input:unknown={}):Promise<DiagnosticsBundle>{
  const policy=inputSchema.parse(input),secret=randomBytes(32);
  const correlation=(kind:string,id:string)=>createHmac('sha256',secret).update(`${kind}\0${id}`).digest('hex');
  try{return await db.transaction(async tx=>{
    await tx.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='2s'");
    const user=(await tx.query('SELECT role,enabled,registration_status,session_version FROM users WHERE id=$1 FOR UPDATE',[actor.id]))[0];
    if(!user||user.role!=='owner'||user.enabled!==true||user.registration_status!=='approved'||Number(user.session_version)!==actor.sessionVersion)throw new AppError('DIAGNOSTICS_OWNER','Current local owner authorization is required.',403);
    const time=(await tx.query('SELECT transaction_timestamp() AS now'))[0].now;
    const generatedAt=new Date(time as string|Date).toISOString(),since=new Date(new Date(generatedAt).getTime()-policy.days*86400000).toISOString();
    const matchingTasks=Number((await tx.query('SELECT count(*) AS count FROM tasks WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3',[actor.id,since,generatedAt]))[0].count);
    const ids=(await tx.query('SELECT id FROM tasks WHERE user_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at DESC,id LIMIT $4',[actor.id,since,generatedAt,policy.maxTasks])).map(row=>String(row.id));
    const tasks=(await collectTaskTimings(tx,ids)).map(task=>({...task,id:correlation('task',task.id),calls:task.calls.map(call=>({...call,id:correlation('call',call.id),taskId:correlation('task',call.taskId),agentId:correlation('agent',call.agentId)})),tools:task.tools.map(tool=>({...tool,id:correlation('tool',tool.id),taskId:correlation('task',tool.taskId),agentId:correlation('agent',tool.agentId)})),checks:task.checks.map(check=>({...check,id:correlation('check',check.id),taskId:correlation('task',check.taskId),toolCallId:check.toolCallId===null?null:correlation('tool',check.toolCallId)}))}));
    const result:DiagnosticsBundle={format:1,scope:'own_account',generatedAt,window:{days:policy.days,since},tasks,counts:{matchingTasks,exportedTasks:tasks.length},truncated:{tasks:matchingTasks>tasks.length,records:tasks.some(task=>Object.values(task.truncated).some(Boolean)),bytes:false},semantics:timingSemantics};
    while(Buffer.byteLength(JSON.stringify(result))>maxBytes&&result.tasks.length){result.tasks.pop();result.counts.exportedTasks=result.tasks.length;result.truncated.tasks=true;result.truncated.bytes=true;}
    await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('DIAGNOSTICS_EXPORTED',$1)",[JSON.stringify({format:1,days:policy.days,maxTasks:policy.maxTasks,exportedTasks:result.counts.exportedTasks,truncated:result.truncated})]);
    return result;
  });}finally{secret.fill(0);}
}
