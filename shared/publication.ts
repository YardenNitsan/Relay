import {z} from 'zod';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const identity=z.object({dev:z.string().max(40),ino:z.string().max(40)}).strict();
export const publicationSchema=z.object({
  version:z.literal(1),id:z.string().uuid(),sequence:z.number().int().positive(),workspaceId:z.string().uuid(),userId:z.string().max(160),sessionVersion:z.number().int().nonnegative(),stopGeneration:z.number().int().nonnegative(),
  sourcePath:z.string().max(2048),sourceIdentity:identity,direction:z.enum(['publish','rollback']),parentId:z.string().uuid().nullable(),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),digest:hash,
  status:z.enum(['preview','applying','completed','uncertain','rolled_back']),completed:z.array(z.string().max(2048)).max(20),error:z.string().max(500).nullable(),
  entries:z.array(z.object({path:z.string().max(2048),before:z.string().max(1024*1024),after:z.string().max(1024*1024),beforeHash:hash,afterHash:hash,identity}).strict()).min(1).max(20),
}).strict();
export type Publication=z.infer<typeof publicationSchema>;
export type PublicationSummary=Pick<Publication,'id'|'workspaceId'|'direction'|'createdAt'|'status'|'completed'|'error'|'parentId'> & {files:number};
export const publicationConfirmationSchema=z.object({digest:hash,confirmed:z.literal(true)}).strict();
