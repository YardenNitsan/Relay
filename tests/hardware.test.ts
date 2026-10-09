import { describe, expect, it } from 'vitest';
import { assessModel } from '../server/hardware/index.js';
import type { HardwareSnapshot, ModelProfile } from '../shared/types.js';
const GiB = 1024 ** 3;
const host = (): HardwareSnapshot => ({ sampledAt: new Date().toISOString(), platform: 'win32', architecture: 'x64', cpu: { name: 'Test CPU', physicalCores: 8, logicalCores: 16, utilization: 10 }, memory: { totalBytes: 32 * GiB, availableBytes: 24 * GiB, swapTotalBytes: 32 * GiB, swapUsedBytes: 0 }, gpus: [{ vendor: 'NVIDIA', name: 'Test GPU', totalBytes: 12 * GiB, usedBytes: GiB, utilization: 0, temperature: 40, driver: 'test' }], storage: null, warnings: [] });
const local = (): ModelProfile => ({ id: 'ollama/test', name: 'test', provider: 'ollama', runtime: 'ollama', local: true, capabilities: { tools: true, vision: false, reasoning: false, structured: true }, contextWindow: 32768, quantization: 'Q4_K_M', sizeBytes: 4 * GiB, state: 'available', details: { modelInfo: { 'general.architecture': 'llama', 'llama.block_count': 32, 'llama.attention.head_count_kv': 8, 'llama.attention.head_count': 32, 'llama.embedding_length': 4096 } }, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null });
describe('memory admission', () => {
  it.each([11.5, 6])('forces CPU when an unpinned second GPU cannot safely fit (%s GiB used)', used => {
    const hardware=host();hardware.gpus.push({...hardware.gpus[0]!,usedBytes:used*GiB});
    expect(assessModel(local(),hardware,4096)).toMatchObject({allowed:true,execution:{numGpu:0},estimatedVramBytes:0});
    const model=local();model.provider='lmstudio';
    expect(assessModel(model,hardware,4096)).toMatchObject({allowed:false,decision:'queue'});
  });
  it('admits multiple measured suitable GPUs while excluding shared integrated memory',()=>{
    const hardware=host();hardware.gpus.push({...hardware.gpus[0]!},{...hardware.gpus[0]!,memoryShared:true,totalBytes:null,usedBytes:null});
    expect(assessModel(local(),hardware,4096)).toMatchObject({allowed:true});
    expect(assessModel(local(),hardware,4096).execution).toBeUndefined();
  });
  it('does not let resident allocation credit hide an already breached VRAM reserve',()=>{
    const hardware=host();hardware.gpus[0]!.usedBytes=11.5*GiB;
    const model=local();model.details.loaded={sizeVram:11*GiB,contextLength:4096,sampledAt:new Date().toISOString()};
    expect(assessModel(model,hardware,4096).execution).toEqual({numGpu:0});
  });
  it('admits a measured host with weights, KV cache and headroom', () => { const result = assessModel(local(), host(), 4096); expect(result.allowed).toBe(true); expect(result.estimatedVramBytes).toBeGreaterThan(4.5 * GiB); expect(result.confidence).toBe('estimated'); });
  it('makes long context cost more memory and refuses impossible context', () => { expect(assessModel(local(), host(), 32768).estimatedVramBytes).toBeGreaterThan(assessModel(local(), host(), 4096).estimatedVramBytes!); expect(assessModel(local(), host(), 32769).allowed).toBe(false); });
  it('does not count swap as available RAM', () => { const hardware = host(); hardware.memory.availableBytes = GiB; hardware.memory.swapTotalBytes = 100 * GiB; expect(assessModel(local(), hardware, 4096).allowed).toBe(false); });
  it('rejects stale telemetry before admitting a load', () => { const hardware = host(); hardware.sampledAt = new Date(Date.now() - 60_000).toISOString(); expect(assessModel(local(), hardware, 4096)).toMatchObject({ allowed: false, decision: 'queue' }); });
  it('does not assume missing GPU pressure is zero', () => { const hardware = host(); hardware.gpus[0]!.usedBytes = null; expect(assessModel(local(), hardware, 4096)).toMatchObject({ allowed: false, confidence: 'unknown' }); });
  it('rejects unknown hybrid architectures instead of using a false KV formula', () => { const profile = local(); profile.details.modelInfo = { 'general.architecture': 'unknown-hybrid' }; expect(assessModel(profile, host(), 4096)).toMatchObject({ allowed: false, confidence: 'unknown' }); });
  it('falls back to enforced CPU execution when GPU pressure is unsafe but RAM is sufficient', () => { const hardware = host(); hardware.gpus[0]!.usedBytes = 10 * GiB; expect(assessModel(local(), hardware, 4096)).toMatchObject({ allowed: true, execution: { numGpu: 0 }, estimatedVramBytes: 0 }); });
  it('does not double count verified existing model allocation at the same context', () => { const profile = local(); profile.details.loaded = { sizeVram: 6 * GiB, contextLength: 4096, sampledAt: new Date().toISOString() }; const hardware = host(); hardware.gpus[0]!.usedBytes = 7 * GiB; expect(assessModel(profile, hardware, 4096).allowed).toBe(true); });
  it('does not credit allocations with unknown observation time', () => { const profile = local(); profile.details.loaded = { sizeVram: 6 * GiB, contextLength: 4096 }; const hardware = host(); hardware.gpus[0]!.usedBytes = 7 * GiB; expect(assessModel(profile, hardware, 4096)).toMatchObject({ execution: { numGpu: 0 } }); });
  it('rejects nonfinite or negative context requests', () => { for (const size of [NaN, Infinity, -1, 0, 1.5]) expect(assessModel(local(), host(), size).allowed).toBe(false); });
  it('uses one physical memory budget on Apple Silicon without requiring discrete VRAM telemetry', () => { const hardware = host(); hardware.platform = 'darwin'; hardware.architecture = 'arm64'; hardware.memoryArchitecture = 'unified'; hardware.gpus = [{ vendor: 'Apple', name: 'Apple M4', totalBytes: null, usedBytes: null, utilization: null, temperature: null, driver: null, memoryShared: true }]; const result = assessModel(local(), hardware, 4096); expect(result.allowed).toBe(true); expect(result.estimatedVramBytes).toBeNull(); expect(result.estimatedRamBytes).toBeLessThan(8 * GiB); });
  it('admits CPU-only execution conservatively without inventing a GPU', () => { const hardware = host(); hardware.gpus = []; hardware.memoryArchitecture = 'cpu'; expect(assessModel(local(), hardware, 4096)).toMatchObject({ allowed: true, estimatedVramBytes: null }); });
  it('rejects a low-memory laptop even with a large pagefile', () => { const hardware = host(); hardware.platform = 'linux'; hardware.gpus = []; hardware.memoryArchitecture = 'cpu'; hardware.memory = { totalBytes: 8 * GiB, availableBytes: 4 * GiB, swapTotalBytes: 32 * GiB, swapUsedBytes: 0 }; expect(assessModel(local(), hardware, 4096).allowed).toBe(false); });
  it('accepts sufficient measured AMD capacity without requiring CUDA', () => { const hardware = host(); hardware.platform = 'linux'; hardware.gpus[0] = { ...hardware.gpus[0]!, vendor: 'AMD', name: 'Radeon test device', totalBytes: 24 * GiB }; expect(assessModel(local(), hardware, 8192).allowed).toBe(true); });
  it('does not turn a low-memory unified GPU into an extra memory pool', () => { const hardware = host(); hardware.platform = 'darwin'; hardware.architecture = 'arm64'; hardware.memoryArchitecture = 'unified'; hardware.memory.totalBytes = 8 * GiB; hardware.memory.availableBytes = 5 * GiB; hardware.gpus = [{ ...hardware.gpus[0]!, vendor: 'Apple', name: 'Apple test GPU', totalBytes: 8 * GiB, memoryShared: true }]; expect(assessModel(local(), hardware, 4096).allowed).toBe(false); });
  it('admits a larger model on a measured high-memory workstation', () => { const hardware = host(); hardware.memory.totalBytes = 128 * GiB; hardware.memory.availableBytes = 100 * GiB; hardware.gpus[0] = { ...hardware.gpus[0]!, totalBytes: 48 * GiB }; const model = local(); model.sizeBytes = 18 * GiB; expect(assessModel(model, hardware, 8192).allowed).toBe(true); });
});
