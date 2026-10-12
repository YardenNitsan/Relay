import type {Workspace} from '../../shared/types';
import type {BranchReview,BranchReviewEntry,BranchIntegrationReceipt} from '../../shared/branch-integration';
import {AppError} from '../core/errors';
import {hashOrNull,sha256,snapshot,type Guard} from './files';
import {readGitBaseline} from './git-baseline';
import {ToolStore,type Checkpoint} from './store';

export function assertBranchParent(child:Workspace,parent:Workspace){
  if(!child.git||child.git.parentWorkspaceId!==parent.id||child.id===parent.id)throw new AppError('BRANCH_PARENT','Integrate only into this branch\'s recorded parent workspace',409);
  if((child.ownerUserId??null)!==(parent.ownerUserId??null))throw new AppError('BRANCH_OWNER','Branch and parent ownership differs',409);
}
export function integrationReceipt(checkpoint:Checkpoint):BranchIntegrationReceipt {
  return {id:checkpoint.id,workspaceId:checkpoint.workspaceId,createdAt:checkpoint.createdAt,state:checkpoint.state,paths:checkpoint.entries.map(entry=>entry.path),...(checkpoint.revertsCheckpointId?{revertsCheckpointId:checkpoint.revertsCheckpointId}:{})};
}
const manifest=(files:Map<string,string>)=>[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,value])=>[path,sha256(value)]);

/** No Git command is executed against source or worktree configuration. */
export async function prepareBranchReview(store:ToolStore,child:Workspace,parent:Workspace,guard:Guard){
  assertBranchParent(child,parent);
  const childFiles=await snapshot(await store.workspaceRoot(child.id),true);guard();
  const parentFiles=await snapshot(await store.workspaceRoot(parent.id),true);guard();
  const baseline=await readGitBaseline(store,child.id,childFiles,guard,true);guard();
  const entries:BranchReviewEntry[]=[];
  for(const path of [...new Set([...baseline.files.keys(),...childFiles.keys()])].sort()){
    const base=baseline.files.get(path)??null,next=childFiles.get(path)??null,current=parentFiles.get(path)??null;
    if(base===next)continue;
    const collision=next!==null&&[...parentFiles.keys()].some(other=>other!==path&&(other.startsWith(`${path}/`)||path.startsWith(`${other}/`)));
    const status=current===next?'already_applied':current===base&&!collision?'ready':'conflict';
    entries.push({path,status,kind:next===null?'delete':base===null?'create':'edit',baseHash:hashOrNull(base),parentHash:hashOrNull(current),childHash:hashOrNull(next)});
  }
  const digest=sha256(JSON.stringify({childId:child.id,parentId:parent.id,git:child.git,baseline:manifest(baseline.files),parent:manifest(parentFiles),child:manifest(childFiles)}));
  const review:BranchReview={childId:child.id,parentId:parent.id,parentName:parent.name,digest,entries};
  return {review,childFiles,parentFiles,baseFiles:baseline.files};
}
export function assertBranchDigest(actual:string,expected:string){
  if(actual!==expected)throw new AppError('BRANCH_STALE','Workspace files changed since review. Refresh and review the new changes.',409);
}
