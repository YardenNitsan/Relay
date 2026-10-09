import os from 'node:os';
import si from 'systeminformation';
import type { Admission, HardwareSnapshot, ModelProfile } from '../../shared/types.js';
import { number, object, string } from '../providers/transport.js';
import { reserveBytes, resolveResourcePolicy, resourcePolicyReason, type ResourcePolicyConfig } from './policy.js';

const MiB = 1024 ** 2;
const positive = (value: unknown): number | null => { const n = number(value); return n !== null && n > 0 ? n : null; };

export async function getHardware(): Promise<HardwareSnapshot> {
  const result = await Promise.allSettled([si.cpu(), si.mem(), si.graphics(), si.currentLoad(), si.fsSize()]);
  const [cpuResult, memoryResult, graphicsResult, loadResult, storageResult] = result;
  const cpu = cpuResult.status === 'fulfilled' ? cpuResult.value : null;
  const memory = memoryResult.status === 'fulfilled' ? memoryResult.value : null;
  const graphics = graphicsResult.status === 'fulfilled' ? graphicsResult.value : null;
  const load = loadResult.status === 'fulfilled' ? loadResult.value : null;
  const disks = storageResult.status === 'fulfilled' ? storageResult.value : null;
  const warnings: string[] = [];
  result.forEach((value, index) => { if (value.status === 'rejected') warnings.push(`${['CPU', 'Memory', 'GPU', 'CPU pressure', 'Storage'][index]} telemetry unavailable`); });
  const appleUnified = process.platform === 'darwin' && process.arch === 'arm64';
  const gpus: HardwareSnapshot['gpus'] = (graphics?.controllers ?? []).map(gpu => {
    const shared = appleUnified || gpu.vramDynamic === true;
    const totalMb = positive(gpu.memoryTotal) ?? positive(gpu.vram);
    const usedMb = number(gpu.memoryUsed);
    return { vendor: gpu.vendor || 'Unknown', name: gpu.model || 'Unknown GPU', totalBytes: shared ? null : totalMb === null ? null : totalMb * MiB, usedBytes: shared ? null : usedMb === null ? null : usedMb * MiB, utilization: number(gpu.utilizationGpu), temperature: number(gpu.temperatureGpu), driver: gpu.driverVersion || null, memoryShared: shared };
  });
  const memoryArchitecture: HardwareSnapshot['memoryArchitecture'] = !graphics ? 'unknown' : appleUnified || (gpus.length > 0 && gpus.every(gpu => gpu.memoryShared)) ? 'unified' : gpus.length ? 'discrete' : 'cpu';
  if (memoryArchitecture === 'unified') warnings.push('CPU and GPU share physical memory. Metal/device allocation limits are not measured; admission uses conservative physical RAM headroom.');
  if (gpus.some(gpu => !gpu.memoryShared && (gpu.totalBytes === null || gpu.usedBytes === null))) warnings.push('GPU memory pressure is unavailable; automatic discrete GPU admission is disabled.');
  const currentDisk = disks?.filter(disk => process.cwd().toLowerCase().startsWith(disk.mount.toLowerCase())).sort((a, b) => b.mount.length - a.mount.length)[0];
  return {
    sampledAt: new Date().toISOString(), platform: process.platform, architecture: process.arch, memoryArchitecture,
    cpu: { name: cpu ? `${cpu.manufacturer} ${cpu.brand}`.trim() : os.cpus()[0]?.model ?? 'Unknown', physicalCores: cpu?.physicalCores ?? 0, logicalCores: cpu?.cores ?? os.cpus().length, utilization: load ? number(load.currentLoad) : null },
    memory: { totalBytes: memory?.total ?? os.totalmem(), availableBytes: memory?.available ?? os.freemem(), swapTotalBytes: memory ? number(memory.swaptotal) : null, swapUsedBytes: memory ? number(memory.swapused) : null },
    gpus, storage: currentDisk ? { totalBytes: currentDisk.size, availableBytes: currentDisk.available } : null, warnings,
  };
}

