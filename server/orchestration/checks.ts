import { createHash } from 'node:crypto';
import type { ToolRequest } from '../../shared/types.js';

function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}

// A repaired attempt resolves only the same deterministic check. Changes to a
// command's argv remain distinct; changing write content still repairs that file.
export function actionCheckKey(workspaceId:string|null,request:ToolRequest):string {
  const args=request.arguments;
  const identity=request.name==='terminal'?{argv:args.argv}:/^file_(read|write|delete)$/.test(request.name)?{path:args.path}:args;
  return createHash('sha256').update(JSON.stringify(canonical([workspaceId,request.name,identity]))).digest('hex');
}
