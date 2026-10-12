import type {Workspace} from '../../../shared/types';

export interface Note {id:string;workspaceId:string|null;title:string;content:string;enabled:boolean;revision:number;updatedAt:string}
export type NoteDraft=Pick<Note,'title'|'content'|'workspaceId'|'enabled'>;
export const blankDraft=():NoteDraft=>({title:'',content:'',workspaceId:null,enabled:true});
export const draftFrom=(note:Note):NoteDraft=>({title:note.title,content:note.content,workspaceId:note.workspaceId,enabled:note.enabled});
export const scopeName=(note:Pick<Note,'workspaceId'>,workspaces:Workspace[])=>note.workspaceId?workspaces.find(workspace=>workspace.id===note.workspaceId)?.name??'Workspace note':'Personal preference';
