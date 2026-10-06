import type { ToolRequest, ToolResult } from '../../shared/types.js';
import type { Store } from '../db/store.js';

/** A passing command describes the files it observed, not any later edits. */
export async function invalidateCommandChecks(store:Store,taskId:string,request:ToolRequest,result:ToolResult,invocationId:string):Promise<void> {
  const mutated=request.name==='file_write'||request.name==='file_delete'||request.name==='terminal'&&result.evidence.some(item=>item.kind==='file_content');
  if(!mutated)return;
  const task=await store.task(taskId);
  if(task.options.workspaceId)await invalidateWorkspaceCommandChecks(store,task.options.workspaceId,invocationId);
}

export async function invalidateWorkspaceCommandChecks(store:Store,workspaceId:string,invocationId:string):Promise<void> {
  const unfinished=await store.db.query("SELECT id FROM tasks WHERE options->>'workspaceId'=$1 AND status NOT IN ('completed','cancelled','failed')",[workspaceId]);
  for(const task of unfinished)await store.append(String(task.id),'WORKSPACE_VERIFICATION_INVALIDATED',{workspaceId,operationId:invocationId});
  const checks=await store.db.query(`SELECT * FROM (
    SELECT DISTINCT ON (v.task_id,v.check_key) v.task_id,v.check_key,v.passed,v.details FROM verification v
    JOIN tasks t ON t.id=v.task_id
    WHERE t.options->>'workspaceId'=$1 AND t.status NOT IN ('completed','cancelled','failed')
      AND v.check_key IS NOT NULL ORDER BY v.task_id,v.check_key,v.sequence DESC
  ) latest WHERE passed AND details->>'tool'='terminal'`,[workspaceId]);
  for(const check of checks) {
    const details=check.details as Record<string,unknown>;
    await store.verify(String(check.task_id),'command_stale',`Command check is stale after a workspace mutation; rerun ${JSON.stringify(details.argv??'the original command')}.`,false,{...details,invalidatedBy:invocationId},String(check.check_key));
  }
}
