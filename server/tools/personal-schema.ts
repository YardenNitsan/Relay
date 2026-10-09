import { z } from 'zod';
const titleSchema = z.string().trim().min(1).max(500).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'Task titles must be plain single-line text');
export const personalOperations = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list'), completed: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(), cursor: z.uuid().optional() }).strict(),
  z.object({ action: z.literal('create'), title: titleSchema, dueAt: z.iso.datetime({ offset: false }).nullable().optional() }).strict(),
  z.object({ action: z.literal('complete'), id: z.uuid() }).strict(),
  z.object({ action: z.literal('delete'), id: z.uuid() }).strict(),
]);
// Provider tools require an object at the schema root. The union still strictly
// validates action-specific fields on the host; refinements never grant access.
export const personalTaskSchema = z.object({
  action: z.enum(['list', 'create', 'complete', 'delete']),
  title: titleSchema.optional(), dueAt: z.iso.datetime({ offset: false }).nullable().optional(),
  id: z.uuid().optional(), completed: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(), cursor: z.uuid().optional(),
}).strict().superRefine((value, context) => {
  const parsed = personalOperations.safeParse(value);
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
});
export type PersonalRequest = z.infer<typeof personalOperations>;
