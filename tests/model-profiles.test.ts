import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { MeasuredProviders } from '../server/models/measured-providers.js';
import { SecretManager } from '../server/providers/secrets.js';
import type { HardwareSnapshot, ModelChunk, ModelRequest } from '../shared/types.js';

const telemetry = vi.hoisted(() => ({ sample: vi.fn() }));
vi.mock('../server/hardware/index.js', () => ({ getHardware: telemetry.sample }));
const host = (): HardwareSnapshot => ({ sampledAt: new Date().toISOString(), platform: 'win32', architecture: 'x64', memoryArchitecture: 'discrete', cpu: { name: 'CPU', physicalCores: 8, logicalCores: 16, utilization: 4 }, memory: { totalBytes: 32 * 1024 ** 3, availableBytes: 20 * 1024 ** 3, swapTotalBytes: 0, swapUsedBytes: 0 }, gpus: [{ name: 'GPU', vendor: 'NVIDIA', totalBytes: 12 * 1024 ** 3, usedBytes: 1024 ** 3, utilization: 0, temperature: 35, driver: 'driver1', memoryShared: false }], storage: null, warnings: [] });
let store: Store;
let digest = 'digest-A';
let runtimeVersion='0.0.test';
let output = '';
const completed = (usage = true): string => JSON.stringify({ message: { content: 'Result', thinking: 'private-reasoning-marker' }, done: true, done_reason: 'stop', ...(usage ? { eval_count: 10, eval_duration: 500_000_000, prompt_eval_count: 40, prompt_eval_duration: 2_000_000_000 } : {}) });
const transport: typeof fetch = async url => {
  const path = new URL(String(url)).pathname;
  if(path==='/api/version')return Response.json({version:runtimeVersion});
  if (path === '/api/tags') return Response.json({ models: [{ name: 'test:4b', digest, size: 2000, details: { quantization_level: 'Q4_K_M' } }] });
  if (path === '/api/show') return Response.json({ capabilities: ['completion', 'tools'], model_info: { 'general.architecture': 'qwen3', 'qwen3.context_length': 8192 } });
  if (path === '/api/chat') return new Response(output);
  return Response.json({ models: [] });
};
function gateway(): MeasuredProviders { return new MeasuredProviders(store, { secrets: new SecretManager({ env: { OLLAMA_API_KEY: 'credential-marker' }, keyring: null }), fetch: transport }); }
async function request(providers: MeasuredProviders): Promise<ModelRequest> {
  const model = (await providers.listModels()).find(model => model.provider === 'ollama')!;
  model.details.arbitraryPrivateField = 'metadata-marker';
  return { model, messages: [{ role: 'user', content: 'user-prompt-marker' }], tools: [], contextTokens: 4096, maxOutputTokens: 512, execution: { numGpu: 0 }, signal: new AbortController().signal };
}
async function collect(stream: AsyncIterable<ModelChunk>): Promise<ModelChunk[]> { const result: ModelChunk[] = []; for await (const item of stream) result.push(item); return result; }

beforeAll(async () => { store = new Store(await openDatabase()); await store.init(); });
beforeEach(async () => { await store.db.query('DELETE FROM model_profiles'); digest = 'digest-A'; output = completed(); telemetry.sample.mockReset().mockResolvedValue(host()); });
afterAll(async () => { await store.close(); });

