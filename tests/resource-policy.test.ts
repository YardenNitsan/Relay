import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { assessModel } from '../server/hardware/index.js';
import { getResourcePolicy, saveResourcePolicy } from '../server/hardware/config.js';
import { resourcePolicySchema, resolveResourcePolicy, resourceProfiles, type ResourcePolicyConfig } from '../server/hardware/policy.js';
import type { HardwareSnapshot, ModelProfile } from '../shared/types.js';

const GiB = 1024 ** 3;
function hardware(vendor = 'NVIDIA'): HardwareSnapshot {
  return { sampledAt: new Date().toISOString(), platform: vendor === 'Apple' ? 'darwin' : 'linux', architecture: vendor === 'Apple' ? 'arm64' : 'x64', memoryArchitecture: vendor === 'CPU' ? 'cpu' : vendor === 'Apple' || vendor === 'Intel' ? 'unified' : 'discrete', cpu: { name: 'Test CPU', physicalCores: 8, logicalCores: 16, utilization: 15 }, memory: { totalBytes: 32 * GiB, availableBytes: 24 * GiB, swapTotalBytes: 8 * GiB, swapUsedBytes: 0 }, gpus: vendor === 'CPU' ? [] : [{ vendor, name: `${vendor} test`, totalBytes: vendor === 'Apple' || vendor === 'Intel' ? null : 12 * GiB, usedBytes: vendor === 'Apple' || vendor === 'Intel' ? null : GiB, memoryShared: vendor === 'Apple' || vendor === 'Intel', utilization: null, temperature: null, driver: null }], storage: null, warnings: [] };
}
function model(): ModelProfile {
  return { id: 'ollama/test', name: 'test', provider: 'ollama', runtime: 'ollama', local: true, capabilities: { tools: true, vision: false, reasoning: false, structured: true }, contextWindow: 32768, quantization: 'Q4_K_M', sizeBytes: 4 * GiB, state: 'available', details: { modelInfo: { 'general.architecture': 'llama', 'llama.block_count': 32, 'llama.attention.head_count': 32, 'llama.attention.head_count_kv': 8, 'llama.embedding_length': 4096 } }, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null };
}
const custom: ResourcePolicyConfig = { profile: 'custom', ramReserveGiB: 4, ramReservePercent: 20, vramReserveGiB: 1, vramReservePercent: 15 };

