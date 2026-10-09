import { describe, expect, it } from 'vitest';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { ndjson, sse } from '../server/providers/transport.js';
import { ollamaModel } from '../server/providers/registry.js';
import type {LmStudioRuntime} from '../server/providers/lmstudio-runtime.js';
import type { ModelChunk, ModelProfile, ModelRequest, ProviderId } from '../shared/types.js';

const model = (provider: ProviderId): ModelProfile => ({ id: `${provider}/test-model`, name: 'test-model', provider, runtime: provider, local: provider === 'ollama', capabilities: { tools: true, vision: false, reasoning: false, structured: true }, contextWindow: 8192, quantization: null, sizeBytes: null, state: 'available', details: {}, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null });
function chunks(body: string): Response {
  const bytes = new TextEncoder().encode(body);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }));
}
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> { const values: T[] = []; for await (const value of source) values.push(value); return values; }
const request = (provider: ProviderId): ModelRequest => ({ model: model(provider), messages: [{ role: 'system', content: 'Use tools safely' }, { role: 'user', content: 'Read résumé.txt' }], tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }], contextTokens: 4096, maxOutputTokens: 512, signal: new AbortController().signal });
const event = (data: unknown): string => `data: ${JSON.stringify(data)}\n\n`;
function gateway(provider: ProviderId, body: string, capture: (url: string, body: Record<string, unknown>) => void = () => {}) {
  const secrets = new SecretManager({ env: { [`${provider.toUpperCase()}_API_KEY`]: 'never-log-this-key' }, keyring: null });
  return new Providers({ secrets, lmstudioRuntime:{load:async()=>({identifier:'relay-test',unload:async()=>{}})} as unknown as LmStudioRuntime, fetch: async (url, init) => { capture(String(url), JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>); return chunks(body); } });
}