describe('durable measured profiles', () => {
  it('does not restore measurements across a runtime upgrade',async()=>{
    runtimeVersion='before';const providers=gateway();await collect(providers.stream(await request(providers)));runtimeVersion='after';
    expect((await gateway().listModels()).find(model=>model.provider==='ollama')?.tokensPerSecond).toBeNull();
  });
  it('restores real throughput and measurement conditions in a new gateway without persisting request data', async () => {
    const providers = gateway(); const input = await request(providers);
    await collect(providers.stream(input));
    const records = await store.db.query('SELECT * FROM model_profiles');
    expect(records).toHaveLength(1);
    const raw = JSON.stringify(records);
    for (const secret of ['credential-marker', 'private-reasoning-marker', 'metadata-marker', 'user-prompt-marker']) expect(raw).not.toContain(secret);
    const restarted = gateway();
    expect((await restarted.listModels()).find(model => model.provider === 'ollama')).toMatchObject({ state: 'available', tokensPerSecond: 20, details: { performance: { contextTokens: 4096, generationTokensPerSecond: 20, promptTokensPerSecond: 20, execution: { numGpu: 0 }, source: 'persisted' } } });
    await restarted.listModels();
    expect(telemetry.sample).toHaveBeenCalledTimes(2);
  });
  it('does not restore a different model digest or hardware configuration', async () => {
    const providers = gateway(); await collect(providers.stream(await request(providers)));
    digest = 'digest-B';
    expect((await gateway().listModels()).find(model => model.provider === 'ollama')?.tokensPerSecond).toBeNull();
    digest = 'digest-A'; const changed = host(); changed.gpus[0]!.name = 'Another GPU'; telemetry.sample.mockResolvedValue(changed);
    expect((await gateway().listModels()).find(model => model.provider === 'ollama')?.tokensPerSecond).toBeNull();
  });
  it('ignores changing utilization, free memory and sample times in hardware identity', async () => {
    const providers = gateway(); await collect(providers.stream(await request(providers)));
    const later = host(); later.memory.availableBytes /= 2; later.cpu.utilization = 90; later.gpus[0]!.temperature = 70; telemetry.sample.mockResolvedValue(later);
    expect((await gateway().listModels()).find(model => model.provider === 'ollama')?.tokensPerSecond).toBe(20);
  });
  it('does not persist incomplete generation or recycle an older measurement for absent usage', async () => {
    const providers = gateway(); const input = await request(providers);
    output = JSON.stringify({ done: true, done_reason: 'length', message: { content: 'partial' }, eval_count: 10, eval_duration: 500_000_000 });
    await expect(collect(providers.stream(input))).rejects.toThrow(/incomplete/);
    expect(await store.db.query('SELECT * FROM model_profiles')).toHaveLength(0);
    output = completed(); await collect(providers.stream(input));
    await store.db.query('DELETE FROM model_profiles');
    output = completed(false); await collect(providers.stream(input));
    expect(await store.db.query('SELECT * FROM model_profiles')).toHaveLength(0);
  });
  it('ignores corrupted stored identity and nonfinite or invented throughput', async () => {
    const providers = gateway(); await collect(providers.stream(await request(providers)));
    const record = (await store.db.query('SELECT * FROM model_profiles'))[0]!;
    const profile = record.profile as { runtime: string; details: { performance: { generationTokensPerSecond: unknown } } };
    profile.runtime = 'another-runtime';
    await store.db.query('UPDATE model_profiles SET profile=$1 WHERE id=$2', [JSON.stringify(profile), record.id]);
    expect((await gateway().listModels()).find(model => model.provider === 'ollama')?.tokensPerSecond).toBeNull();
    profile.runtime = 'ollama'; profile.details.performance.generationTokensPerSecond = 'Infinity';
    await store.db.query('UPDATE model_profiles SET profile=$1 WHERE id=$2', [JSON.stringify(profile), record.id]);
    expect((await gateway().listModels()).find(model => model.provider === 'ollama')?.tokensPerSecond).toBeNull();
  });
  it('does not persist a measurement when host identity is unavailable', async () => {
    telemetry.sample.mockRejectedValue(new Error('telemetry unavailable'));
    const providers = gateway(); await collect(providers.stream(await request(providers)));
    expect(await store.db.query('SELECT * FROM model_profiles')).toHaveLength(0);
    expect(providers.measurementStatus()).toMatchObject({ state: 'unavailable' });
  });
  it('does not turn a failed telemetry write into a failed generation or replay', async () => {
    const providers = gateway(); const input = await request(providers);
    const query = vi.spyOn(store.db, 'query'); query.mockRejectedValueOnce(new Error('database-secret-marker'));
    try {
      const result = await collect(providers.stream(input));
      expect(result.at(-1)?.type).toBe('done');
      expect(providers.measurementStatus()).toMatchObject({ state: 'unavailable' });
      expect(JSON.stringify(providers.measurementStatus())).not.toContain('database-secret-marker');
    } finally { query.mockRestore(); }
  });
});
