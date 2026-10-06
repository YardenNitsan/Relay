import type { ModelChunk, ModelProfile, ModelRequest, ProviderGateway, ProviderId, ProviderStatus } from '../../shared/types.js';
import { SecretManager } from './secrets.js';
import { anthropicStream, cloudBody, CLOUD_ENDPOINTS, geminiStream, openaiStream } from './cloud.js';
import { compatibleStream, localBody, ollamaStream } from './local.js';
import { cloudModels, lmstudioModels, ollamaModel } from './registry.js';
import { array, object, ProviderError, requireSuccess, string, type JsonObject } from './transport.js';
import { residentSnapshot, type ResidentModelsSnapshot } from './residency.js';

export interface ProvidersOptions { secrets?: SecretManager; fetch?: typeof fetch; ollamaUrl?: string; lmstudioUrl?: string; discoveryTimeoutMs?: number; }
const ids: ProviderId[] = ['ollama', 'lmstudio', 'openai', 'anthropic', 'gemini'];
const names: Record<ProviderId, string> = { ollama: 'Ollama', lmstudio: 'LM Studio', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini' };
function localURL(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Local runtime endpoint must be an HTTP loopback origin');
  return url.origin;
}

export class Providers implements ProviderGateway {
  readonly secrets: SecretManager;
  private readonly fetcher: typeof fetch;
  private readonly bases: Record<ProviderId, string>;
  private readonly timeout: number;
  private readonly disabled = new Set<ProviderId>();
  private readonly health = new Map<ProviderId, ProviderStatus>();
  private readonly models = new Map<ProviderId, ModelProfile[]>();
  private readonly measurements = new Map<string, { digest: unknown; contextTokens: number; generationTokensPerSecond: number; promptTokensPerSecond?: number; measuredAt: string; execution?: { numGpu: number } }>();
  private readonly active = new Map<ProviderId, Set<AbortController>>();
  private refreshed = 0;
  private refreshPending: Promise<void> | null = null;
  constructor(options: ProvidersOptions = {}) {
    this.secrets = options.secrets ?? new SecretManager(); this.fetcher = options.fetch ?? fetch;
    this.bases = { ...CLOUD_ENDPOINTS, ollama: localURL(options.ollamaUrl ?? process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11434'), lmstudio: localURL(options.lmstudioUrl ?? process.env.RELAY_LMSTUDIO_URL ?? 'http://127.0.0.1:1234') };
    this.timeout = options.discoveryTimeoutMs ?? 5000;
  }
  setEnabled(provider: ProviderId, enabled: boolean): void {
    if (enabled) this.disabled.delete(provider);
    else { this.disabled.add(provider); for (const controller of this.active.get(provider) ?? []) controller.abort(new ProviderError('disabled', 'Provider was disabled')); }
    this.refreshed = 0;
  }
  async verify(provider: ProviderId): Promise<ProviderStatus> { await this.discover(provider); return this.health.get(provider)!; }
  private async headers(provider: ProviderId): Promise<Record<string, string>> {
    const key = await this.secrets.get(provider); const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (provider === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
    else if (provider === 'gemini') { if (key) headers['x-goog-api-key'] = key; }
    else if (key) headers.authorization = `Bearer ${key}`;
    return headers;
  }
  private async json(provider: ProviderId, path: string, body?: JsonObject): Promise<JsonObject> {
    const response = await this.fetcher(`${this.bases[provider]}${path}`, { method: body ? 'POST' : 'GET', headers: await this.headers(provider), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(this.timeout), redirect: 'error' });
    requireSuccess(response);
    const text = await response.text(); if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new ProviderError('response_limit', 'Provider discovery response exceeded limit');
    try { return object(JSON.parse(text)); } catch { throw new ProviderError('invalid_json', 'Provider discovery returned invalid JSON'); }
  }
  private async discover(provider: ProviderId): Promise<void> {
    const secret = await this.secrets.status(provider); const local = provider === 'ollama' || provider === 'lmstudio';
    const status: ProviderStatus = { id: provider, name: names[provider], connected: false, configured: local || secret.configured, error: null, secretStorage: secret.storage, enabled: !this.disabled.has(provider), authenticated: local ? null : false, reachable: false, state: 'unconfigured', lastCheckedAt: new Date().toISOString() };
    this.models.set(provider, []);
    if (this.disabled.has(provider)) status.state = 'disabled';
    else if (status.configured) {
      try {
        let models: ModelProfile[];
        if (provider === 'ollama') {
          const tags = await this.json(provider, '/api/tags');
          const running = await this.json(provider, '/api/ps').catch(() => ({}));
          models = [];
          for (const tag of array(tags.models).slice(0, 100).map(object)) {
            const name = string(tag.name || tag.model); if (!name) continue;
            const metadata = await this.json(provider, '/api/show', { model: name }).catch(() => ({}));
            models.push(ollamaModel(tag, metadata, array(object(running).models).map(object).find(item => item.name === name) ?? {}));
          }
        } else if (provider === 'lmstudio') models = lmstudioModels(await this.json(provider, '/api/v1/models'));
        else models = cloudModels(provider, await this.json(provider, '/models'));
        for (const model of models) { const measurement = this.measurements.get(model.id); if (measurement && measurement.digest === model.details.digest) { model.tokensPerSecond = measurement.generationTokensPerSecond; model.details.performance = { ...measurement }; } }
        this.models.set(provider, models); Object.assign(status, { connected: true, reachable: true, authenticated: local ? null : true, state: 'ready' });
      } catch (error) {
        const http = error instanceof ProviderError ? error.status : undefined;
        status.reachable = !!http; status.state = http === 401 || http === 403 ? 'unauthorized' : http === 429 ? 'rate_limited' : http ? 'error' : 'unreachable';
        status.error = http ? `Provider returned HTTP ${http}` : 'Provider is not reachable or returned an invalid response';
      }
    }
    this.health.set(provider, status);
  }
  private async refresh(): Promise<void> {
    if (Date.now() - this.refreshed < 15_000) return;
    if (!this.refreshPending) this.refreshPending = Promise.all(ids.map(id => this.discover(id))).then(() => { this.refreshed = Date.now(); }).finally(() => { this.refreshPending = null; });
    await this.refreshPending;
  }
  async listModels(): Promise<ModelProfile[]> { await this.refresh(); return [...this.models.values()].flat().map(model => ({ ...model, details: { ...model.details } })); }
  async statuses(): Promise<ProviderStatus[]> { await this.refresh(); return ids.map(id => ({ ...this.health.get(id)! })); }
  /** Read-only observation; does not acquire ownership or load/unload a model. */
  async residentModels(): Promise<ResidentModelsSnapshot> {
    const unavailable = (disabled: boolean): ResidentModelsSnapshot => ({ state: disabled ? 'disabled' : 'unavailable', source: 'ollama/api/ps', sampledAt: new Date().toISOString(), models: [], truncated: false, error: disabled ? 'Ollama is disabled' : 'Runtime resident inventory is unavailable' });
    if (this.disabled.has('ollama')) return unavailable(true);
    try {
      const inventory = await this.json('ollama', '/api/ps');
      return this.disabled.has('ollama') ? unavailable(true) : residentSnapshot(inventory);
    } catch { return unavailable(this.disabled.has('ollama')); }
  }
  async *stream(request: ModelRequest): AsyncGenerator<ModelChunk> {
    request.signal.throwIfAborted(); const provider = request.model.provider;
    if (this.disabled.has(provider)) throw new ProviderError('disabled', 'Provider is disabled');
    if (provider === 'ollama' && (!request.model.local || request.model.details.remoteHost || request.model.details.remoteModel)) throw new ProviderError('remote_runtime', 'Ollama remote/cloud forwarding is unsupported; use an authorized direct cloud provider');
    if (!ids.includes(provider)) throw new ProviderError('unsupported_provider', 'Unsupported provider');
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || !Number.isSafeInteger(request.contextTokens) || request.contextTokens <= request.maxOutputTokens) throw new ProviderError('invalid_budget', 'Invalid context or output token budget');
    if (request.tools.length && !request.model.capabilities.tools) throw new ProviderError('tools_unsupported', 'Selected model does not declare tool support');
    const local = provider === 'ollama' || provider === 'lmstudio';
    if (!local && !await this.secrets.get(provider)) throw new ProviderError('unconfigured', 'Provider credential is not configured');
    const suffix = provider === 'ollama' ? '/api/chat' : provider === 'lmstudio' ? '/v1/chat/completions' : provider === 'openai' ? '/responses' : provider === 'anthropic' ? '/messages' : '/interactions';
    const controller = new AbortController();
    const active = this.active.get(provider) ?? new Set<AbortController>(); active.add(controller); this.active.set(provider, active);
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const started = Date.now();
    request.model.state = 'generating';
    try {
      const response = await this.fetcher(`${this.bases[provider]}${suffix}`, { method: 'POST', headers: await this.headers(provider), body: JSON.stringify(local ? localBody(request) : cloudBody(request)), signal, redirect: 'error' });
      requireSuccess(response);
      const adapted = { ...request, signal };
      const stream = provider === 'ollama' ? ollamaStream(response, adapted) : provider === 'lmstudio' ? compatibleStream(response, adapted) : provider === 'openai' ? openaiStream(response, adapted) : provider === 'anthropic' ? anthropicStream(response, adapted) : geminiStream(response, adapted);
      for await (const chunk of stream) {
        signal.throwIfAborted(); if (this.disabled.has(provider)) throw new ProviderError('disabled', 'Provider was disabled');
        if (chunk.type === 'usage' && chunk.generationTokensPerSecond !== undefined) {
          const measurement = { digest: request.model.details.digest, contextTokens: request.contextTokens, generationTokensPerSecond: chunk.generationTokensPerSecond, promptTokensPerSecond: chunk.promptTokensPerSecond, measuredAt: new Date().toISOString(), execution: request.execution };
          this.measurements.set(request.model.id, measurement); request.model.tokensPerSecond = measurement.generationTokensPerSecond; request.model.details.performance = measurement;
        }
        yield chunk;
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('transport_failed', 'Provider connection failed; no automatic replay was attempted');
    } finally { active.delete(controller); request.model.state = 'available'; request.model.details.lastCallDurationMs = Date.now() - started; this.refreshed = 0; }
  }
}
