import { describe, expect, it } from 'vitest';
import type { TaskRecord, TaskStep } from '../shared/types.js';
import { compileWorkflow, workflowProposalSchema } from '../server/orchestration/workflow.js';
import { readySteps } from '../server/orchestration/lifecycle.js';

const task: TaskRecord = { id: 'task', conversationId: 'conversation', objective: 'Analyze parser and renderer changes, implement and verify.', status: 'executing',
  options: { depth: 'maximum', modelId: null, access: 'supervised', workspaceId: 'workspace', contextTokens: 8192, budget: { maxCalls: 12, maxSeconds: 120, maxIterations: 4, maxCostUsd: null, localOnly: true } },
  createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', result: null, error: null, callsUsed: 1, stopGeneration: 1 };
const planner: TaskStep = { id: 'plan', taskId: task.id, role: 'planner', title: 'Plan work', dependencies: [], status: 'completed', modelId: 'local/model', output: 'Original planner output remains recorded.' };
const pending: TaskStep = { id: 'old-worker', taskId: task.id, role: 'worker', title: 'Original worker', dependencies: ['plan'], status: 'pending', modelId: null, output: null };
const proposal = {
  version: 1 as const,
  nodes: [
    { key: 'parser', role: 'architect' as const, objective: 'Inspect parser contracts', expectedOutput: 'Attributable parser findings and likely edits', dependencies: [] as string[] },
    { key: 'renderer', role: 'architect' as const, objective: 'Inspect renderer contracts', expectedOutput: 'Attributable renderer findings and likely edits', dependencies: [] as string[] },
    { key: 'risk', role: 'security_reviewer' as const, objective: 'Assess parser and renderer boundaries', expectedOutput: 'Concrete boundary risks to check', dependencies: ['parser', 'renderer'] },
  ],
  acceptance: ['Parser and renderer tests pass after the edits.'], reason: 'Independent inspections inform one boundary review before implementation.',
};
const compile = (value: unknown = proposal, record: TaskRecord = task, graph: TaskStep[] = [planner, pending]) => {
  let next = 0;
  return compileWorkflow(record, graph, value, { idFactory: () => `step-${++next}` });
};

describe('bounded task-specific workflow compiler', () => {
  it('compiles independent and dependent analysis into a host-owned worker/reviewer graph', () => {
    const result = compile();
    expect(result.format).toBe('dynamic');
    expect(result.steps[0]).toEqual(planner);
    expect(result.steps.map(step => step.role)).toEqual(['planner', 'architect', 'architect', 'security_reviewer', 'worker', 'reviewer']);
    expect(result.steps[1].dependencies).toEqual(['plan']);
    expect(result.steps[2].dependencies).toEqual(['plan']);
    expect(result.steps[3].dependencies).toEqual(['step-1', 'step-2']);
    expect(result.steps[4].dependencies).toEqual(['step-3']);
    expect(result.steps[5].dependencies).toEqual(['step-4']);
    expect(result.stepInstructions['step-3']).toEqual({ objective: proposal.nodes[2].objective, expectedOutput: proposal.nodes[2].expectedOutput });
    expect(result.acceptance).toEqual(proposal.acceptance);
    expect(result.steps.filter(step => step.role === 'worker')).toHaveLength(1);
    expect(result.steps.slice(1).every(step => step.status === 'pending' && step.taskId === task.id && step.modelId === null && step.output === null)).toBe(true);
    expect(pending.dependencies).toEqual(['plan']);
  });

  it('supports legacy specialist proposals and zero-specialist plans without extra analysis calls', () => {
    const legacy = compile({ specialists: ['architect'], acceptance: ['Run the existing parser tests'], reason: 'One inspection is sufficient.' });
    expect(legacy.format).toBe('legacy');
    expect(legacy.steps.map(step => step.role)).toEqual(['planner', 'architect', 'worker', 'reviewer']);
    const direct = compile({ ...proposal, nodes: [] });
    expect(direct.steps.map(step => step.role)).toEqual(['planner', 'worker', 'reviewer']);
    expect(direct.steps[1].dependencies).toEqual(['plan']);
    expect(() => compile({ specialists: ['architect', 'architect'], acceptance: ['Test'], reason: 'Repeat' })).toThrow(/duplicate/i);
  });

  it('allows acyclic forward references and exposes only dependency-ready analysis to the scheduler', () => {
    const result = compile({ ...proposal, nodes: [proposal.nodes[2], proposal.nodes[0], proposal.nodes[1]] });
    expect(readySteps(result.steps).map(step => step.title)).toEqual(['Inspect parser contracts', 'Inspect renderer contracts']);
    const completed = result.steps.map(step => step.role === 'architect' ? { ...step, status: 'completed' as const } : step);
    expect(readySteps(completed).map(step => step.title)).toEqual(['Assess parser and renderer boundaries']);
  });

  it('rejects unknown, duplicate, self and cyclic dependencies, including forward cycles', () => {
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], dependencies: ['missing'] }] })).toThrow(/dependency/i);
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], dependencies: ['parser'] }] })).toThrow(/cycl|self/i);
    expect(() => compile({ ...proposal, nodes: [proposal.nodes[0], { ...proposal.nodes[1], key: 'parser' }] })).toThrow(/duplicate/i);
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], dependencies: ['renderer'] }, { ...proposal.nodes[1], dependencies: ['parser'] }] })).toThrow(/cycl/i);
    expect(() => compile({ ...proposal, nodes: [proposal.nodes[0], { ...proposal.nodes[1], dependencies: ['parser', 'parser'] }] })).toThrow(/duplicate/i);
  });

  it('enforces role/depth/node boundaries and rejects hidden grants or executable fields', () => {
    for (const role of ['worker', 'reviewer', 'coder', 'supervisor']) expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], role }] })).toThrow();
    expect(() => workflowProposalSchema.parse({ ...proposal, permissions: ['unrestricted'] })).toThrow();
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], tools: ['terminal'] }] })).toThrow();
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], command: 'arbitrary host command' }] })).toThrow();
    expect(() => compile({ ...proposal, nodes: [...proposal.nodes, { ...proposal.nodes[0], key: 'fourth' }] })).toThrow();
    expect(() => compile(proposal, { ...task, options: { ...task.options, depth: 'deep' } })).toThrow(/depth/i);
    expect(() => compile({ ...proposal, nodes: [{ ...proposal.nodes[0], role: 'researcher' }] }, { ...task, options: { ...task.options, depth: 'deep' } })).toThrow(/depth/i);
    expect(() => compile({ ...proposal, nodes: [] }, { ...task, options: { ...task.options, depth: 'fast' } })).toThrow(/depth/i);
  });

  it('uses remaining calls and refuses to rewrite already-started, completed or foreign work', () => {
    expect(() => compile(proposal, { ...task, callsUsed: 8 })).toThrow(/budget/i);
    expect(compile(proposal, { ...task, callsUsed: 7 }).steps).toHaveLength(6);
    expect(() => compile(proposal, task, [{ ...planner, status: 'running' }, pending])).toThrow(/planner/i);
    for (const status of ['running', 'completed', 'failed', 'cancelled'] as const) expect(() => compile(proposal, task, [planner, { ...pending, status }])).toThrow(/frozen/i);
    expect(() => compile(proposal, task, [planner, { ...pending, taskId: 'foreign' }])).toThrow(/task/i);
    expect(() => compile(proposal, task, [planner, { ...planner, id: 'planner-2' }])).toThrow(/planner/i);
    expect(() => compileWorkflow(task, [planner, pending], proposal, { idFactory: () => 'plan' })).toThrow(/identity/i);
  });
});
