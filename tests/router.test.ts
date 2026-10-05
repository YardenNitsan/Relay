import { describe, expect, it } from 'vitest';
import { selectModel, type Admit } from '../server/orchestration/router.js';
import { chatPermissions, type User } from '../server/auth/policy.js';
import type { Admission, ModelProfile, ProviderGateway, TaskRecord } from '../shared/types.js';

const user: User = { id: 'owner', name: 'Owner', email: null, role: 'owner', enabled: true, permissions: { ...chatPermissions, providers: ['ollama', 'openai'] }, sessionVersion: 0, createdAt: '', lastActiveAt: null };
const task = (modelId: string | null = null): TaskRecord => ({ id: 'task', conversationId: 'conversation', objective: 'Review security', status: 'executing', options: { depth: 'deep', modelId, access: 'read_only', workspaceId: 'workspace', contextTokens: 8192, cloudPolicy: 'local_only', budget: { maxCalls: 8, maxSeconds: 300, maxIterations: 4, maxCostUsd: 0, localOnly: true } }, createdAt: '', updatedAt: '', result: null, error: null, callsUsed: 0, stopGeneration: 0 });
const profile = (name: string, overrides: Partial<ModelProfile> = {}): ModelProfile => ({ id: `ollama/${name}`, name, provider: 'ollama', runtime: 'ollama', local: true, capabilities: { tools: true, reasoning: false, vision: false, structured: true }, contextWindow: 32768, quantization: 'Q4_K_M', sizeBytes: 2_000_000_000, state: 'available', details: {}, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null, ...overrides });
const allowed: Admission = { allowed: true, decision: 'run', reasons: ['Fits current resources'], contextTokens: 8192, estimatedRamBytes: 3_000_000_000, estimatedVramBytes: 3_000_000_000, confidence: 'estimated' };
const admit: Admit = async () => allowed;
const gateway = (models: ModelProfile[]): ProviderGateway => ({ listModels: async () => models, statuses: async () => [], stream: async function* () { throw new Error('Routing must not generate'); } });
const thinking = (): ModelProfile => profile('thinking', { state: 'ready', tokensPerSecond: 100, details: { modelInfo: { 'general.finetune': 'Thinking' } } });

describe('model diversity preserves suitability', () => {
  it('does not bypass the mandatory-thinking penalty for security review', async () => {
    const instruct = profile('instruct');
    expect((await selectModel(gateway([instruct, thinking()]), task(), user, 'security_reviewer', admit, new Set())).model.id).toBe(instruct.id);
  });
  it('does not introduce mandatory thinking for diversity even when other score bonuses narrow the gap', async () => {
    const cloud = profile('instruct', { id: 'openai/instruct', provider: 'openai', runtime: 'openai', local: false, tokensPerSecond: 20 });
    const objective = task(); objective.options.cloudPolicy = 'allow'; objective.options.budget.localOnly = false;
    expect((await selectModel(gateway([cloud, thinking()]), objective, user, 'security_reviewer', admit, new Set())).model.id).toBe(cloud.id);
  });
  it('alternates among comparable eligible models only for independent security analysis', async () => {
    const first = profile('first', { tokensPerSecond: 20 }); const second = profile('second', { tokensPerSecond: 16 });
    const models = gateway([second, first]);
    expect((await selectModel(models, task(), user, 'worker', admit, new Set())).model.id).toBe(first.id);
    const reviewed = await selectModel(models, task(), user, 'security_reviewer', admit, new Set());
    expect(reviewed.model.id).toBe(second.id);
    expect(reviewed.reasons.join(' ')).toMatch(/independent security review/i);
  });
  it('does not substitute a substantially lower ranked model solely for diversity', async () => {
    const first = profile('first', { tokensPerSecond: 20 }); const second = profile('second');
    expect((await selectModel(gateway([first, second]), task(), user, 'security_reviewer', admit, new Set())).model.id).toBe(first.id);
  });
  it('preserves an explicitly selected thinking model when it is eligible', async () => {
    const pinned = thinking();
    expect((await selectModel(gateway([profile('instruct'), pinned]), task(pinned.id), user, 'security_reviewer', admit, new Set())).model.id).toBe(pinned.id);
  });
  it('uses the highest ranked fallback when the pinned model has already failed', async () => {
    const pinned = thinking(); const first = profile('first', { tokensPerSecond: 20 }); const second = profile('second', { tokensPerSecond: 16 });
    expect((await selectModel(gateway([pinned, second, first]), task(pinned.id), user, 'security_reviewer', admit, new Set([pinned.id]))).model.id).toBe(first.id);
  });
  it('does not select an alternative rejected by resource admission', async () => {
    const first = profile('first'); const second = profile('second', { tokensPerSecond: 1 });
    const safe: Admit = async model => model.id === second.id ? { ...allowed, allowed: false, decision: 'queue', reasons: ['Memory pressure'] } : allowed;
    expect((await selectModel(gateway([first, second]), task(), user, 'security_reviewer', safe, new Set())).model.id).toBe(first.id);
  });
});
