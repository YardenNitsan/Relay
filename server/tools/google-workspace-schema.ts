import {z} from 'zod';
const window={timeMin:z.iso.datetime({offset:true}),timeMax:z.iso.datetime({offset:true})};
export const googleWorkspaceSchemas={
 gmail_search:z.object({query:z.string().max(1000),maxResults:z.number().int().min(1).max(20).optional(),pageToken:z.string().max(2048).optional()}).strict(),
 gmail_read:z.object({id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)}).strict(),
 calendar_events:z.object({...window,maxResults:z.number().int().min(1).max(50).optional(),pageToken:z.string().max(2048).optional()}).strict(),
 calendar_freebusy:z.object(window).strict(),
};
export type WorkspaceTool=keyof typeof googleWorkspaceSchemas;
export const isWorkspaceTool=(name:string):name is WorkspaceTool=>Object.hasOwn(googleWorkspaceSchemas,name);
export const workspaceToolScope=(name:WorkspaceTool)=>name.startsWith('gmail_')?'mail':'calendar';
