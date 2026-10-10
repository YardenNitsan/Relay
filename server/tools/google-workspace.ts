import type {ToolContext,ToolRequest,ToolResult} from '../../shared/types.js';
import {row,type Store} from '../db/store.js';
import type {User} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import type {GoogleWorkspace,WorkspaceActor} from '../integrations/google-workspace.js';
import {googleWorkspaceSchemas,isWorkspaceTool,workspaceToolScope} from './google-workspace-schema.js';

/** Captures revocation before waiting in the broker, with no browser-session impersonation. */
export function prepareWorkspaceRead(store:Store,service:GoogleWorkspace,context:ToolContext,request:ToolRequest,authorize:()=>Promise<void>):()=>Promise<ToolResult>{
 const current=service.captureReadAuthorization(context.userId??'');
 return async()=>{
  if(!isWorkspaceTool(request.name)||!context.userId||context.googleWorkspace?.[workspaceToolScope(request.name)]!==true)throw new AppError('WORKSPACE_CAPABILITY','This task did not opt in to this account read.',403);
  const args=googleWorkspaceSchemas[request.name].parse(request.arguments);
  const live=async()=>{current();await authorize();current();return true;};
  await live();const record=(await store.db.query('SELECT * FROM users WHERE id=$1',[context.userId]))[0];if(!record)throw new AppError('REVOKED','Task account was revoked.',403);
  const actor:WorkspaceActor={principal:{user:{...row<User>(record),sessionVersion:context.sessionVersion!},remote:true,sessionId:''},signal:context.signal,live};
  const result=request.name==='gmail_search'?await service.searchMail(actor,args):request.name==='gmail_read'?await service.readMail(actor,args):request.name==='calendar_events'?await service.listEvents(actor,args):await service.freeBusy(actor,args);
  await live();return {content:JSON.stringify(result),evidence:[{kind:'google_workspace_read',summary:`${request.name}: account-scoped read completed; returned content is untrusted data`,passed:true,details:{tool:request.name,readOnly:true,untrusted:true}}]};
 };
}