/** Estimates are admission policy, not guarantees of allocation or benchmarks. */
export function assessModel(model: ModelProfile, hardware: HardwareSnapshot, contextTokens: number, config?: ResourcePolicyConfig): Admission {
  const policy = resolveResourcePolicy(config);
  const result: Admission = { allowed: false, decision: 'alternative', reasons: [resourcePolicyReason(policy)], estimatedRamBytes: null, estimatedVramBytes: null, contextTokens, confidence: 'unknown' };
  const reject = (reason: string, decision: Admission['decision'] = 'alternative'): Admission => ({ ...result, decision, reasons: [...result.reasons, reason] });
  if (!Number.isSafeInteger(contextTokens) || contextTokens < 1) return reject('Context must be a positive whole token count');
  if (model.contextWindow !== null && contextTokens > model.contextWindow) return reject('Requested context exceeds the discovered model limit', 'reduce_context');
  if (!model.local) return { ...result, allowed: true, decision: 'run', reasons: ['Cloud inference does not reserve local model memory; cloud authorization and budget are separate checks.'] };
  const age = Date.now() - Date.parse(hardware.sampledAt);
  if (!Number.isFinite(age) || age > 15_000 || age < -5000) return reject('Hardware telemetry is stale; take a fresh sample', 'queue');
  if (!positive(hardware.memory.totalBytes) || !positive(hardware.memory.availableBytes) || hardware.memory.availableBytes > hardware.memory.totalBytes) return reject('Physical memory availability is unknown', 'queue');
  if (hardware.memoryArchitecture === 'unknown') return reject('GPU inventory is unavailable; safe admission cannot be established', 'queue');
  const weights = positive(model.sizeBytes);
  if (!weights) return reject('Model weight allocation is unknown');
  const info = object(model.details.modelInfo); const architecture = string(info['general.architecture']);
  if (!['llama', 'qwen2', 'qwen3', 'qwen3moe', 'mistral', 'phi2', 'phi3'].includes(architecture)) return reject('Architecture-specific KV cache requirements are unknown; benchmark or supported metadata is required');
  const layers = positive(info[`${architecture}.block_count`]); const heads = positive(info[`${architecture}.attention.head_count`]); const kvHeads = positive(info[`${architecture}.attention.head_count_kv`]); const embed = positive(info[`${architecture}.embedding_length`]);
  if (!layers || !heads || !kvHeads || !embed) return reject('Attention geometry is incomplete; model file size alone cannot establish hardware fit');
  const keyLength = positive(info[`${architecture}.attention.key_length`]) ?? embed / heads;
  const valueLength = positive(info[`${architecture}.attention.value_length`]) ?? embed / heads;
  // Reserve f16 KV even if an external runtime globally enables cache quantization.
  const kv = layers * kvHeads * (keyLength + valueLength) * 2 * contextTokens;
  const buffers = Math.max(512 * MiB, weights * 0.15) + 512 * MiB;
  const peak = Math.ceil(weights + kv + buffers);
  const shared = hardware.memoryArchitecture === 'unified' || (hardware.platform === 'darwin' && hardware.architecture === 'arm64');
  const dedicated = hardware.gpus.filter(gpu => !gpu.memoryShared);
  result.confidence = 'estimated'; result.estimatedRamBytes = peak;
  result.reasons.push('Includes quantized weights, f16 KV cache, runtime/load buffers and operating-system headroom; local calls must be serialized.');
  const ramReserve = reserveBytes(hardware.memory.totalBytes, policy.ramReserveGiB, policy.ramReservePercent);
  if (hardware.memory.availableBytes - ramReserve < peak) return reject('Insufficient available physical RAM after safety reserve; swap/pagefile is not inference capacity', 'queue');
  if ((hardware.memory.swapUsedBytes ?? 0) > hardware.memory.totalBytes * 0.25) return reject('Substantial swap/pagefile use indicates unsafe memory pressure', 'queue');
  if (shared) {
    result.reasons.push('Unified memory counted once against physical RAM. Metal working-set ceiling is unknown; this is an estimate.');
  } else if (dedicated.length) {
    result.estimatedVramBytes = peak;
    if (dedicated.some(gpu => gpu.totalBytes === null || gpu.usedBytes === null || gpu.usedBytes > gpu.totalBytes)) return { ...reject('GPU memory availability is unknown; refusing an unmeasured GPU load', 'queue'), confidence: 'unknown' };
    const loaded = object(model.details.loaded);
    const loadedAge = loaded.sampledAt ? Date.now() - Date.parse(string(loaded.sampledAt)) : Infinity;
    const resident = dedicated.length === 1 && loadedAge >= 0 && loadedAge < 15_000 && number(loaded.contextLength) === contextTokens ? number(loaded.sizeVram) ?? 0 : 0;
    // Runtime device selection is not pinned. Every discrete candidate must be
    // safe; otherwise it may select a busy/smaller device despite another fitting.
    const fits = dedicated.every(gpu => {
      const total = gpu.totalBytes!; const used = gpu.usedBytes!;
      const available = total - used + Math.min(resident, used);
      const reserve = reserveBytes(total, policy.vramReserveGiB, policy.vramReservePercent);
      return total - used >= reserve && peak <= available - reserve;
    });
    if (!fits) {
      if (model.provider === 'ollama') return { ...result, allowed: true, decision: 'run', execution: { numGpu: 0 }, estimatedVramBytes: 0, reasons: [...result.reasons, 'GPU headroom is insufficient. Enforce CPU-only execution with num_gpu=0; physical RAM passed the complete weight/KV/buffer estimate. Throughput is unmeasured.'] };
      return reject('Estimated weights, KV and buffers exceed available VRAM after safety reserve; queue, reduce context or choose a smaller model', 'queue');
    }
    result.reasons.push(`Fits every unpinned discrete GPU candidate with at least ${policy.vramReservePercent}% or ${policy.vramReserveGiB} GiB VRAM reserved. Existing same-context allocation is credited only for a single GPU.`);
  } else result.reasons.push('CPU-only inference uses physical RAM; speed has not been benchmarked.');
  return { ...result, allowed: true, decision: 'run' };
}
