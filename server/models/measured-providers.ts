import { createHash } from 'node:crypto';
import type { HardwareSnapshot, ModelChunk, ModelProfile, ModelRequest } from '../../shared/types.js';
import type { Store } from '../db/store.js';
import { getHardware } from '../hardware/index.js';
import { Providers, type ProvidersOptions } from '../providers/index.js';
import { number, object, string } from '../providers/transport.js';
import {decorateTaskFit} from './task-fit.js';

interface Performance {
  contextTokens: number;
  generationTokensPerSecond: number;
  promptTokensPerSecond?: number;
  measuredAt: string;
  execution?: { numGpu: number };
  source: 'measured' | 'persisted';
}
interface Identity { key: string; digest: string; runtimeVersion:string|null; hardwareFingerprint: string; }
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const positive = (value: unknown): number | null => { const parsed = number(value); return parsed !== null && parsed > 0 ? parsed : null; };
const text = (value: unknown): string => string(value).slice(0, 512);

/** Configuration identity intentionally excludes hostnames, usernames, paths and load. */
function hardwareIdentity(hardware: HardwareSnapshot): string | null {
  if (!hardware.platform || !hardware.architecture || hardware.memoryArchitecture === 'unknown' || !hardware.cpu.name || hardware.cpu.name === 'Unknown' || !positive(hardware.cpu.logicalCores) || !positive(hardware.memory.totalBytes)) return null;
  if (hardware.gpus.some(gpu => !gpu.name || gpu.name === 'Unknown GPU' || !gpu.memoryShared && !positive(gpu.totalBytes))) return null;
  const gpus = hardware.gpus.map(gpu => ({ vendor: text(gpu.vendor), name: text(gpu.name), totalBytes: gpu.totalBytes, shared: !!gpu.memoryShared, driver: text(gpu.driver) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return hash({ platform: hardware.platform, architecture: hardware.architecture, memoryArchitecture: hardware.memoryArchitecture ?? null, cpu: { name: hardware.cpu.name, physicalCores: hardware.cpu.physicalCores, logicalCores: hardware.cpu.logicalCores }, totalRamBytes: hardware.memory.totalBytes, gpus });
}

function modelIdentity(model: ModelProfile, hardwareFingerprint: string | null): Identity | null {
  const digest = string(model.details.digest);
  if (!model.local || !hardwareFingerprint || !digest || digest.length > 512) return null;
  const runtimeVersion=string(model.details.runtimeVersion)||null;
  return { digest, runtimeVersion, hardwareFingerprint, key: `measured:${hash([model.provider, model.runtime, runtimeVersion, model.id, digest, hardwareFingerprint])}` };
}

function performanceRecord(raw: unknown): Performance | null {
  const value = object(raw); const context = positive(value.contextTokens); const throughput = positive(value.generationTokensPerSecond);
  const timestamp = Date.parse(string(value.measuredAt));
  if (!context || !Number.isSafeInteger(context) || !throughput || !Number.isFinite(timestamp) || timestamp > Date.now() + 5000) return null;
  const prompt = positive(value.promptTokensPerSecond);
  const execution = object(value.execution); const numGpu = number(execution.numGpu);
  if (value.execution !== undefined && (numGpu === null || !Number.isSafeInteger(numGpu))) return null;
  return { contextTokens: context, generationTokensPerSecond: throughput, ...(prompt !== null ? { promptTokensPerSecond: prompt } : {}), measuredAt: new Date(timestamp).toISOString(), ...(numGpu !== null ? { execution: { numGpu } } : {}), source: 'persisted' };
}

/** Explicit allowlist: never persist arbitrary model metadata, request messages or native continuation. */
function persistedModel(model: ModelProfile, identity: Identity, performance: Performance): ModelProfile {
  return {
    id: text(model.id), name: text(model.name), provider: model.provider, runtime: text(model.runtime), local: model.local,
    capabilities: { tools: !!model.capabilities.tools, vision: !!model.capabilities.vision, reasoning: !!model.capabilities.reasoning, structured: !!model.capabilities.structured },
    contextWindow: number(model.contextWindow), quantization: model.quantization === null ? null : text(model.quantization), sizeBytes: number(model.sizeBytes),
    state: 'available', tokensPerSecond: performance.generationTokensPerSecond,
    inputPricePerMillion: number(model.inputPricePerMillion), outputPricePerMillion: number(model.outputPricePerMillion),
    details: { measurementSchema: 2, digest: identity.digest, runtimeVersion:identity.runtimeVersion, hardwareFingerprint: identity.hardwareFingerprint, performance },
  };
}

/** Persistence decorates the gateway; admission, local leases and benchmarking stay in the controller. */
export class MeasuredProviders extends Providers {
  private hardware: Promise<string | null> | undefined;
  private persistenceFailure = false;
  private identityUnavailable = false;
  constructor(private readonly store: Store, options: ProvidersOptions = {}) { super(options); }

  measurementStatus(): { state: 'ready' | 'unavailable'; error: string | null } {
    if (this.identityUnavailable) return { state: 'unavailable', error: 'Hardware identity is unavailable; measurements are not persisted.' };
    if (this.persistenceFailure) return { state: 'unavailable', error: 'Model measurement storage is unavailable; inference results remain valid.' };
    return { state: 'ready', error: null };
  }

  private identity(): Promise<string | null> {
    this.hardware ??= getHardware().then(hardwareIdentity).catch(() => null).then(identity => { this.identityUnavailable = identity === null; return identity; });
    return this.hardware;
  }

  override async listModels(): Promise<ModelProfile[]> {
    return this.decorate(await super.listModels());
  }
  override async localModels(): Promise<ModelProfile[]> {
    return this.decorate(await super.localModels());
  }
  private async decorate(models:ModelProfile[]):Promise<ModelProfile[]> {
    const hardware=await this.identity();
    const identities = new Map(models.flatMap(model => { const identity = modelIdentity(model, hardware); return identity ? [[model.id, identity] as const] : []; }));
    if (!identities.size) return models;
    try {
      const records = await this.store.db.query('SELECT id,profile FROM model_profiles WHERE id=ANY($1::text[])', [[...identities.values()].map(identity => identity.key)]);
      const profiles = new Map(records.map(record => [string(record.id), object(record.profile)]));
      for (const model of models) {
        const identity = identities.get(model.id); if (!identity) continue;
        const saved = profiles.get(identity.key); if (!saved) continue;
        const details = object(saved.details);
        if (saved.id !== model.id || saved.provider !== model.provider || saved.runtime !== model.runtime || saved.local !== true || details.measurementSchema !== 2 || details.runtimeVersion!==identity.runtimeVersion || details.digest !== identity.digest || details.hardwareFingerprint !== hardware) continue;
        const performance = performanceRecord(details.performance); if (!performance) continue;
        const current = performanceRecord(model.details.performance);
        if (current && Date.parse(current.measuredAt) >= Date.parse(performance.measuredAt)) continue;
        // Keep current discovery authoritative for capabilities, availability, prices and limits.
        model.tokensPerSecond = performance.generationTokensPerSecond;
        model.details.performance = performance;
      }
      this.persistenceFailure = false;
    } catch { this.persistenceFailure = true; }
    if (this.persistenceFailure) for (const model of models) model.details.measurementStorage = 'unavailable';
    await decorateTaskFit(this.store,models);
    return models;
  }

  override async *stream(request: ModelRequest): AsyncGenerator<ModelChunk> {
    request.signal.throwIfAborted();
    const identity = modelIdentity(request.model, await this.identity());
    request.signal.throwIfAborted();
    let measurement: Extract<ModelChunk, { type: 'usage' }> | undefined;
    let terminal: Extract<ModelChunk, { type: 'done' }> | undefined;
    for await (const chunk of super.stream(request)) {
      if (chunk.type === 'usage' && positive(chunk.generationTokensPerSecond) !== null) measurement = chunk;
      // Exhaust the transport before considering its measurement successful.
      if (chunk.type === 'done') terminal = chunk;
      else yield chunk;
    }
    if (terminal && measurement && identity && !request.signal.aborted) {
      const parsed = performanceRecord({ contextTokens: request.contextTokens, generationTokensPerSecond: measurement.generationTokensPerSecond, promptTokensPerSecond: measurement.promptTokensPerSecond, measuredAt: new Date().toISOString(), execution: request.execution });
      if (parsed) {
        const performance: Performance = { ...parsed, source: 'measured' };
        const profile = persistedModel(request.model, identity, performance);
        try {
          await this.store.db.query('INSERT INTO model_profiles(id,profile,measured_at) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET profile=EXCLUDED.profile,measured_at=EXCLUDED.measured_at WHERE model_profiles.measured_at<=EXCLUDED.measured_at', [identity.key, JSON.stringify(profile), performance.measuredAt]);
          this.persistenceFailure = false;
        } catch { this.persistenceFailure = true; }
      }
    }
    if (terminal) yield terminal;
  }
}
