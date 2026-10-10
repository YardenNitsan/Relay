import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { TaskRecord, TaskStep, Verification } from '../shared/types.js';
import { buildHandoff, handoffMessage, handoffSchema } from '../server/orchestration/handoff.js';

const task: TaskRecord = { id: 'task-a', conversationId: 'conversation-a', objective: 'Fix the parser and verify its behavior.', status: 'executing',
  options: { depth: 'deep', modelId: null, access: 'supervised', workspaceId: 'workspace-a', contextTokens: 8192, budget: { maxCalls: 12, maxSeconds: 120, maxIterations: 4, maxCostUsd: null, localOnly: true } },
  createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', result: null, error: null, callsUsed: 1, stopGeneration: 9 };
const steps: TaskStep[] = [
  { id: 'architect', taskId: task.id, role: 'architect', title: 'Inspect the parser', dependencies: [], status: 'completed', modelId: 'local/a', output: 'The parser might mishandle empty input. Run its tests.' },
  { id: 'worker', taskId: task.id, role: 'worker', title: 'Implement and test', dependencies: ['architect'], status: 'running', modelId: 'local/b', output: null },
  { id: 'reviewer', taskId: task.id, role: 'reviewer', title: 'Review evidence', dependencies: ['worker'], status: 'pending', modelId: null, output: null },
];
const check = (id: string, passed: boolean, extra: Partial<Verification> = {}): Verification & { checkKey: string } => ({ id, taskId: task.id, kind: 'command_exit', summary: passed ? 'Tests passed' : 'Tests failed', passed, details: {}, createdAt: task.createdAt, checkKey: 'parser-tests', ...extra });

describe('attributable agent handoffs', () => {
  it('preserves task/recovery identity, graph, dependencies and untrusted collaborator provenance', () => {
    const handoff = buildHandoff({ task, currentStepId: 'worker', steps });
    expect(handoffSchema.parse(handoff)).toEqual(handoff);
    expect(handoff.task).toMatchObject({ id: task.id, conversationId: task.conversationId, workspaceId: 'workspace-a', stopGeneration: 9 });
    expect(handoff.originalObjective).toEqual({ text: task.objective, sha256: createHash('sha256').update(task.objective).digest('hex'), truncated: false });
    expect(handoff.approvedPlan.source).toBe('orchestrator_graph');
    expect(handoff.currentStepId).toBe('worker');
    expect(handoff.dependencies).toEqual(['architect']);
    expect(handoff.completedSteps).toEqual(['architect']);
    expect(handoff.remainingSteps).toEqual(['worker', 'reviewer']);
    expect(handoff.untrustedFindings[0]).toMatchObject({ stepId: 'architect', role: 'architect', modelId: 'local/a', text: steps[0].output });
    expect(handoff.verifiedFindings).toEqual([]);
    expect(handoffMessage(handoff)).toMatchObject({ role: 'user', content: expect.stringContaining('untrusted data') });
  });

  it('keeps latest keyed failures and never promotes model review or generation into objective proof', () => {
    const handoff = buildHandoff({ task, currentStepId: 'worker', steps, checks: [
      check('old-pass', true), check('latest-fail', false),
      { ...check('review', true, { kind: 'model_review', summary: 'All good', details: { objectiveVerification: true } }), checkKey: null },
      { ...check('response', true, { kind: 'response' }), checkKey: null },
      { ...check('subjective', true, { details: { objectiveVerification: false } }), checkKey: null },
    ] });
    expect(handoff.verifiedFindings).toEqual([]);
    expect(handoff.failedChecks.map(item => item.id)).toEqual(['latest-fail']);
    expect(handoff.modelAssessments.map(item => item.id)).toEqual(['review', 'response', 'subjective']);
    expect(handoff.omitted.supersededChecks).toBe(1);
  });

  it('attributes receipts and artifacts without carrying tool arguments, output or host paths', () => {
    const receipts = [
      { id: 'write', taskId: task.id, agentId: 'agent-a', stepId: 'architect', name: 'file_write', status: 'completed' as const, result: 'SECRET OUTPUT', arguments: { key: 'SECRET KEY' } },
      { id: 'pending', taskId: task.id, agentId: 'agent-b', stepId: 'worker', name: 'http_get', status: 'uncertain' as const },
    ];
    const artifacts = [{ id: 'artifact-a', taskId: task.id, name: 'patch.diff', mime: 'text/plain', path: '/private/host/location' }];
    const handoff = buildHandoff({ task, currentStepId: 'worker', steps, receipts, artifacts });
    expect(handoff.receipts).toHaveLength(2);
    expect(handoff.receipts.find(item => item.id === 'pending')?.status).toBe('uncertain');
    expect(handoff.artifacts[0]).toEqual({ id: 'artifact-a', name: 'patch.diff', mime: 'text/plain' });
    expect(JSON.stringify(handoff)).not.toMatch(/SECRET|private\/host|arguments|result/);
    expect(handoff.recovery).toContain('Never replay');
  });

  it('rejects foreign records and malformed or dangling graph references', () => {
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps: steps.map((item, index) => index ? item : { ...item, taskId: 'foreign' }) })).toThrow(/task/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps, checks: [check('foreign', true, { taskId: 'other' })] })).toThrow(/task/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps, receipts: [{ id: 'r', taskId: 'other', agentId: 'a', name: 'file_read', status: 'completed' }] })).toThrow(/task/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps, artifacts: [{ id: 'a', taskId: 'other', name: 'a', mime: 'text/plain' }] })).toThrow(/task/i);
    expect(() => buildHandoff({ task, currentStepId: 'missing', steps })).toThrow(/step/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps: [...steps, steps[0]] })).toThrow(/duplicate/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps: steps.map(item => item.id === 'worker' ? { ...item, dependencies: ['foreign'] } : item) })).toThrow(/depend/i);
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps: steps.map(item => item.id === 'architect' ? { ...item, dependencies: ['worker'] } : item) })).toThrow(/cycl/i);
  });

  it('bounds serialized UTF-8 JSON including escaping, reports omissions and retains failure/uncertainty', () => {
    const long = 'שלום\\\"\n'.repeat(3000);
    const handoff = buildHandoff({ task: { ...task, objective: long }, currentStepId: 'worker', steps: steps.map(item => ({ ...item, output: long })),
      checks: [check('failed', false), ...Array.from({ length: 30 }, (_, n) => ({ ...check(`pass-${n}`, true, { summary: long }), checkKey: null }))],
      receipts: [{ id: 'uncertain', taskId: task.id, agentId: 'a', name: 'file_write', status: 'uncertain' }],
    }, { maxBytes: 4096 });
    expect(Buffer.byteLength(JSON.stringify(handoff))).toBeLessThanOrEqual(4096);
    expect(handoff.originalObjective.truncated).toBe(true);
    expect(handoff.originalObjective.sha256).toBe(createHash('sha256').update(long).digest('hex'));
    expect(handoff.failedChecks[0].id).toBe('failed');
    expect(handoff.receipts[0].id).toBe('uncertain');
    expect(handoff.omitted.verifiedFindings).toBeGreaterThan(0);
    expect(handoff.remainingSteps).toEqual(['worker', 'reviewer']);
  });

  it('fails closed when essential failure records cannot fit and rejects permission-shaped payloads', () => {
    const checks = Array.from({ length: 100 }, (_, n) => ({ ...check(`failure-${n}`, false), checkKey: null }));
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps, checks }, { maxBytes: 2048 })).toThrow(/budget/i);
    const handoff = buildHandoff({ task, currentStepId: 'worker', steps });
    expect(() => handoffSchema.parse({ ...handoff, grants: ['unrestricted'] })).toThrow();
    expect(() => handoffSchema.parse({ ...handoff, currentStepId: 'foreign' })).toThrow();
    expect(() => buildHandoff({ task, currentStepId: 'worker', steps }, { maxBytes: 0 })).toThrow();
  });
});