describe('resource policy admission', () => {
  it('keeps the existing safe policy as the implicit default', () => {
    expect(resolveResourcePolicy()).toMatchObject({ profile: 'safe', ramReserveGiB: 4, ramReservePercent: 20, vramReserveGiB: 1, vramReservePercent: 15 });
    const snapshot = hardware();
    expect(assessModel(model(), snapshot, 4096)).toEqual(assessModel(model(), snapshot, 4096, { profile: 'safe' }));
    expect(resourceProfiles().map(profile => profile.profile)).toEqual(['safe', 'balanced', 'performance', 'custom']);
  });
  it.each(['CPU', 'NVIDIA', 'AMD', 'Apple', 'Intel'])('uses selected reserves on %s without changing the model estimate', vendor => {
    const snapshot = hardware(vendor); snapshot.memory.availableBytes = 11 * GiB;
    const safe = assessModel(model(), snapshot, 4096, { profile: 'safe' });
    const balanced = assessModel(model(), snapshot, 4096, { profile: 'balanced' });
    const performance = assessModel(model(), snapshot, 4096, { profile: 'performance' });
    expect(safe.allowed).toBe(false); expect(balanced.allowed).toBe(true); expect(performance.allowed).toBe(true);
    expect(safe.estimatedRamBytes).toBe(balanced.estimatedRamBytes); expect(performance.estimatedRamBytes).toBe(balanced.estimatedRamBytes);
    expect(performance.confidence).toBe('estimated');
    if (['CPU', 'Apple', 'Intel'].includes(vendor)) expect(balanced.estimatedVramBytes).toBeNull();
  });
  it.each(['NVIDIA', 'AMD'])('applies discrete VRAM reserves on %s and enforces safe CPU fallback', vendor => {
    const snapshot = hardware(vendor); snapshot.gpus[0]!.usedBytes = Math.floor(4.8 * GiB);
    expect(assessModel(model(), snapshot, 4096, { profile: 'safe' }).execution).toEqual({ numGpu: 0 });
    expect(assessModel(model(), snapshot, 4096, { profile: 'balanced' }).execution).toBeUndefined();
  });
  it.each(['safe', 'balanced', 'performance', 'custom'] as const)('cannot oversubscribe a low-memory host with the %s profile', profile => {
    const snapshot = hardware('CPU'); snapshot.memory.totalBytes = 8 * GiB; snapshot.memory.availableBytes = 4 * GiB; snapshot.memory.swapTotalBytes = 128 * GiB;
    expect(assessModel(model(), snapshot, 4096, profile === 'custom' ? { ...custom, ramReserveGiB: 2, ramReservePercent: 10, vramReserveGiB: 1, vramReservePercent: 10 } : { profile }).allowed).toBe(false);
  });
  it('allows a stricter custom policy without weakening cache and buffer estimates', () => {
    const snapshot = hardware(); snapshot.memory.availableBytes = 14 * GiB;
    expect(assessModel(model(), snapshot, 4096, { profile: 'safe' }).allowed).toBe(true);
    const result = assessModel(model(), snapshot, 4096, { ...custom, ramReserveGiB: 10, ramReservePercent: 30 });
    expect(result.allowed).toBe(false); expect(result.reasons.join(' ')).toContain('Custom');
  });
  it.each([
    { ...custom, ramReserveGiB: 1.99 }, { ...custom, ramReservePercent: 9.99 },
    { ...custom, vramReserveGiB: 0.99 }, { ...custom, vramReservePercent: 9.99 },
    { ...custom, ramReserveGiB: NaN }, { ...custom, vramReserveGiB: Infinity },
    { ...custom, ramReservePercent: 76 }, { ...custom, vramReserveGiB: 257 },
    { profile: 'performance', ramReservePercent: 0 }, { profile: 'custom' }, { profile: 'unsafe' }, null,
  ])('rejects malformed policy and reserve-floor bypass: %j', input => {
    expect(resourcePolicySchema.safeParse(input).success).toBe(false);
    expect(() => assessModel(model(), hardware(), 4096, input as ResourcePolicyConfig)).toThrow();
  });
  it('preserves stale, unknown telemetry and swap protections under performance mode', () => {
    const policy = { profile: 'performance' } as const;
    const stale = hardware(); stale.sampledAt = new Date(Date.now() - 30_000).toISOString();
    const unknown = hardware('AMD'); unknown.gpus[0]!.usedBytes = null;
    const swapping = hardware('Apple'); swapping.memory.swapUsedBytes = 9 * GiB;
    for (const snapshot of [stale, unknown, swapping]) expect(assessModel(model(), snapshot, 4096, policy).allowed).toBe(false);
  });
});

let store: Store;
beforeAll(async () => { store = new Store(await openDatabase()); await store.init(); });
beforeEach(async () => { await store.db.query("DELETE FROM settings WHERE key='resource_policy'"); });
afterAll(async () => { await store.close(); });
describe('owner resource policy persistence', () => {
  it('returns safe when no setting exists without creating a setting', async () => {
    expect(await getResourcePolicy(store)).toEqual({ profile: 'safe' });
    expect(await store.db.query("SELECT value FROM settings WHERE key='resource_policy'")).toHaveLength(0);
  });
  it('persists the validated policy and records its change transactionally', async () => {
    expect(await saveResourcePolicy(store, { profile: 'balanced' })).toEqual({ profile: 'balanced' });
    expect(await getResourcePolicy(new Store(store.db))).toEqual({ profile: 'balanced' });
    expect((await store.events(0)).some(event => event.type === 'RESOURCE_POLICY_CHANGED' && event.data.policy && (event.data.policy as { profile: string }).profile === 'balanced')).toBe(true);
    await saveResourcePolicy(store, custom);
    expect(await getResourcePolicy(store)).toEqual(custom);
  });
  it('rejects an invalid update before replacing the existing setting', async () => {
    await saveResourcePolicy(store, { profile: 'safe' });
    await expect(saveResourcePolicy(store, { ...custom, ramReserveGiB: 0 })).rejects.toThrow();
    expect(await getResourcePolicy(store)).toEqual({ profile: 'safe' });
  });
  it('fails closed for a corrupted persisted policy', async () => {
    await store.db.query('INSERT INTO settings(key,value) VALUES ($1,$2)', ['resource_policy', JSON.stringify({ profile: 'custom', ramReserveGiB: 0 })]);
    await expect(getResourcePolicy(store)).rejects.toThrow();
  });
});
