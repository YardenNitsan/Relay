import type { ModelChunk, ModelProfile, ModelRequest, ProviderGateway, ProviderId, ProviderStatus } from '../../shared/types.js';
import { SecretManager } from './secrets.js';
import { anthropicStream, cloudBody, CLOUD_ENDPOINTS, geminiStream, openaiStream } from './cloud.js';
import { compatibleStream, localBody, ollamaStream } from './local.js';
import { cloudModels, lmstudioModels, ollamaModel } from './registry.js';
import { array, object, ProviderError, requireSuccess, string, type JsonObject } from './transport.js';
import { residentSnapshot, type ResidentModelsSnapshot } from './residency.js';
import { deepseekStream } from './deepseek.js';
import {parseRateLimits} from './limits.js';
import type {ProviderLimitSnapshot} from '../../shared/usage.js';
import type {GoogleOAuth} from './google-oauth.js';
import {googleGenerateBody,googleGeneratePath,googleGenerateStream} from './google-generate.js';

export interface ProvidersOptions { secrets?: SecretManager; fetch?: typeof fetch; ollamaUrl?: string; lmstudioUrl?: string; discoveryTimeoutMs?: number; sharedLocal?: Providers; userSecrets?: (userId:string)=>SecretManager; loadUserPreferences?: (userId:string)=>Promise<Array<{provider:ProviderId;enabled:boolean}>>; }
const ids: ProviderId[] = ['ollama', 'lmstudio', 'openai', 'anthropic', 'gemini', 'xai', 'deepseek'];
const localIds: ProviderId[] = ['ollama', 'lmstudio'];
const cloudIds: ProviderId[] = ['openai', 'anthropic', 'gemini', 'xai', 'deepseek'];
const names: Record<ProviderId, string> = { ollama: 'Ollama', lmstudio: 'LM Studio', openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini', xai: 'Grok (xAI)', deepseek: 'DeepSeek' };
function localURL(raw: string): string {
  const url = new URL(raw);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Local runtime endpoint must be an HTTP loopback origin');
  return url.origin;
}
/** A native vault operation may not itself support cancellation. Stop waiting
 * without allowing its eventual result to dispatch a revoked provider request. */
function cancellable<T>(operation:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const aborted=()=>reject(signal.reason);
    signal.addEventListener('abort',aborted,{once:true});
    operation.then(value=>{signal.removeEventListener('abort',aborted);resolve(value);},error=>{signal.removeEventListener('abort',aborted);reject(error);});
    if(signal.aborted){signal.removeEventListener('abort',aborted);aborted();}
  });
}

