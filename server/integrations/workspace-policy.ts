import {z} from 'zod';
import type {TaskOptions} from '../../shared/types.js';
import type {Sql} from '../db/database.js';
import {AppError} from '../core/errors.js';

export const workspaceTaskSchema=z.object({mail:z.boolean(),calendar:z.boolean()}).strict();
export const workspaceEnabled=(value:TaskOptions['googleWorkspace'])=>value?.mail===true||value?.calendar===true;
export function assertWorkspaceOptions(options:TaskOptions,restricted=workspaceEnabled(options.googleWorkspace)):void {
 if(options.googleWorkspace!==undefined)workspaceTaskSchema.parse(options.googleWorkspace);
 if(!restricted)return;
 if(options.cloudPolicy!=='local_only'||!options.budget.localOnly||options.modelId&&!/^(ollama|lmstudio)[/:]/.test(options.modelId))throw new AppError('WORKSPACE_LOCAL_ONLY','Google Workspace conversations require local-only models. Start a separate conversation for cloud use.',403);
 if(options.access!=='read_only'||options.network&&options.network.mode!=='deny'||options.mcpServerIds?.length)throw new AppError('WORKSPACE_READ_ONLY','Google Workspace conversations require read-only access, network disabled and no external MCP tools.',403);
}
/** Task identities/options survive retention and conversation soft deletion. */
export async function workspaceConversationRestricted(sql:Sql,conversationId:string):Promise<boolean>{
 return !!(await sql.query("SELECT id FROM tasks WHERE conversation_id=$1 AND (options->'googleWorkspace'->>'mail'='true' OR options->'googleWorkspace'->>'calendar'='true') LIMIT 1",[conversationId]))[0];
}
export async function assertWorkspaceConversation(sql:Sql,conversationId:string,options:TaskOptions):Promise<void>{
 assertWorkspaceOptions(options,workspaceEnabled(options.googleWorkspace)||await workspaceConversationRestricted(sql,conversationId));
}
