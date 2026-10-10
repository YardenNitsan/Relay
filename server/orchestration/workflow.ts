import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentRole, TaskRecord, TaskStep } from '../../shared/types.js';
import { AppError } from '../core/errors.js';

const analysisRole = z.enum(['architect', 'security_reviewer', 'researcher']);
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const acceptance = z.array(z.string().trim().min(1).max(300)).min(1).max(6);
const reason = z.string().trim().min(1).max(1000);
export const workflowProposalSchema = z.object({
  version: z.literal(1),
  nodes: z.array(z.object({
    key, role: analysisRole,
    objective: z.string().trim().min(1).max(500),
    expectedOutput: z.string().trim().min(1).max(300),
    dependencies: z.array(key).max(3),
  }).strict()).max(3),
  acceptance, reason,
}).strict();
const legacyProposalSchema = z.object({ specialists: z.array(analysisRole).max(3), acceptance, reason }).strict();
export type WorkflowProposal = z.infer<typeof workflowProposalSchema>;
export interface CompiledWorkflow {
  steps: TaskStep[];
  stepInstructions: Record<string, { objective: string; expectedOutput: string }>;
  acceptance: string[];
  reason: string;
  format: 'dynamic' | 'legacy';
}

const legacyObjectives: Record<z.infer<typeof analysisRole>, string> = {
  architect: 'Analyze approach and dependencies',
  security_reviewer: 'Review security and boundaries',
  researcher: 'Examine an independent alternative',
};

function normalize(value: unknown): { proposal: WorkflowProposal; format: CompiledWorkflow['format'] } {
  const modern = workflowProposalSchema.safeParse(value);
  if (modern.success) return { proposal: modern.data, format: 'dynamic' };
  const legacy = legacyProposalSchema.safeParse(value);
  if (!legacy.success) throw new AppError('WORKFLOW_INVALID', 'Planner output does not match the bounded workflow schema.');
  if (new Set(legacy.data.specialists).size !== legacy.data.specialists.length) throw new AppError('WORKFLOW_INVALID', 'Duplicate specialist in the legacy plan.');
  return { format: 'legacy', proposal: {
    version: 1, acceptance: legacy.data.acceptance, reason: legacy.data.reason,
    nodes: legacy.data.specialists.map(role => ({ key: role, role, objective: legacyObjectives[role], expectedOutput: 'Concise attributable findings, evidence references and unresolved questions.', dependencies: [] })),
  } };
}

/** Compile proposals into host-owned steps. Never call this with stale call accounting. */
export function compileWorkflow(task: TaskRecord, existing: TaskStep[], value: unknown, options: { idFactory?: () => string } = {}): CompiledWorkflow {
  const { proposal, format } = normalize(value);
  if (Buffer.byteLength(JSON.stringify(proposal)) > 16000) throw new AppError('WORKFLOW_INVALID', 'Planner output exceeds the workflow size limit.');
  if (!['deep', 'maximum'].includes(task.options.depth)) throw new AppError('WORKFLOW_DEPTH', 'This depth does not permit specialist workflow planning.');
  if (proposal.nodes.length > (task.options.depth === 'maximum' ? 3 : 2) || task.options.depth !== 'maximum' && proposal.nodes.some(node => node.role === 'researcher')) throw new AppError('WORKFLOW_DEPTH', 'Specialist nodes exceed the selected depth.');
  if (existing.length > 32 || existing.some(step => step.taskId !== task.id)) throw new AppError('WORKFLOW_SCOPE', 'Existing steps must belong to this bounded task graph.');
  const planners = existing.filter(step => step.role === 'planner');
  if (planners.length !== 1 || planners[0].status !== 'completed' || planners[0].dependencies.length) throw new AppError('WORKFLOW_FROZEN', 'A single completed root planner is required before graph adaptation.');
  const planner = planners[0];
  if (existing.some(step => step.id !== planner.id && (step.status !== 'pending' || step.output !== null || step.modelId !== null))) throw new AppError('WORKFLOW_FROZEN', 'Started or completed work is frozen and cannot be replaced by a new proposal.');
  if (new Set(existing.map(step => step.id)).size !== existing.length) throw new AppError('WORKFLOW_INVALID', 'Duplicate existing graph identity.');
  const remaining = task.options.budget.maxCalls - task.callsUsed;
  if (!Number.isSafeInteger(task.callsUsed) || task.callsUsed < 1 || !Number.isSafeInteger(task.options.budget.maxCalls) || proposal.nodes.length + 2 > remaining) throw new AppError('WORKFLOW_BUDGET', 'The remaining model-call budget cannot execute this workflow and its final review.');

  const keys = new Set(proposal.nodes.map(node => node.key));
  if (keys.size !== proposal.nodes.length) throw new AppError('WORKFLOW_INVALID', 'Duplicate workflow node key.');
  for (const node of proposal.nodes) {
    if (new Set(node.dependencies).size !== node.dependencies.length) throw new AppError('WORKFLOW_INVALID', 'Duplicate workflow dependency.');
    if (node.dependencies.some(dependency => !keys.has(dependency))) throw new AppError('WORKFLOW_INVALID', 'Unknown workflow dependency.');
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (nodeKey: string): void => {
    if (visiting.has(nodeKey)) throw new AppError('WORKFLOW_INVALID', 'Cyclic workflow dependency.');
    if (visited.has(nodeKey)) return;
    visiting.add(nodeKey);
    for (const dependency of proposal.nodes.find(node => node.key === nodeKey)!.dependencies) visit(dependency);
    visiting.delete(nodeKey); visited.add(nodeKey);
  };
  for (const node of proposal.nodes) visit(node.key);

  const usedIds = new Set(existing.map(step => step.id));
  const idFactory = options.idFactory ?? randomUUID;
  const nextId = () => {
    const id = idFactory();
    if (typeof id !== 'string' || !id || id.length > 160 || usedIds.has(id)) throw new AppError('WORKFLOW_ID', 'Generated workflow identity is invalid or already used.');
    usedIds.add(id); return id;
  };
  const ids = new Map(proposal.nodes.map(node => [node.key, nextId()]));
  const create = (id: string, role: AgentRole, title: string, dependencies: string[]): TaskStep => ({ id, taskId: task.id, role, title, dependencies, status: 'pending', modelId: null, output: null });
  const analysis = proposal.nodes.map(node => create(ids.get(node.key)!, node.role, node.objective, node.dependencies.length ? node.dependencies.map(dependency => ids.get(dependency)!) : [planner.id]));
  // Joining all leaves reaches every node in an acyclic finite graph, without
  // redundant edges to ancestors already required by those leaves.
  const ancestors = new Set(proposal.nodes.flatMap(node => node.dependencies));
  const leaves = proposal.nodes.filter(node => !ancestors.has(node.key)).map(node => ids.get(node.key)!);
  const worker = create(nextId(), 'worker', 'Execute the accepted objective', leaves.length ? leaves : [planner.id]);
  const reviewer = create(nextId(), 'reviewer', 'Review result and recorded evidence', [worker.id]);
  return {
    steps: [{ ...planner, dependencies: [...planner.dependencies] }, ...analysis, worker, reviewer],
    stepInstructions: Object.fromEntries(proposal.nodes.map(node => [ids.get(node.key)!, { objective: node.objective, expectedOutput: node.expectedOutput }])),
    acceptance: [...proposal.acceptance], reason: proposal.reason, format,
  };
}
