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

describe('personal assistant tool routing', () => {
  const textOnly = () => profile('fast-text', { state: 'ready', tokensPerSecond: 100, capabilities: { tools: false, reasoning: false, vision: false, structured: true } });
  const personalTask = (): TaskRecord => { const objective = task(); objective.options.assistantId = 'personal'; objective.options.workspaceId = null; return objective; };
  it('requires native tools for explicitly opted-in Workspace reads without a file workspace',async()=>{const objective=personalTask();objective.options.assistantId='email';objective.options.googleWorkspace={mail:true,calendar:false};const tools=profile('mail-tools',{tokensPerSecond:1});expect((await selectModel(gateway([textOnly(),tools]),objective,user,'worker',admit,new Set())).model.id).toBe(tools.id);});

  it('selects a tool-capable worker for personal tasks without an attached workspace', async () => {
    const tools = profile('task-tools', { tokensPerSecond: 2 });
    const selected = await selectModel(gateway([textOnly(), tools]), personalTask(), user, 'worker', admit, new Set());
    expect(selected.model.id).toBe(tools.id);
  });

  it('rejects a required text-only model instead of implying personal task actions can execute', async () => {
    const text = textOnly(); const objective = personalTask(); objective.options.modelId = text.id; objective.options.modelSelection = 'required';
    await expect(selectModel(gateway([text, profile('task-tools')]), objective, user, 'worker', admit, new Set())).rejects.toMatchObject({ code: 'NO_MODEL', message: expect.stringContaining('tool calling is not available') });
  });

  it('keeps text-only models eligible for roles that receive no personal task tool', async () => {
    const text = textOnly(); const models = gateway([text, profile('task-tools')]);
    expect((await selectModel(models, personalTask(), user, 'planner', admit, new Set())).model.id).toBe(text.id);
    const ordinary = personalTask(); delete ordinary.options.assistantId;
    expect((await selectModel(models, ordinary, user, 'worker', admit, new Set())).model.id).toBe(text.id);
  });
});

describe('model diversity preserves suitability', () => {
  it('considers an authorized LM Studio coding specialist ahead of an equally unmeasured general model',async()=>{
    const coder=profile('qwen-coder',{id:'lmstudio/qwen-coder',provider:'lmstudio',runtime:'lmstudio'});
    const general=profile('general');const objective=task();objective.objective='Fix a TypeScript repository bug';
    const owner={...user,permissions:{...user.permissions,providers:[...user.permissions.providers,'lmstudio' as const]}};
    const chosen=await selectModel(gateway([general,coder]),objective,owner,'worker',admit,new Set());
    expect(chosen.model.id).toBe(coder.id);expect(chosen.reasons.join(' ')).toMatch(/name.*heuristic/i);
  });
  it('does not use GPU benchmark speed when admission changes to CPU',async()=>{
    const gpuBenchmark=profile('old-gpu',{tokensPerSecond:100,details:{performance:{contextTokens:8192,execution:{numGpu:-1}}}});
    const current=profile('current',{tokensPerSecond:10,details:{performance:{contextTokens:8192,execution:{numGpu:0}}}});
    const cpu:Admit=async()=>({...allowed,execution:{numGpu:0}});
    expect((await selectModel(gateway([gpuBenchmark,current]),task(),user,'worker',cpu,new Set())).model.id).toBe(current.id);
  });
  it('uses matching fixed task probes ahead of speed, without overriding hardware admission',async()=>{
    const slow=profile('measured-coding',{tokensPerSecond:1,details:{digest:'d',runtimeVersion:'1',taskFit:{protocol:'relay-task-fit-v1',digest:'d',runtimeVersion:'1',measuredAt:new Date().toISOString(),scores:{coding:{passed:2,total:2},reasoning:{passed:0,total:2},general:{passed:1,total:2}}}}});
    const fast=profile('fast',{tokensPerSecond:20});const objective=task();objective.objective='Fix a repository bug';
    const selected=await selectModel(gateway([fast,slow]),objective,user,'worker',admit,new Set());
    expect(selected.model.id).toBe(slow.id);expect(selected.reasons.join(' ')).toContain('2/2');
    const safe:Admit=async model=>model.id===slow.id?{...allowed,allowed:false,decision:'queue'}:allowed;
    expect((await selectModel(gateway([fast,slow]),objective,user,'worker',safe,new Set())).model.id).toBe(fast.id);
    slow.details.digest='changed';expect((await selectModel(gateway([fast,slow]),objective,user,'worker',admit,new Set())).model.id).toBe(fast.id);
  });
  it('does not bypass the mandatory-thinking penalty for security review', async () => {
    const instruct = profile('instruct');
    expect((await selectModel(gateway([instruct, thinking()]), task(), user, 'security_reviewer', admit, new Set())).model.id).toBe(instruct.id);
  });
  it('does not introduce mandatory thinking for diversity even when other score bonuses narrow the gap', async () => {
    const cloud = profile('instruct', { id: 'openai/instruct', provider: 'openai', runtime: 'openai', local: false, tokensPerSecond: 20, inputPricePerMillion: .1, outputPricePerMillion: .5 });
    const objective = task(); objective.options.cloudPolicy = 'allow'; objective.options.budget.localOnly = false; objective.options.budget.maxCostUsd = null;
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