describe('provider wire boundaries', () => {
  it('retains Gemini terminal usage and refuses truncated arguments before any tool dispatch',async()=>{
    const body=[{event_type:'step.start',index:0,step:{type:'function_call',id:'partial',name:'read_file'}},{event_type:'step.delta',index:0,delta:{type:'arguments_delta',arguments:'{"path":'}},{event_type:'step.stop',index:0},{event_type:'interaction.completed',interaction:{status:'incomplete',usage:{total_input_tokens:10,total_output_tokens:20}}}].map(event).join('');
    const values:ModelChunk[]=[];
    await expect((async()=>{for await(const value of gateway('gemini',body).stream(request('gemini')))values.push(value);})()).rejects.toMatchObject({code:'incomplete_stream'});
    expect(values).toContainEqual({type:'usage',inputTokens:10,outputTokens:20});
    expect(values.some(value=>value.type==='tool_call'||value.type==='continuation'||value.type==='done')).toBe(false);
  });
  it.each(['ollama','lmstudio','openai','anthropic'] as const)('preserves %s usage and refuses truncated tool dispatch at its output limit',async provider=>{
    const body=provider==='ollama'?JSON.stringify({done:true,done_reason:'length',message:{content:'Partial',tool_calls:[{function:{name:'read_file',arguments:{path:'x'}}}]},prompt_eval_count:10,eval_count:20}):
      provider==='lmstudio'?event({choices:[{delta:{content:'Partial'},finish_reason:'length'}],usage:{prompt_tokens:10,completion_tokens:20}})+'data: [DONE]\n\n':
      provider==='openai'?event({type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{input_tokens:10,output_tokens:20}}}):
      [event({type:'message_start',message:{usage:{input_tokens:10}}}),event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'partial',name:'read_file'}}),event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"path":'}}),event({type:'content_block_stop',index:0}),event({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:20}}),event({type:'message_stop'})].join('');
    const values:ModelChunk[]=[];
    await expect((async()=>{for await(const value of gateway(provider,body).stream(request(provider)))values.push(value);})()).rejects.toMatchObject({code:'output_limit'});
    expect(values.find(value=>value.type==='usage')).toMatchObject({inputTokens:10,outputTokens:20});
    expect(values.some(value=>value.type==='tool_call'||value.type==='continuation'||value.type==='done')).toBe(false);
  });
  it('measures uncached prompt throughput and model load separately',async()=>{
    const result=await collect(gateway('ollama',JSON.stringify({message:{content:'Answer'},done:true,done_reason:'stop',prompt_eval_count:100,prompt_eval_cached_count:80,prompt_eval_duration:1e9,eval_count:10,eval_duration:5e8,load_duration:2e8,total_duration:2e9})).stream(request('ollama')));
    expect(result.find(chunk=>chunk.type==='usage')).toMatchObject({promptTokensPerSecond:20,cachedInputTokens:80,loadDurationMs:200,generationTokensPerSecond:20,durationMs:2000});
  });
  it('decodes UTF-8 split across network chunks and CRLF SSE framing', async () => {
    expect(await collect(sse(chunks('event: message\r\ndata: {"text":"résumé 🎸"}\r\n\r\n')))).toEqual([{ text: 'résumé 🎸' }]);
  });
  it('handles a final NDJSON record without newline', async () => { expect(await collect(ndjson(chunks('{"done":false}\n{"done":true}')))).toEqual([{ done: false }, { done: true }]); });
  it('rejects an oversized unterminated record', async () => { await expect(collect(ndjson(chunks('x'.repeat(100)), 50))).rejects.toThrow(/limit/i); });
  it('requires an Ollama completion record instead of treating EOF as success', async () => {
    await expect(collect(gateway('ollama', JSON.stringify({ message: { role: 'assistant', content: 'partial' }, done: false }) + '\n').stream(request('ollama')))).rejects.toThrow(/incomplete/i);
  });
  it('normalizes Ollama tools and usage without exposing thinking', async () => {
    const result = await collect(gateway('ollama', [JSON.stringify({ message: { role: 'assistant', thinking: 'private', content: 'Hello', tool_calls: [{ function: { name: 'read_file', arguments: { path: 'README.md' } } }] }, done: false }), JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 30, eval_count: 5 })].join('\n')).stream(request('ollama')));
    expect(result.filter(x => x.type === 'text')).toEqual([{ type: 'text', text: 'Hello' }]);
    expect(result.find(x => x.type === 'tool_call')).toMatchObject({ call: { name: 'read_file', arguments: { path: 'README.md' } } });
    expect(result.find(x => x.type === 'usage')).toMatchObject({ inputTokens: 30, outputTokens: 5 });
    expect(JSON.stringify(result.filter(x => x.type !== 'continuation'))).not.toContain('private');
  });
  it('preserves the runtime thinking parser for thinking-only Ollama models', async () => {
    const input = request('ollama'); input.model.capabilities.reasoning = true;
    input.model.details = { modelInfo: { 'general.finetune': 'Thinking' } };
    let sent: Record<string, unknown> = {};
    const body = JSON.stringify({ message: { thinking: 'private', content: 'Answer' }, done: true, done_reason: 'stop' });
    const response = await collect(gateway('ollama', body, (_url, data) => { sent = data; }).stream(input));
    expect(sent).not.toHaveProperty('think');
    expect(response.filter(chunk => chunk.type === 'text')).toEqual([{ type: 'text', text: 'Answer' }]);
  });
  it.each(['<think>private</think>Answer', 'Before<think>private</think>After', '<think>private without closing tag'])('withholds explicit thinking tags across every token boundary: %s', async content => {
    const body = [...content].map(char => JSON.stringify({ message: { content: char }, done: false })).concat(JSON.stringify({ done: true, done_reason: 'stop' })).join('\n');
    const response = await collect(gateway('ollama', body).stream(request('ollama')));
    const visible = response.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('');
    expect(visible).toBe(content.startsWith('Before') ? 'BeforeAfter' : content.endsWith('Answer') ? 'Answer' : '');
    expect(JSON.stringify(response.filter(chunk => chunk.type !== 'continuation'))).not.toContain('private');
  });
  it('flushes ordinary partial angle-bracket text at completed stream end', async () => {
    const body = JSON.stringify({ message: { content: 'Literal <thi' }, done: true, done_reason: 'stop' });
    const response = await collect(gateway('ollama', body).stream(request('ollama')));
    expect(response.filter(chunk => chunk.type === 'text').map(chunk => chunk.text).join('')).toBe('Literal <thi');
  });
  it('uses Responses schemas, preserves continuation and validates complete function arguments', async () => {
    let sent: Record<string, unknown> = {};
    const body = [event({ type: 'response.output_text.delta', delta: 'Checking.' }), event({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' } }), event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' }, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"path":"README.md"}' }], usage: { input_tokens: 40, output_tokens: 8 } } })].join('');
    const result = await collect(gateway('openai', body, (url, data) => { expect(url).toBe('https://api.openai.com/v1/responses'); sent = data; }).stream(request('openai')));
    expect(sent).toMatchObject({ stream: true, store: false, model: 'test-model', tools: [{ type: 'function', name: 'read_file' }] });
    expect(result.filter(x => x.type === 'tool_call')).toHaveLength(1);
    expect(result.find(x => x.type === 'continuation')).toMatchObject({ providerData: { provider: 'openai' } });
  });
  it('rejects invalid tool arguments before yielding a callable proposal', async () => {
    const emitted: ModelChunk[] = [];
    try { for await (const chunk of gateway('openai', event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'function_call', call_id: '1', name: 'read_file', arguments: '[]' }] } })).stream(request('openai'))) emitted.push(chunk); } catch (error) { expect(String(error)).toMatch(/arguments/i); }
    expect(emitted.some(x => x.type === 'tool_call')).toBe(false);
    expect(emitted.some(x => x.type === 'done')).toBe(false);
  });
  it('recognizes a provider error after successful HTTP status', async () => {
    await expect(collect(gateway('anthropic', event({ type: 'error', error: { type: 'overloaded_error', message: 'sensitive request details' } })).stream(request('anthropic')))).rejects.toThrow(/overloaded_error/);
  });
  it('assembles Anthropic tool JSON and cumulative usage', async () => {
    const body = [{ type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 7 }, content: [] } }, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_1', name: 'read_file', input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"README.md"}' } }, { type: 'content_block_stop', index: 0 }, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }, { type: 'message_stop' }].map(event).join('');
    const result = await collect(gateway('anthropic', body).stream(request('anthropic')));
    expect(result.find(x => x.type === 'tool_call')).toMatchObject({ call: { id: 'tool_1', arguments: { path: 'README.md' } } });
    expect(result.find(x => x.type === 'usage')).toMatchObject({ inputTokens: 27, outputTokens: 9 });
  });
  it('handles current Gemini Interactions arguments_delta and requires_action', async () => {
    let sent: Record<string, unknown> = {};
    const body = [{ event_type: 'step.start', index: 0, step: { type: 'function_call', id: 'gem_1', name: 'read_file', arguments: {} } }, { event_type: 'step.delta', index: 0, delta: { type: 'arguments_delta', arguments: '{"path":"README.md"}' } }, { event_type: 'step.stop', index: 0 }, { event_type: 'interaction.completed', interaction: { status: 'requires_action', usage: { total_input_tokens: 15, total_output_tokens: 4 } } }].map(event).join('');
    const result = await collect(gateway('gemini', body, (url, data) => { expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions'); sent = data; }).stream(request('gemini')));
    expect(sent.store).toBe(false);
    expect(result.find(x => x.type === 'tool_call')).toMatchObject({ call: { id: 'gem_1', name: 'read_file', arguments: { path: 'README.md' } } });
    expect(result.at(-1)).toEqual({ type: 'done', finishReason: 'requires_action' });
  });
  it('never starts a request after cancellation', async () => {
    let called = false;
    const provider = new Providers({ fetch: async () => { called = true; return chunks(''); } });
    const input = request('ollama'); input.signal = AbortSignal.abort();
    await expect(collect(provider.stream(input))).rejects.toThrow();
    expect(called).toBe(false);
  });
  it('rejects non-loopback local runtime configuration', () => { expect(() => new Providers({ ollamaUrl: 'http://example.org:11434' })).toThrow(/loopback/i); });
  it('enforces CPU admission through the actual Ollama options payload', async () => {
    let sent: Record<string, unknown> = {}; const input = request('ollama'); input.execution = { numGpu: 0 };
    await collect(gateway('ollama', JSON.stringify({ done: true, done_reason: 'stop', message: { content: 'ok' } }), (_url, data) => { sent = data; }).stream(input));
    expect(sent).toMatchObject({ options: { num_gpu: 0, num_ctx: 4096, num_predict: 512 } });
  });
  it('aborts an in-flight transport when its provider is disabled', async () => {
    let began!: () => void; const started = new Promise<void>(resolve => { began = resolve; });
    const providers = new Providers({ fetch: async (_url, options) => { began(); return new Promise<Response>((_resolve, reject) => { options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }); }); } });
    const running = collect(providers.stream(request('ollama')));
    await started; providers.setEnabled('ollama', false);
    await expect(Promise.race([running, new Promise((_, reject) => setTimeout(() => reject(new Error('disable did not abort')), 100))])).rejects.toThrow(/disabled/i);
  });
  it('does not call cloud discovery when no key is configured', async () => {
    const urls: string[] = [];
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async url => { urls.push(String(url)); return Response.json({ models: [] }); } });
    const statuses = await providers.statuses();
    expect(urls.every(url => url.startsWith('http://127.0.0.1:'))).toBe(true);
    expect(statuses.find(status => status.id === 'openai')).toMatchObject({ configured: false, state: 'unconfigured', error: null });
  });
  it('never treats a cloud model behind loopback Ollama as local execution', async () => {
    const remote = ollamaModel({ name: 'custom-alias', size: 5000, remote_model: 'remote-model', remote_host: 'https://ollama.com' }, { capabilities: ['completion', 'tools'] }, {});
    expect(remote).toMatchObject({ local: false, state: 'offline' });
    let called = false; const providers = new Providers({ fetch: async () => { called = true; return chunks(''); } });
    const input = request('ollama'); input.model = remote;
    await expect(collect(providers.stream(input))).rejects.toThrow(/remote|cloud/i);
    expect(called).toBe(false);
  });
  it('discovers Ollama attention metadata without claiming installed models are loaded', async () => {
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/tags') return Response.json({ models: [{ name: 'qwen:8b', size: 4_000_000_000, digest: 'abc', details: { quantization_level: 'Q4_K_M' } }] });
      if (path === '/api/show') return Response.json({ capabilities: ['completion', 'tools'], model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 } });
      return Response.json({ models: [] });
    } });
    expect((await providers.listModels()).find(item => item.provider === 'ollama')).toMatchObject({ state: 'available', capabilities: { tools: true }, contextWindow: 32768, tokensPerSecond: null });
  });
  it('observes resident allocation using only a fresh read-only runtime request', async () => {
    const requests: string[] = [];
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async (url, options) => {
      requests.push(`${options?.method} ${new URL(String(url)).pathname}`);
      return Response.json({ models: [{ name: 'test:4b', digest: 'digest', size: 3_000_000_000, size_vram: 2_500_000_000, context_length: 8192, expires_at: '2026-10-05T20:00:00Z' }] });
    } });
    const snapshot = await providers.residentModels();
    expect(requests).toEqual(['GET /api/ps']);
    expect(snapshot).toMatchObject({ state: 'observed', source: 'ollama/api/ps', models: [{ id: 'ollama/test:4b', digest: 'digest', reportedBytes: 3_000_000_000, gpuBytes: 2_500_000_000, contextTokens: 8192 }] });
    expect(Number.isFinite(Date.parse(snapshot.sampledAt))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/peak|calibrated/);
  });
  it('keeps unavailable resident measurements unknown and never invents allocation', async () => {
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async () => Response.json({ models: [{ name: 'test:4b', size: -1, size_vram: '1000', context_length: 0 }] }) });
    expect((await providers.residentModels()).models[0]).toMatchObject({ reportedBytes: null, gpuBytes: null, contextTokens: null, digest: null, expiresAt: null });
    providers.setEnabled('ollama', false);
    expect(await providers.residentModels()).toMatchObject({ state: 'disabled', models: [] });
  });
  it('reports an unavailable resident inventory without exposing runtime error text', async () => {
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async () => new Response('private-error-content', { status: 503 }) });
    const snapshot = await providers.residentModels();
    expect(snapshot).toMatchObject({ state: 'unavailable', models: [] });
    expect(JSON.stringify(snapshot)).not.toContain('private-error-content');
  });
  it('reports authentication failure without returning provider response secrets', async () => {
    const providers = new Providers({ secrets: new SecretManager({ env: { OPENAI_API_KEY: 'key' }, keyring: null }), fetch: async () => new Response('secret-server-body', { status: 401 }) });
    const status = await providers.verify('openai');
    expect(status).toMatchObject({ state: 'unauthorized', reachable: true, authenticated: false });
    expect(JSON.stringify(status)).not.toContain('secret-server-body');
  });
  it('retains measured generation throughput across model discovery refreshes', async () => {
    const providers = new Providers({ secrets: new SecretManager({ env: {}, keyring: null }), fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (path === '/api/tags') return Response.json({ models: [{ name: 'test-model', size: 100, digest: 'unchanged', details: {} }] });
      if (path === '/api/show') return Response.json({ capabilities: ['completion', 'tools'] });
      if (path === '/api/chat') return chunks(JSON.stringify({ done: true, done_reason: 'stop', message: { content: 'OK' }, prompt_eval_count: 40, prompt_eval_duration: 2_000_000_000, eval_count: 10, eval_duration: 1_000_000_000 }));
      return Response.json({ models: [] });
    } });
    const selected = (await providers.listModels()).find(model => model.provider === 'ollama')!;
    const input = request('ollama'); input.model = selected;
    const response = await collect(providers.stream(input));
    expect(response.find(chunk => chunk.type === 'usage')).toMatchObject({ generationTokensPerSecond: 10, promptTokensPerSecond: 20 });
    expect((await providers.listModels()).find(model => model.id === selected.id)).toMatchObject({ tokensPerSecond: 10, details: { performance: { contextTokens: 4096, generationTokensPerSecond: 10 } } });
  });
  it('returns provider-native continuation exactly on subsequent OpenAI tool turns', async () => {
    const input = request('openai');
    input.messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'read_file', arguments: {} }], providerData: { provider: 'openai', data: [{ type: 'reasoning', encrypted_content: 'opaque-state' }, { type: 'function_call', call_id: 'a', name: 'read_file', arguments: '{}' }] } }, { role: 'tool', content: 'file content', toolCallId: 'a' });
    let sent: Record<string, unknown> = {};
    await collect(gateway('openai', event({ type: 'response.completed', response: { status: 'completed', output: [] } }), (_url, data) => { sent = data; }).stream(input));
    expect(sent.input).toEqual([{ role: 'user', content: 'Read résumé.txt' }, { type: 'reasoning', encrypted_content: 'opaque-state' }, { type: 'function_call', call_id: 'a', name: 'read_file', arguments: '{}' }, { type: 'function_call_output', call_id: 'a', output: 'file content' }]);
  });
  it.each([
    ['openai', event({ type: 'response.completed', response: { status: 'completed', output: [] } })],
    ['openai', event({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: -1, output_tokens: 2 } } })],
    ['anthropic', [{ type: 'message_start', message: {} }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }].map(event).join('')],
    ['gemini', event({ event_type: 'interaction.completed', interaction: { status: 'completed' } })],
    ['ollama', JSON.stringify({ done: true, done_reason: 'stop', message: { content: 'ok' } })],
  ] as const)('does not invent zero usage when %s omits valid billing metrics', async (provider, body) => {
    const response = await collect(gateway(provider, body).stream(request(provider)));
    expect(response.some(chunk => chunk.type === 'usage')).toBe(false);
    expect(response.at(-1)?.type).toBe('done');
  });
  it('rejects a truncated tool argument stream without any emitted tool calls', async () => {
    const emitted: ModelChunk[] = []; let failure: unknown;
    try { for await (const chunk of gateway('anthropic', [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: '1', name: 'read_file', input: {} } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":' } }, { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 512 } }, { type: 'message_stop' }].map(event).join('')).stream(request('anthropic'))) emitted.push(chunk); } catch (error) { failure = error; }
    expect(String(failure)).toMatch(/incomplete/i); expect(emitted.some(chunk => chunk.type === 'tool_call')).toBe(false);
  });
});

describe('credential boundary', () => {
  it('accurately reports OS-backed storage after saving and removes the persistent entry', async () => {
    let saved: string | null = null;
    const secrets = new SecretManager({ env: {}, keyring: { entry: () => ({ getPassword: () => saved, setPassword: password => { saved = password; }, deletePassword: () => { saved = null; } }) } });
    await secrets.set('openai', 'key', true);
    expect(await secrets.status('openai')).toEqual({ configured: true, storage: 'os-keyring' });
    await secrets.remove('openai');
    expect(saved).toBeNull();
    expect(await secrets.status('openai')).toEqual({ configured: false, storage: 'none' });
  });
  it('keeps session credentials out of status and masks removed environment keys', async () => {
    const secrets = new SecretManager({ env: { OPENAI_API_KEY: 'environment-key' }, keyring: null });
    expect(await secrets.get('openai')).toBe('environment-key');
    await secrets.set('openai', 'session-secret', false);
    expect(await secrets.get('openai')).toBe('session-secret');
    expect(JSON.stringify(await secrets.status('openai'))).not.toContain('secret');
    await secrets.remove('openai');
    expect(await secrets.get('openai')).toBeNull();
  });
  it('fails closed on persistent credential storage failure without plaintext fallback', async () => {
    const secrets = new SecretManager({ env: {}, keyring: null });
    await expect(secrets.set('openai', 'key', true)).rejects.toThrow(/keyring/i);
    expect(await secrets.get('openai')).toBeNull();
  });
});
