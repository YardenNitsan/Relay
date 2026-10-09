import { z } from 'zod';
import type { AccessMode, ProviderId, TaskOptions, Workspace } from '../../shared/types.js';
import { AppError } from '../core/errors.js';
import { verificationContractSchema } from '../orchestration/required-reads.js';
import { networkOriginSchema, networkPolicySchema } from '../tools/network-policy.js';

export const permissionSchema=z.object({
  providers:z.array(z.enum(['ollama','lmstudio','openai','anthropic','gemini','xai','deepseek'])).max(7),
  workspaceIds:z.array(z.string().uuid()).max(32), maxAccess:z.enum(['read_only','supervised','workspace']),
  maxConcurrentTasks:z.number().int().min(1).max(4), maxCallsPerTask:z.number().int().min(1).max(64),
  maxSecondsPerTask:z.number().int().min(30).max(3600), dailyCloudBudgetUsd:z.number().min(0).max(100),
  allowUnpricedCloud:z.boolean().optional(),
  externalModelAccess:z.boolean().optional(),
  networkOrigins:z.array(networkOriginSchema).max(16).optional(),maxNetworkAccess:z.enum(['deny','ask','allow']).optional(),
  mcpServerIds:z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)).max(16).optional(),
});
export type UserPermissions=z.infer<typeof permissionSchema>;
export interface User { id:string;name:string;email:string|null;role:'owner'|'trusted'|'chat';enabled:boolean;permissions:UserPermissions;sessionVersion:number;createdAt:string;lastActiveAt:string|null;registrationStatus?:'pending'|'approved'|'denied';accessRequestedAt?:string|null; }
export interface Principal { user:User;remote:boolean;sessionId:string; }
export const chatPermissions:UserPermissions={providers:['ollama','lmstudio'],workspaceIds:[],maxAccess:'read_only',maxConcurrentTasks:1,maxCallsPerTask:8,maxSecondsPerTask:300,dailyCloudBudgetUsd:0};
export function authorizeOwner(principal:Principal) {
  if(principal.user.role!=='owner'||principal.remote) throw new AppError('OWNER_ONLY','This setting is available to the local owner only.',403);
}
export function authorizeWorkspace(principal:Principal,id:string,workspace?:Pick<Workspace,'id'|'ownerUserId'>):void {
  if(!principal.user.enabled||principal.user.registrationStatus!==undefined&&principal.user.registrationStatus!=='approved')throw new AppError('USER_DISABLED','This account is disabled',403);
  if(principal.user.role==='owner'&&!principal.remote) return;
  if(workspace?.id===id&&workspace.ownerUserId){
    if(workspace.ownerUserId===principal.user.id)return;
    throw new AppError('WORKSPACE_DENIED','This private workspace belongs to another account.',403);
  }
  if(!principal.user.permissions.workspaceIds.includes(id)) throw new AppError('WORKSPACE_DENIED','This workspace is not granted to your account.',403);
}
export function authorizeOptions(principal:Principal,options:TaskOptions,workspace?:Pick<Workspace,'id'|'ownerUserId'>):TaskOptions {
  if(!principal.user.enabled||principal.user.registrationStatus!==undefined&&principal.user.registrationStatus!=='approved')throw new AppError('USER_DISABLED','This account is disabled',403);
  if(options.efficiency!==undefined&&!['efficient','standard'].includes(options.efficiency))throw new AppError('TOKEN_POLICY','Unknown token efficiency policy.');
  if(options.budget.maxOutputTokens!==undefined&&(!Number.isInteger(options.budget.maxOutputTokens)||options.budget.maxOutputTokens<256||options.budget.maxOutputTokens>8192))throw new AppError('OUTPUT_BUDGET','Maximum output tokens must be an integer from 256 to 8192.');
  const permissions=principal.user.permissions;
  const personal=!!options.workspaceId&&workspace?.id===options.workspaceId&&workspace.ownerUserId===principal.user.id;
  if(options.mcpServerIds)options={...options,mcpServerIds:permissionSchema.shape.mcpServerIds.parse(options.mcpServerIds)};
  if(options.mcpServerIds?.length&&(principal.remote||principal.user.role!=='owner')&&options.mcpServerIds.some(id=>!permissions.mcpServerIds?.includes(id)))throw new AppError('MCP_DENIED','External tool server access exceeds your account grants.',403);
  if(options.network){
    options={...options,network:networkPolicySchema.parse(options.network)};
    const levels=['deny','ask','allow'];
    if((principal.remote||principal.user.role!=='owner')&&(levels.indexOf(options.network!.mode)>levels.indexOf(permissions.maxNetworkAccess??'deny')||options.network!.allowedOrigins.some(origin=>!permissions.networkOrigins?.includes(origin))))throw new AppError('NETWORK_DENIED','Network access exceeds the origins or approval policy granted to your account.',403);
  }
  if(options.verification){
    options={...options,verification:verificationContractSchema.parse(options.verification)};
    if(!options.workspaceId)throw new AppError('VERIFICATION_WORKSPACE','Required file verification needs an authorized workspace.',403);
  }
  const access:AccessMode[]=['read_only','supervised','workspace','unrestricted'];
  if(options.access==='unrestricted') {
    authorizeOwner(principal);
    if(options.hostAccessConfirmed!==true)throw new AppError('HOST_CONFIRMATION_REQUIRED','Confirm direct host file access before starting this task.',403);
  } else if(!personal&&access.indexOf(options.access)>access.indexOf(permissions.maxAccess)) throw new AppError('ACCESS_DENIED','The selected computer access exceeds your account policy.',403);
  if(options.workspaceId) authorizeWorkspace(principal,options.workspaceId,workspace);
  if(options.budget.maxCalls>permissions.maxCallsPerTask||options.budget.maxSeconds>permissions.maxSecondsPerTask) throw new AppError('BUDGET_DENIED','Task budget exceeds the limits granted to your account.',403);
  if(options.modelId) {
    const provider=options.modelId.split(/[/:]/)[0] as ProviderId;
    if(!permissions.providers.includes(provider)) throw new AppError('PROVIDER_DENIED','This model provider is not granted to your account.',403);
  }
  if(principal.user.role!=='owner'&&options.cloudPolicy!=='local_only'&&!options.budget.localOnly) {
    // This explicit owner grant applies only to the user's personal API account.
    // A supplied strict task cap always retains fail-closed pricing enforcement.
    if(permissions.allowUnpricedCloud&&options.budget.maxCostUsd===null)return options;
    if(!permissions.dailyCloudBudgetUsd) throw new AppError('CLOUD_DENIED','Cloud spending is not enabled for your account.',403);
    options={...options,budget:{...options.budget,maxCostUsd:Math.min(options.budget.maxCostUsd??permissions.dailyCloudBudgetUsd,permissions.dailyCloudBudgetUsd)}};
  }
  return options;
}
