import { z } from 'zod';
import type { AccessMode, ProviderId, TaskOptions } from '../../shared/types.js';
import { AppError } from '../core/errors.js';
import { verificationContractSchema } from '../orchestration/required-reads.js';

export const permissionSchema=z.object({
  providers:z.array(z.enum(['ollama','lmstudio','openai','anthropic','gemini'])).max(5),
  workspaceIds:z.array(z.string().uuid()).max(32), maxAccess:z.enum(['read_only','supervised','workspace']),
  maxConcurrentTasks:z.number().int().min(1).max(4), maxCallsPerTask:z.number().int().min(1).max(64),
  maxSecondsPerTask:z.number().int().min(30).max(3600), dailyCloudBudgetUsd:z.number().min(0).max(100),
});
export type UserPermissions=z.infer<typeof permissionSchema>;
export interface User { id:string;name:string;email:string|null;role:'owner'|'trusted'|'chat';enabled:boolean;permissions:UserPermissions;sessionVersion:number;createdAt:string;lastActiveAt:string|null; }
export interface Principal { user:User;remote:boolean;sessionId:string; }
export const chatPermissions:UserPermissions={providers:['ollama','lmstudio'],workspaceIds:[],maxAccess:'read_only',maxConcurrentTasks:1,maxCallsPerTask:8,maxSecondsPerTask:300,dailyCloudBudgetUsd:0};
export function authorizeOwner(principal:Principal) {
  if(principal.user.role!=='owner'||principal.remote) throw new AppError('OWNER_ONLY','This setting is available to the local owner only.',403);
}
export function authorizeWorkspace(principal:Principal,id:string):void {
  if(principal.user.role==='owner'&&!principal.remote) return;
  if(!principal.user.permissions.workspaceIds.includes(id)) throw new AppError('WORKSPACE_DENIED','This workspace is not granted to your account.',403);
}
export function authorizeOptions(principal:Principal,options:TaskOptions):TaskOptions {
  const permissions=principal.user.permissions;
  if(options.verification){
    options={...options,verification:verificationContractSchema.parse(options.verification)};
    if(!options.workspaceId)throw new AppError('VERIFICATION_WORKSPACE','Required file verification needs an authorized workspace.',403);
  }
  const access:AccessMode[]=['read_only','supervised','workspace','unrestricted'];
  if(options.access==='unrestricted') throw new AppError('UNAVAILABLE','Unrestricted host execution is not available. A tested OS broker is required.',403);
  if(access.indexOf(options.access)>access.indexOf(permissions.maxAccess)) throw new AppError('ACCESS_DENIED','The selected computer access exceeds your account policy.',403);
  if(options.workspaceId) authorizeWorkspace(principal,options.workspaceId);
  if(options.budget.maxCalls>permissions.maxCallsPerTask||options.budget.maxSeconds>permissions.maxSecondsPerTask) throw new AppError('BUDGET_DENIED','Task budget exceeds the limits granted to your account.',403);
  if(options.modelId) {
    const provider=options.modelId.split(/[/:]/)[0] as ProviderId;
    if(!permissions.providers.includes(provider)) throw new AppError('PROVIDER_DENIED','This model provider is not granted to your account.',403);
  }
  if(principal.user.role!=='owner'&&options.cloudPolicy!=='local_only'&&!options.budget.localOnly) {
    if(!permissions.dailyCloudBudgetUsd) throw new AppError('CLOUD_DENIED','Cloud spending is not enabled for your account.',403);
    options={...options,budget:{...options.budget,maxCostUsd:Math.min(options.budget.maxCostUsd??permissions.dailyCloudBudgetUsd,permissions.dailyCloudBudgetUsd)}};
  }
  return options;
}
