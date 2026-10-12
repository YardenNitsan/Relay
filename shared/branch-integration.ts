export interface BranchReviewEntry {
  path:string;
  status:'ready'|'conflict'|'already_applied';
  kind:'create'|'edit'|'delete';
  baseHash:string|null;
  parentHash:string|null;
  childHash:string|null;
}
export interface BranchReview {
  childId:string;
  parentId:string;
  parentName:string;
  digest:string;
  entries:BranchReviewEntry[];
}
export interface BranchFileReview {path:string;base:string|null;parent:string|null;child:string|null}
export interface BranchIntegrationReceipt {
  id:string;
  workspaceId:string;
  createdAt:string;
  state:'prepared'|'committed'|'reverted';
  paths:string[];
  revertsCheckpointId?:string;
}
export interface BranchIntegrationDetail extends BranchIntegrationReceipt {
  entries:Array<{path:string;before:string|null;after:string|null}>;
}
