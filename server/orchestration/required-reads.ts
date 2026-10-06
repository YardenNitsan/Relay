import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RequiredRead, TaskRecord } from '../../shared/types.js';
import type { Sql } from '../db/database.js';
import type { Store } from '../db/store.js';
import { toolSchemas } from '../tools/policy.js';

export const verificationContractSchema=z.object({requiredReads:z.array(z.object({path:toolSchemas.file_read.shape.path.max(512),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(8)}).strict().refine(contract=>new Set(contract.requiredReads.map(item=>item.path)).size===contract.requiredReads.length,'Each required file path must be unique');
export interface RequiredReadStatus extends RequiredRead {passed:boolean;toolCallId:string|null;}
export const requiredReadKey=(requirement:RequiredRead)=>`required-read:${createHash('sha256').update(JSON.stringify([requirement.path,requirement.expectedSha256])).digest('hex')}`;

/** Only completed broker calls with successful recorded evidence can satisfy a
 * user requirement. Model prose and synthetic context receipts are never queried. */
export async function requiredReadStatus(db:Sql,task:Pick<TaskRecord,'id'|'options'>):Promise<RequiredReadStatus[]> {
  const requirements=task.options.verification?.requiredReads??[];
  if(!requirements.length)return [];
  const rows=await db.query(`SELECT t.id,t.arguments,t.result,e.id AS sequence FROM tool_calls t
    JOIN events e ON e.task_id=t.task_id AND e.type='TOOL_COMPLETED' AND e.data->>'toolCallId'=t.id
    WHERE t.task_id=$1 AND t.name='file_read' AND t.status='completed'
      AND e.id>COALESCE((SELECT MAX(id) FROM events WHERE task_id=$1 AND type='WORKSPACE_VERIFICATION_INVALIDATED'),0)
      AND EXISTS (SELECT 1 FROM verification v WHERE v.task_id=t.task_id AND v.kind='tool_outcome' AND v.passed AND v.details->>'toolCallId'=t.id)
    ORDER BY e.id DESC`,[task.id]);
  return requirements.map(requirement=>{
    const latest=rows.find(item=>(item.arguments as Record<string,unknown>).path===requirement.path);
    let matched=false;
    try {const result=JSON.parse(String(latest?.result)) as Record<string,unknown>;matched=result.path===requirement.path&&result.sha256===requirement.expectedSha256;}catch{/* Malformed tool metadata is not proof. */}
    return {...requirement,passed:matched,toolCallId:matched?String(latest!.id):null};
  });
}

export async function recordRequiredReads(store:Store,task:TaskRecord):Promise<RequiredReadStatus[]> {
  const results=await requiredReadStatus(store.db,task);
  for(const result of results){
    const key=requiredReadKey(result);
    const previous=(await store.db.query('SELECT passed,details FROM verification WHERE task_id=$1 AND check_key=$2 ORDER BY sequence DESC LIMIT 1',[task.id,key]))[0];
    if(previous?.passed===result.passed&&(previous.details as Record<string,unknown>).toolCallId===result.toolCallId)continue;
    await store.verify(task.id,'required_file_read',result.passed?`Required file_read verified ${result.path} against its expected SHA-256.`:`Required verification is incomplete: file_read must observe ${result.path} with the expected SHA-256 after the latest workspace change.`,result.passed,{path:result.path,expectedSha256:result.expectedSha256,toolCallId:result.toolCallId,objectiveVerification:true},key);
  }
  return results;
}