export class Providers implements ProviderGateway {
  readonly secrets: SecretManager;
  private readonly fetcher: typeof fetch;
  private readonly bases: Record<ProviderId, string>;
  private readonly timeout: number;
  private readonly disabled = new Set<ProviderId>();
  private readonly health = new Map<ProviderId, ProviderStatus>();
  private readonly models = new Map<ProviderId, ModelProfile[]>();
  private readonly measurements = new Map<string, { digest: unknown; runtimeVersion:unknown; contextTokens: number; generationTokensPerSecond: number; promptTokensPerSecond?: number; measuredAt: string; execution?: { numGpu: number } }>();
  private readonly active = new Map<ProviderId, Set<AbortController>>();
  private readonly refreshed = new Map<ProviderId, number>();
  private readonly refreshPending = new Map<ProviderId, { revision: number; promise: Promise<void> }>();
  private readonly users = new Map<string, Promise<Providers>>();
  private readonly revisions = new Map<ProviderId, number>();
  private readonly limitSnapshots=new Map<string,ProviderLimitSnapshot&{modelId:string;provider:ProviderId}>();
  private googleOAuth:GoogleOAuth|undefined;
  private credentialUserId='owner';
  setGoogleOAuth(service:GoogleOAuth):void {this.googleOAuth=service;}
  googleConfigurationChanged():void {this.credentialsChanged('gemini');for(const pending of this.users.values())void pending.then(gateway=>gateway.credentialsChanged('gemini')).catch(()=>{});}
  rateLimits():Array<ProviderLimitSnapshot&{modelId:string;provider:ProviderId}>{return [...this.limitSnapshots.values()].map(snapshot=>structuredClone(snapshot));}
  constructor(private readonly options: ProvidersOptions = {}) {
    this.secrets = options.secrets ?? new SecretManager(); this.fetcher = options.fetch ?? fetch;
    this.bases = { ...CLOUD_ENDPOINTS, ollama: localURL(options.ollamaUrl ?? process.env.RELAY_OLLAMA_URL ?? 'http://127.0.0.1:11434'), lmstudio: localURL(options.lmstudioUrl ?? process.env.RELAY_LMSTUDIO_URL ?? 'http://127.0.0.1:1234') };
    this.timeout = options.discoveryTimeoutMs ?? 5000;
  }
  /** Identity comes only from a verified principal or the persisted task owner. */
  async forUser(userId:string):Promise<Providers> {
    if(this.options.sharedLocal)throw new ProviderError('scope', 'A personal gateway cannot change credential owner');
    if(userId==='owner')return this;
    if(!/^[a-zA-Z0-9_-]{1,128}$/.test(userId))throw new ProviderError('scope','Invalid credential owner');
    let scoped=this.users.get(userId);
    if(!scoped){
      if(this.users.size>=1000)throw new ProviderError('capacity','Personal provider capacity reached');
      scoped=(async()=>{
        const gateway=new Providers({ ...this.options, sharedLocal:this, secrets:this.options.userSecrets?.(userId)??new SecretManager({userId}) });
        gateway.googleOAuth=this.googleOAuth;gateway.credentialUserId=userId;
        for(const preference of await this.options.loadUserPreferences?.(userId)??[])if(preference.provider!=='ollama'&&preference.provider!=='lmstudio')gateway.setEnabled(preference.provider,preference.enabled);
        return gateway;
      })();
      this.users.set(userId,scoped);
      void scoped.catch(()=>{if(this.users.get(userId)===scoped)this.users.delete(userId);});
    }
    return scoped;
  }
  async revokeUser(userId:string):Promise<void> {
    this.googleOAuth?.invalidate(userId);
    const pending=this.users.get(userId);this.users.delete(userId);
    const gateway=await pending?.catch(()=>undefined);
    if(gateway)for(const provider of cloudIds)gateway.setEnabled(provider,false);
  }
  credentialsChanged(provider:ProviderId,reason=new ProviderError('credentials_changed','Provider credentials changed')):void {
    for(const [id,snapshot]of this.limitSnapshots)if(snapshot.provider===provider)this.limitSnapshots.delete(id);
    this.revisions.set(provider,(this.revisions.get(provider)??0)+1);
    for(const controller of this.active.get(provider)??[])controller.abort(reason);
    this.models.delete(provider);this.health.delete(provider);this.refreshed.delete(provider);
  }
  setEnabled(provider: ProviderId, enabled: boolean): void {
    if(this.options.sharedLocal&&(provider==='ollama'||provider==='lmstudio'))throw new ProviderError('owner_only','Only the owner can manage local runtimes');
    if (enabled) this.disabled.delete(provider);
    else this.disabled.add(provider);
    this.credentialsChanged(provider,enabled?undefined:new ProviderError('disabled','Provider was disabled'));
  }
  async verify(provider: ProviderId): Promise<ProviderStatus> {
    if(this.options.sharedLocal&&localIds.includes(provider))return this.options.sharedLocal.verify(provider);
    await this.refreshProvider(provider,true);
    if(!this.health.has(provider))await this.refreshProvider(provider,true);
    const status=this.health.get(provider);
    if(!status)throw new ProviderError('credentials_changed','Provider changed during verification; try again');
    return {...status};
  }
  private assertCurrent(provider:ProviderId,revision:number,signal?:AbortSignal):void {
    signal?.throwIfAborted();
    if(this.disabled.has(provider))throw new ProviderError('disabled','Provider is disabled');
    if(revision!==(this.revisions.get(provider)??0))throw new ProviderError('credentials_changed','Provider credentials changed');
  }
  private async headers(provider: ProviderId,required=false): Promise<Record<string, string>> {
    if(provider==='gemini'&&this.googleOAuth){const google=await this.googleOAuth.headers(this.credentialUserId);if(google)return {'content-type':'application/json',...google};}
    const key = await this.secrets.get(provider);
    if(required&&!key)throw new ProviderError('unconfigured','Provider credential is not configured');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (provider === 'anthropic') { headers['anthropic-version'] = '2023-06-01'; if (key) headers['x-api-key'] = key; }
    else if (provider === 'gemini') { if (key) headers['x-goog-api-key'] = key; }
    else if (key) headers.authorization = `Bearer ${key}`;
    return headers;
  }
  private async json(provider: ProviderId, path: string, body?: JsonObject): Promise<JsonObject> {
    const revision=this.revisions.get(provider)??0;
    const controller=new AbortController();const active=this.active.get(provider)??new Set<AbortController>();active.add(controller);this.active.set(provider,active);
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(this.timeout)]);
    try {
    const headers=await cancellable(this.headers(provider,!localIds.includes(provider)),signal);
    this.assertCurrent(provider,revision,signal);
    const response = await this.fetcher(`${this.bases[provider]}${path}`, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, signal, redirect: 'error' });
    this.assertCurrent(provider,revision,signal);
    requireSuccess(response);
    const text = await response.text(); if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new ProviderError('response_limit', 'Provider discovery response exceeded limit');
    this.assertCurrent(provider,revision,signal);
    try { return object(JSON.parse(text)); } catch { throw new ProviderError('invalid_json', 'Provider discovery returned invalid JSON'); }
    } finally {active.delete(controller);}
  }
  private async discover(provider: ProviderId): Promise<void> {
    const revision=this.revisions.get(provider)??0;
    let secret = await this.secrets.status(provider); const local = provider === 'ollama' || provider === 'lmstudio';
    if(provider==='gemini'&&this.googleOAuth){try{const google=await this.googleOAuth.status(this.credentialUserId);if(google.connected)secret={configured:true,storage:google.storage};}catch{if(revision===(this.revisions.get(provider)??0)){this.models.set(provider,[]);this.health.set(provider,{id:provider,name:names[provider],connected:false,configured:true,error:'Google credential vault is unavailable. Local models remain available.',secretStorage:'os-keyring',enabled:!this.disabled.has(provider),authenticated:false,reachable:false,state:'unreachable',lastCheckedAt:new Date().toISOString()});}return;}}
    if(revision!==(this.revisions.get(provider)??0))return;
    const status: ProviderStatus = { id: provider, name: names[provider], connected: false, configured: local || secret.configured, error: null, secretStorage: secret.storage, enabled: !this.disabled.has(provider), authenticated: local ? null : false, reachable: false, state: 'unconfigured', lastCheckedAt: new Date().toISOString() };
    this.models.set(provider, []);
    if (this.disabled.has(provider)) status.state = 'disabled';
    else if (status.configured) {
      try {
        let models: ModelProfile[];
        if (provider === 'ollama') {
          const tags = await this.json(provider, '/api/tags');
          const runtimeVersion=string(object(await this.json(provider,'/api/version').catch(()=>({}))).version)||null;
          const running = await this.json(provider, '/api/ps').catch(() => ({}));
          models = [];
          for (const tag of array(tags.models).slice(0, 100).map(object)) {
            const name = string(tag.name || tag.model); if (!name) continue;
            const metadata = await this.json(provider, '/api/show', { model: name }).catch(() => ({}));
            const model=ollamaModel(tag, metadata, array(object(running).models).map(object).find(item => item.name === name) ?? {});model.details.runtimeVersion=runtimeVersion;models.push(model);
          }
        } else if (provider === 'lmstudio') models = lmstudioModels(await this.json(provider, '/api/v1/models'));
        else models = cloudModels(provider, await this.json(provider, '/models'));
        for (const model of models) { const measurement = this.measurements.get(model.id); if (measurement && measurement.digest === model.details.digest && measurement.runtimeVersion===model.details.runtimeVersion) { model.tokensPerSecond = measurement.generationTokensPerSecond; model.details.performance = { ...measurement }; } }
        if(revision!==(this.revisions.get(provider)??0))return;
        this.models.set(provider, models); Object.assign(status, { connected: true, reachable: true, authenticated: local ? null : true, state: 'ready' });
      } catch (error) {
        const http = error instanceof ProviderError ? error.status : undefined;
        status.reachable = !!http; status.state = http === 401 || http === 403 ? 'unauthorized' : http === 429 ? 'rate_limited' : http ? 'error' : 'unreachable';
        status.error = http ? `Provider returned HTTP ${http}` : 'Provider is not reachable or returned an invalid response';
      }
    }
    if(revision===(this.revisions.get(provider)??0))this.health.set(provider, status);
  }
  private async refreshProvider(provider:ProviderId,force=false):Promise<void> {
    if(!force&&this.health.has(provider)&&Date.now()-(this.refreshed.get(provider)??0)<15_000)return;
    const revision=this.revisions.get(provider)??0;
    const pending=this.refreshPending.get(provider);
    if(pending?.revision===revision)return pending.promise;
    const promise=this.discover(provider).then(()=>{
      if(revision===(this.revisions.get(provider)??0)&&this.health.has(provider))this.refreshed.set(provider,Date.now());
    }).finally(()=>{if(this.refreshPending.get(provider)?.promise===promise)this.refreshPending.delete(provider);});
    this.refreshPending.set(provider,{revision,promise});return promise;
  }
  async localModels():Promise<ModelProfile[]> {
    if(this.options.sharedLocal)return this.options.sharedLocal.localModels();
    await Promise.all(localIds.map(id=>this.refreshProvider(id)));
    return localIds.flatMap(id=>this.models.get(id)??[]).map(model=>structuredClone(model));
  }
  async refreshLocalModels():Promise<void> {if(this.options.sharedLocal)return this.options.sharedLocal.refreshLocalModels();await Promise.all(localIds.map(id=>this.refreshProvider(id,true)));}
  async localStatuses():Promise<ProviderStatus[]> {
    if(this.options.sharedLocal)return this.options.sharedLocal.localStatuses();
    await Promise.all(localIds.map(id=>this.refreshProvider(id)));
    return localIds.flatMap(id=>this.health.has(id)?[{...this.health.get(id)!}]:[]);
  }
  async listModels(): Promise<ModelProfile[]> {
    const ownIds=this.options.sharedLocal?cloudIds:ids;
    const [,local]=await Promise.all([Promise.all(ownIds.map(id=>this.refreshProvider(id))),this.options.sharedLocal?.localModels()??[]]);
    return [...local,...ownIds.flatMap(id=>this.models.get(id)??[])].map(model=>structuredClone(model));
  }
  async statuses(): Promise<ProviderStatus[]> {
    const ownIds=this.options.sharedLocal?cloudIds:ids;
    const [,local]=await Promise.all([Promise.all(ownIds.map(id=>this.refreshProvider(id))),this.options.sharedLocal?.localStatuses()??[]]);
    return [...local,...ownIds.flatMap(id=>this.health.has(id)?[{...this.health.get(id)!}]:[])];
  }
  /** Read-only observation; does not acquire ownership or load/unload a model. */
  async residentModels(): Promise<ResidentModelsSnapshot> {
    if(this.options.sharedLocal)return this.options.sharedLocal.residentModels();
    const unavailable = (disabled: boolean): ResidentModelsSnapshot => ({ state: disabled ? 'disabled' : 'unavailable', source: 'ollama/api/ps', sampledAt: new Date().toISOString(), models: [], truncated: false, error: disabled ? 'Ollama is disabled' : 'Runtime resident inventory is unavailable' });
    if (this.disabled.has('ollama')) return unavailable(true);
    try {
      const inventory = await this.json('ollama', '/api/ps');
      return this.disabled.has('ollama') ? unavailable(true) : residentSnapshot(inventory);
    } catch { return unavailable(this.disabled.has('ollama')); }
  }
  async *stream(request: ModelRequest): AsyncGenerator<ModelChunk> {
    request.signal.throwIfAborted(); const provider = request.model.provider;
    if(this.options.sharedLocal&&(provider==='ollama'||provider==='lmstudio')){yield* this.options.sharedLocal.stream(request);return;}
    if (this.disabled.has(provider)) throw new ProviderError('disabled', 'Provider is disabled');
    if (provider === 'ollama' && (!request.model.local || request.model.details.remoteHost || request.model.details.remoteModel)) throw new ProviderError('remote_runtime', 'Ollama remote/cloud forwarding is unsupported; use an authorized direct cloud provider');
    if (!ids.includes(provider)) throw new ProviderError('unsupported_provider', 'Unsupported provider');
    if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || !Number.isSafeInteger(request.contextTokens) || request.contextTokens <= request.maxOutputTokens) throw new ProviderError('invalid_budget', 'Invalid context or output token budget');
    if (request.tools.length && !request.model.capabilities.tools) throw new ProviderError('tools_unsupported', 'Selected model does not declare tool support');
    const local = provider === 'ollama' || provider === 'lmstudio';
    const revision=this.revisions.get(provider)??0;
    const suffix = provider === 'ollama' ? '/api/chat' : provider === 'lmstudio' ? '/v1/chat/completions' : provider === 'openai' || provider === 'xai' ? '/responses' : provider === 'deepseek' ? '/chat/completions' : provider === 'anthropic' ? '/messages' : '/interactions';
    const controller = new AbortController();
    const active = this.active.get(provider) ?? new Set<AbortController>(); active.add(controller); this.active.set(provider, active);
    const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(10 * 60_000)]);
    const started = Date.now();
    request.model.state = 'generating';
    try {
      const headers=await cancellable(this.headers(provider,!local),signal);
      this.assertCurrent(provider,revision,signal);
      const google=provider==='gemini'&&!!headers.authorization;
      const response = await this.fetcher(`${this.bases[provider]}${google?googleGeneratePath(request):suffix}`, { method: 'POST', headers, body: JSON.stringify(google?googleGenerateBody(request):local ? localBody(request) : cloudBody(request)), signal, redirect: 'error' });
      this.assertCurrent(provider,revision,signal);
      const limits=parseRateLimits(provider,response.headers);
      this.limitSnapshots.delete(request.model.id);
      if(limits.length){
        if(this.limitSnapshots.size>=500)this.limitSnapshots.delete(this.limitSnapshots.keys().next().value!);
        this.limitSnapshots.set(request.model.id,{modelId:request.model.id,provider,observedAt:new Date().toISOString(),limits});
      }
      requireSuccess(response);
      const adapted = { ...request, signal };
      const stream = provider === 'ollama' ? ollamaStream(response, adapted) : provider === 'lmstudio' ? compatibleStream(response, adapted) : provider === 'openai' || provider === 'xai' ? openaiStream(response, adapted) : provider === 'deepseek' ? deepseekStream(response, adapted) : provider === 'anthropic' ? anthropicStream(response, adapted) : google ? googleGenerateStream(response, adapted) : geminiStream(response, adapted);
      for await (const chunk of stream) {
        signal.throwIfAborted(); if (this.disabled.has(provider)) throw new ProviderError('disabled', 'Provider was disabled');
        if (chunk.type === 'usage' && chunk.generationTokensPerSecond !== undefined) {
          const measurement = { digest: request.model.details.digest, runtimeVersion:request.model.details.runtimeVersion, contextTokens: request.contextTokens, generationTokensPerSecond: chunk.generationTokensPerSecond, promptTokensPerSecond: chunk.promptTokensPerSecond, measuredAt: new Date().toISOString(), execution: request.execution };
          this.measurements.set(request.model.id, measurement); request.model.tokensPerSecond = measurement.generationTokensPerSecond; request.model.details.performance = measurement;
        }
        yield chunk;
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('transport_failed', 'Provider connection failed; no automatic replay was attempted');
    } finally { active.delete(controller); request.model.state = 'available'; request.model.details.lastCallDurationMs = Date.now() - started; this.refreshed.delete(provider); }
  }
}
