import { describe, expect, it } from 'vitest';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import type { ModelChunk, ModelProfile, ModelRequest } from '../shared/types.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function collect(stream: AsyncIterable<ModelChunk>) { const chunks: ModelChunk[] = []; for await (const chunk of stream) chunks.push(chunk); return chunks; }
function cloudRequest(): ModelRequest {
  const model: ModelProfile = { id: 'openai/gpt-fixture', name: 'gpt-fixture', provider: 'openai', runtime: 'openai', local: false, capabilities: { tools: false, vision: false, reasoning: false, structured: true }, contextWindow: 8192, quantization: null, sizeBytes: null, state: 'available', details: {}, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null };
  return { model, messages: [{ role: 'user', content: 'Private request' }], tools: [], contextTokens: 4096, maxOutputTokens: 512, signal: new AbortController().signal };
}

describe('personal provider boundary', () => {
  it('refreshes newly installed local models on demand across user gateways without cloud discovery',async()=>{
    let installed=['first'],tags=0;
    const owner=new Providers({secrets:new SecretManager({env:{},keyring:null}),userSecrets:userId=>new SecretManager({userId,keyring:null}),fetch:async url=>{
      const path=new URL(String(url)).pathname;
      if(path==='/api/tags'){tags++;return Response.json({models:installed.map(name=>({name,digest:name,size:100}))});}
      if(path==='/api/version')return Response.json({version:'fixture'});
      if(path==='/api/show')return Response.json({capabilities:['completion','tools'],model_info:{'general.architecture':'llama','llama.context_length':8192}});
      return Response.json({models:[]});
    }});
    const alice=await owner.forUser('alice'),bob=await owner.forUser('bob');
    expect((await alice.localModels()).map(m=>m.name)).toEqual(['first']);
    installed=['first','new-download'];
    await Promise.all([alice.refreshLocalModels(),bob.refreshLocalModels()]);
    expect((await alice.localModels()).map(m=>m.name)).toEqual(installed);
    expect((await bob.localModels()).map(m=>m.name)).toEqual(installed);
    expect(tags).toBe(2);
  });
  it('shares local discovery without ever authenticating a remote listing with owner cloud credentials', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    const owner = new Providers({ secrets: new SecretManager({ env: { OPENAI_API_KEY: 'owner-only-key' }, keyring: null }), userSecrets: userId => new SecretManager({ userId, keyring: null }), fetch: async (url, init) => {
      requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') });
      return Response.json({ models: [] });
    } });
    const [alice, bob] = await Promise.all([owner.forUser('alice'), owner.forUser('bob')]);
    await Promise.all([alice.listModels(), alice.statuses(), bob.listModels(), bob.statuses()]);
    expect(requests.some(request => request.url.includes('api.openai.com'))).toBe(false);
    expect(requests.some(request => request.authorization?.includes('owner-only-key'))).toBe(false);
    expect(requests.filter(request => request.url.endsWith('/api/tags'))).toHaveLength(1);
    expect(requests.filter(request => request.url.endsWith('/api/v1/models'))).toHaveLength(1);
  });
  it.each(['disable', 'rotate'] as const)('does not dispatch inference when credentials %s while a keyring read is pending', async action => {
    const started = deferred<void>(), release = deferred<string>(); let first = true; let requests = 0;
    const secrets = new SecretManager({ env: {}, keyring: { entry: () => ({ getPassword: () => { if (first) { first = false; started.resolve(); return release.promise; } return 'old-key'; }, setPassword: () => {}, deletePassword: () => {} }) } });
    const gateway = new Providers({ secrets, fetch: async () => { requests++; return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'); } });
    const outcome = collect(gateway.stream(cloudRequest())).then(() => null, error => error as Error);
    await started.promise;
    if (action === 'disable') gateway.setEnabled('openai', false);
    else { await secrets.set('openai', 'replacement-key', false); gateway.credentialsChanged('openai'); }
    release.resolve('old-key');
    expect(await outcome).toBeInstanceOf(Error);
    expect(requests).toBe(0);
  });
  it('cancels inference without waiting for an unavailable native keyring to return', async () => {
    const started = deferred<void>(), release = deferred<string>();
    const secrets = new SecretManager({ env: {}, keyring: { entry: () => ({ getPassword: () => { started.resolve(); return release.promise; }, setPassword: () => {}, deletePassword: () => {} }) } });
    const gateway = new Providers({ secrets, fetch: async () => { throw new Error('No request may be dispatched'); } });
    const outcome = collect(gateway.stream(cloudRequest())).then(() => 'completed', () => 'cancelled');
    await started.promise; gateway.setEnabled('openai', false);
    const observed = await Promise.race([outcome, new Promise<string>(resolve => setTimeout(() => resolve('still waiting for keyring'), 100))]);
    release.resolve('obsolete-key'); await outcome;
    expect(observed).toBe('cancelled');
  });
  it('does not cache an obsolete refresh as fresh after credentials are removed', async () => {
    const started = deferred<void>(), release = deferred<Response>();
    const secrets = new SecretManager({ env: { OPENAI_API_KEY: 'obsolete-key' }, keyring: null });
    const gateway = new Providers({ secrets, fetch: async url => {
      if (String(url).includes('api.openai.com')) { started.resolve(); return release.promise; }
      return Response.json({ models: [] });
    } });
    const pending = gateway.listModels(); await started.promise;
    gateway.credentialsChanged('openai'); await secrets.remove('openai');
    release.resolve(Response.json({ data: [{ id: 'gpt-obsolete' }] }));
    expect((await pending).filter(model => !model.local)).toEqual([]);
    expect((await gateway.statuses()).find(provider => provider.id === 'openai')?.state).toBe('unconfigured');
    expect((await gateway.listModels()).filter(model => !model.local)).toEqual([]);
  });
  it('keeps request credentials isolated and revokes only the selected user without erasing their saved vault entries', async () => {
    const persisted = new Map<string, string>(); const started = deferred<void>();
    const sent: string[] = [];
    const owner = new Providers({ secrets: new SecretManager({ env: { OPENAI_API_KEY: 'owner-key' }, keyring: null }), userSecrets: userId => new SecretManager({ userId, keyring: { entry: provider => ({
      getPassword: () => persisted.get(`${userId}/${provider}`), setPassword: value => { persisted.set(`${userId}/${provider}`, value); }, deletePassword: () => { persisted.delete(`${userId}/${provider}`); },
    }) } }), fetch: async (_url, init) => {
      const authorization = new Headers(init?.headers).get('authorization')!; sent.push(authorization);
      if (authorization === 'Bearer alice-session-key') {
        return new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }); started.resolve(); });
      }
      return new Response('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n');
    } });
    const alice = await owner.forUser('alice'), bob = await owner.forUser('bob');
    await alice.secrets.set('openai', 'alice-session-key', false); await alice.secrets.set('anthropic', 'alice-persisted-key', true); await bob.secrets.set('openai', 'bob-session-key', false);
    const running = collect(alice.stream(cloudRequest())).then(() => null, error => error as Error); await started.promise;
    const bobResult = await collect(bob.stream(cloudRequest()));
    await owner.revokeUser('alice');
    expect(await running).toBeInstanceOf(Error);
    expect(bobResult.at(-1)).toMatchObject({ type: 'done' });
    expect(sent).toEqual(['Bearer alice-session-key', 'Bearer bob-session-key']);
    const renewed = await owner.forUser('alice');
    expect(renewed).not.toBe(alice);
    expect(await renewed.secrets.get('openai')).toBeNull();
    expect(await renewed.secrets.get('anthropic')).toBe('alice-persisted-key');
    expect(await bob.secrets.get('openai')).toBe('bob-session-key');
    expect(await owner.secrets.get('openai')).toBe('owner-key');
  });
  it('returns independent local capability and metadata snapshots to different users', async () => {
    const owner = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), userSecrets: userId => new SecretManager({ userId, keyring: null }), fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/tags') return Response.json({ models: [{ name: 'fixture', size: 100 }] });
      if (path === '/api/show') return Response.json({ capabilities: ['tools'], model_info: { architecture: 'fixture', nested: { value: 'untouched' } } });
      return Response.json({ models: [] });
    } });
    const alice = await owner.forUser('alice'), bob = await owner.forUser('bob');
    const first = (await alice.listModels())[0];
    first.capabilities.tools = false;
    (first.details.modelInfo as { nested: { value: string } }).nested.value = 'modified';
    const second = (await bob.listModels())[0];
    expect(second.capabilities.tools).toBe(true);
    expect(second.details.modelInfo).toMatchObject({ nested: { value: 'untouched' } });
  });
  it('never inherits owner environment credentials for a personal vault', async () => {
    const secrets = new SecretManager({ userId: 'friend', env: { OPENAI_API_KEY: 'owner-secret' }, keyring: null });
    expect(await secrets.get('openai')).toBeNull();
  });
  it('isolates models, credentials and enabled state while sharing local runtime discovery', async () => {
    const observed: string[] = [];
    const owner = new Providers({
      secrets: new SecretManager({ env: { OPENAI_API_KEY: 'owner-secret' }, keyring: null }),
      userSecrets: id => new SecretManager({ userId: id, keyring: null }),
      fetch: async (url, init) => {
        const auth = new Headers(init?.headers).get('authorization') ?? '';
        observed.push(auth);
        if(String(url).includes('api.openai.com'))return Response.json({ data: [{ id: auth.includes('alice') ? 'gpt-alice' : 'gpt-owner' }] });
        return Response.json({ models: [] });
      },
    });
    const [alice, sameAlice, bob] = await Promise.all([owner.forUser('alice'), owner.forUser('alice'), owner.forUser('bob')]);
    expect(alice).toBe(sameAlice); expect(await owner.forUser('owner')).toBe(owner);
    expect((await alice.statuses()).find(p => p.id === 'openai')?.configured).toBe(false);
    await alice.secrets.set('openai', 'alice-secret', false); await alice.verify('openai');
    expect((await alice.listModels()).filter(m => !m.local).map(m => m.id)).toEqual(['openai/gpt-alice']);
    expect((await bob.listModels()).filter(m => !m.local)).toEqual([]);
    alice.setEnabled('openai', false);
    expect((await owner.statuses()).find(p => p.id === 'openai')?.enabled).toBe(true);
    expect(await owner.secrets.get('openai')).toBe('owner-secret');
    expect(await bob.secrets.get('openai')).toBeNull();
    expect(observed).toContain('Bearer alice-secret');
    expect(() => alice.setEnabled('ollama', false)).toThrow(/owner/i);
  });
  it('loads personal enabled preferences once even under concurrent requests', async () => {
    let loads = 0;
    const owner = new Providers({ userSecrets: id => new SecretManager({ userId: id, keyring: null }), loadUserPreferences: async () => { loads++; return [{ provider: 'openai', enabled: false }]; }, fetch: async () => Response.json({ models: [] }) });
    const [a, b] = await Promise.all([owner.forUser('friend'), owner.forUser('friend')]);
    expect(a).toBe(b); expect(loads).toBe(1);
    expect((await a.statuses()).find(p => p.id === 'openai')?.state).toBe('disabled');
  });
});
