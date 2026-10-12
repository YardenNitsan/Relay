import {z} from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const identity=z.object({dev:z.string().max(40),ino:z.string().max(40)}).strict();
export type PublicationFileIdentity=z.infer<typeof identity>;
const path=z.string().min(1).max(2048);
export const publicationSchema=z.object({
  version:z.union([z.literal(1),z.literal(2),z.literal(3)]),id:z.string().uuid(),sequence:z.number().int().positive(),workspaceId:z.string().uuid(),userId:z.string().max(160),sessionVersion:z.number().int().nonnegative(),stopGeneration:z.number().int().nonnegative(),
  sourcePath:z.string().max(2048),sourceIdentity:identity,direction:z.enum(['publish','rollback']),parentId:z.string().uuid().nullable(),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),digest:hash,
  status:z.enum(['preview','applying','completed','uncertain','rolled_back']),completed:z.array(z.string().max(2048)).max(20),error:z.string().max(500).nullable(),
  entries:z.array(z.object({path,before:z.string().max(1024*1024).nullable(),after:z.string().max(1024*1024).nullable(),beforeHash:hash.nullable(),afterHash:hash.nullable(),identity:identity.nullable(),parentIdentity:identity.nullable().optional()}).strict()).min(1).max(20),
  createdIdentities:z.record(path,identity).optional(),
  directories:z.array(z.object({path,parentIdentity:identity.nullable()}).strict()).min(1).max(32).optional(),
  createdDirectoryIdentities:z.record(path,identity).optional(),
}).strict().superRefine((record,context)=>{
  const invalid=(message:string)=>context.addIssue({code:'custom',message});
  if(new Set(record.entries.map(entry=>entry.path)).size!==record.entries.length)invalid('Duplicate publication paths');
  for(const entry of record.entries){
    if(entry.before===entry.after||(entry.before===null)!==(entry.beforeHash===null)||(entry.after===null)!==(entry.afterHash===null)||(entry.before===null)!==(entry.identity===null))invalid('Inconsistent publication file state');
    if(record.version===1&&(entry.before===null||entry.after===null||entry.parentIdentity!==undefined))invalid('Legacy publication requires existing files');
    if(record.version===2&&!entry.parentIdentity)invalid('Publication parent identity required');
  }
  if(record.version===1&&record.createdIdentities!==undefined)invalid('Legacy publication has no creation receipts');
  if(record.version>=2&&!record.createdIdentities)invalid('Publication creation receipts required');
  if(record.version<3&&(record.directories!==undefined||record.createdDirectoryIdentities!==undefined))invalid('Legacy publication has no directory plan');
  if(record.version===3){
    if(!record.directories?.length||!record.createdDirectoryIdentities||record.direction!=='publish')invalid('Directory publication requires a creation plan and receipts');
    const planned=new Set<string>();
    for(const directory of record.directories??[]){
      const parent=directory.path.includes('/')?directory.path.slice(0,directory.path.lastIndexOf('/')):'';
      if(planned.has(directory.path)||(directory.parentIdentity?planned.has(parent):!planned.has(parent)))invalid('Invalid directory order or parent identity');
      if(!record.entries.some(entry=>entry.path.startsWith(`${directory.path}/`)))invalid('Unreferenced publication directory');
      planned.add(directory.path);
    }
    for(const entry of record.entries){const parent=entry.path.includes('/')?entry.path.slice(0,entry.path.lastIndexOf('/')):'';if(entry.parentIdentity===undefined||(entry.parentIdentity?planned.has(parent):!planned.has(parent)||entry.before!==null))invalid('Missing file parent identity or directory plan');}
    for(const key of Object.keys(record.createdDirectoryIdentities??{}))if(!planned.has(key))invalid('Unexpected directory creation receipt');
  }
  for(const key of Object.keys(record.createdIdentities??{}))if(!record.entries.some(entry=>entry.path===key&&entry.before===null))invalid('Unexpected creation receipt');
});
export type Publication=z.infer<typeof publicationSchema>;
export type PublicationSummary=Pick<Publication,'id'|'workspaceId'|'direction'|'createdAt'|'status'|'completed'|'error'|'parentId'> & {files:number};
export const publicationConfirmationSchema=z.object({digest:hash,confirmed:z.literal(true)}).strict();
