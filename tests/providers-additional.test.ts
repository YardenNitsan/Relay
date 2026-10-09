import { describe, expect, it } from 'vitest';
import { Providers } from '../server/providers/index.js';
import { SecretManager } from '../server/providers/secrets.js';
import { cloudBody } from '../server/providers/cloud.js';
import { cloudModels, profile } from '../server/providers/registry.js';
import { buildContext } from '../server/orchestration/context.js';
import { safeHttpRequestForRecord } from '../server/tools/network-policy.js';
import type { ModelChunk, ModelRequest, ProviderId } from '../shared/types.js';

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const collect = async (source: AsyncIterable<ModelChunk>) => { const result: ModelChunk[] = []; for await (const value of source) result.push(value); return result; };
function request(provider: ProviderId): ModelRequest {
  const model = profile(provider, provider === 'xai' ? 'grok-4.7' : 'deepseek-flash'); model.capabilities.tools = true;
  return { model, messages: [{ role: 'system', content: 'Keep tool authority separate.' }, { role: 'user', content: 'Read a file.' }], tools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object', properties: {} } }], contextTokens: 8192, maxOutputTokens: 1024, signal: new AbortController().signal };
}
const credentials = () => new SecretManager({ env: { XAI_API_KEY: 'xai-test-secret', DEEPSEEK_API_KEY: 'deepseek-test-secret' }, keyring: null });
const deepseek = (finish = 'tool_calls', name = 'read_file') => [
  event({ choices: [{ index: 0, delta: { reasoning_content: 'private reasoning', content: 'Checking.', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name, arguments: '{"path":' } }] } }] }),
  event({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"a.txt"}' } }] }, finish_reason: finish }] }),
  event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, prompt_cache_hit_tokens: 4 } }),
  'data: [DONE]\n\n',
].join('');

describe('Grok and DeepSeek provider boundaries', () => {
  it('admits the documented Grok Build coding model for broker tools', () => {
    const [model] = cloudModels('xai', { data: [{ id: 'grok-build-0.1' }] });
    expect(model).toMatchObject({ capabilities: { tools: true }, inputPricePerMillion: null, outputPricePerMillion: null });
  });
  it('disables DeepSeek thinking for tool requests with ordinary conversation history', () => {
    const input = request('deepseek');
    input.messages = buildContext('worker', 'Read another file.', [{ role: 'user', content: 'Read a file.' }, { role: 'assistant', content: 'The first file contains notes.' }], [], 8192);
    const body = cloudBody(input);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'The first file contains notes.' });
    expect(JSON.stringify(body)).not.toContain('reasoning_content');
    input.tools = [];
    expect(cloudBody(input).thinking).toBeUndefined();
  });
  it('uses non-thinking mode after a tool proposal loses its private continuation during redaction', () => {
    const input = request('deepseek');
    const call = safeHttpRequestForRecord({ id: 'blocked_call', name: 'http_get', arguments: { url: 'https://example.com/?api_key=private-value' } });
    input.messages.push({ role: 'assistant', content: '', toolCalls: [call] }, { role: 'tool', toolCallId: call.id, content: 'This request was denied.' });
    const body = cloudBody(input);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(JSON.stringify(body)).not.toContain('private-value');
    expect(body.messages).toContainEqual({ role: 'tool', tool_call_id: call.id, content: 'This request was denied.' });
  });
  it('retains complete native DeepSeek reasoning without disabling thinking', () => {
    const input = request('deepseek');
    const native = { role: 'assistant', content: 'Earlier answer', reasoning_content: 'private retained' };
    input.messages.push({ role: 'assistant', content: 'Earlier answer', providerData: { provider: 'deepseek', data: native } });
    expect(cloudBody(input).thinking).toBeUndefined();
    expect(cloudBody(input).messages).toContainEqual(native);
    input.messages.push({ role: 'assistant', content: 'Imported answer', providerData: { provider: 'xai', data: [{ type: 'reasoning', encrypted_content: 'other-provider-private' }] } });
    const mixed = cloudBody(input);
    expect(mixed.thinking).toEqual({ type: 'disabled' });
    expect(mixed.messages).toContainEqual(native);
    expect(JSON.stringify(mixed)).not.toContain('other-provider-private');
  });
  it.each(['xai', 'deepseek'] as const)('discovers only authenticated %s models without invented prices', async provider => {
    const requested: string[] = [];
    const gateway = new Providers({ secrets: credentials(), fetch: async (url, init) => {
      requested.push(String(url)); expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${provider}-test-secret`);
      return Response.json({ data: [{ id: provider === 'xai' ? 'grok-4.7' : 'deepseek-flash' }, { id: 'image-generator' }] });
    } });
    expect(await gateway.verify(provider)).toMatchObject({ id: provider, connected: true, authenticated: true });
    // Disable other providers to make this a bounded discovery-only inspection.
    for (const other of ['ollama', 'lmstudio', 'openai', 'anthropic', 'gemini', 'xai', 'deepseek'] as const) if (other !== provider) gateway.setEnabled(other, false);
    const models = await gateway.listModels(); expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ provider, local: false, capabilities: { tools: true }, inputPricePerMillion: null, outputPricePerMillion: null });
    expect(requested).toEqual([provider === 'xai' ? 'https://api.x.ai/v1/models' : 'https://api.deepseek.com/models']);
  });
  it.each(['xai', 'deepseek'] as const)('%s is unconfigured without credentials and personal users never inherit owner environment keys', async provider => {
    const personal = new SecretManager({ userId: 'alice', env: { XAI_API_KEY: 'owner', DEEPSEEK_API_KEY: 'owner' }, keyring: null });
    let calls = 0; const gateway = new Providers({ secrets: personal, fetch: async () => { calls++; throw new Error('No network expected'); } });
    expect(await gateway.verify(provider)).toMatchObject({ configured: false, state: 'unconfigured' }); expect(calls).toBe(0);
  });
  it('uses xAI Responses with storage disabled and replays encrypted continuation only to xAI', async () => {
    let body: Record<string, unknown> = {};
    const gateway = new Providers({ secrets: credentials(), fetch: async (url, init) => {
      expect(String(url)).toBe('https://api.x.ai/v1/responses'); body = JSON.parse(String(init?.body));
      return new Response(event({ type: 'response.output_text.delta', delta: 'Answer' }) + event({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'opaque-private' }], usage: { input_tokens: 5, output_tokens: 8 } } }));
    } });
    const input = request('xai'); const chunks = await collect(gateway.stream(input));
    expect(body).toMatchObject({ model: 'grok-4.7', stream: true, store: false, max_output_tokens: 1024 });
    expect(body.input).toContainEqual({ role: 'system', content: 'Keep tool authority separate.' });
    const continuation = chunks.find(x => x.type === 'continuation'); expect(continuation).toMatchObject({ providerData: { provider: 'xai' } });
    expect(JSON.stringify(chunks.filter(x => x.type !== 'continuation'))).not.toContain('opaque-private');
    if (continuation?.type !== 'continuation') throw new Error('No continuation');
    input.messages.push({ role: 'assistant', content: 'Answer', providerData: continuation.providerData });
    expect(JSON.stringify(cloudBody(input))).toContain('opaque-private'); input.model.provider = 'openai';
    expect(JSON.stringify(cloudBody(input))).not.toContain('opaque-private');
  });
  it('streams DeepSeek visible text and complete validated calls with private reasoning replay', async () => {
    let body: Record<string, unknown> = {};
    const gateway = new Providers({ secrets: credentials(), fetch: async (url, init) => { expect(String(url)).toBe('https://api.deepseek.com/chat/completions'); body = JSON.parse(String(init?.body)); return new Response(deepseek()); } });
    const input = request('deepseek'); const chunks = await collect(gateway.stream(input));
    expect(body).toMatchObject({ model: 'deepseek-flash', max_tokens: 1024, stream_options: { include_usage: true } });
    expect(chunks.filter(x => x.type === 'text')).toEqual([{ type: 'text', text: 'Checking.' }]);
    expect(chunks.find(x => x.type === 'tool_call')).toMatchObject({ call: { id: 'call_1', name: 'read_file', arguments: { path: 'a.txt' } } });
    expect(chunks.find(x => x.type === 'usage')).toMatchObject({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 4 });
    expect(JSON.stringify(chunks.filter(x => x.type !== 'continuation'))).not.toContain('private reasoning');
    const continuation = chunks.find(x => x.type === 'continuation'); if (continuation?.type !== 'continuation') throw new Error('No continuation');
    input.messages.push({ role: 'assistant', content: 'Checking.', providerData: continuation.providerData }, { role: 'tool', toolCallId: 'call_1', content: 'file data' });
    expect(JSON.stringify(cloudBody(input))).toContain('private reasoning');
    expect(cloudBody(input).messages).toContainEqual({ role: 'tool', tool_call_id: 'call_1', content: 'file data' });
    input.model.provider = 'xai'; expect(JSON.stringify(cloudBody(input))).not.toContain('private reasoning');
  });
  it.each(['length', 'content_filter', ''])('never dispatches DeepSeek tool proposals for incomplete finish %s', async finish => {
    const gateway = new Providers({ secrets: credentials(), fetch: async () => new Response(deepseek(finish)) }); const emitted: ModelChunk[] = [];
    await expect((async () => { for await (const chunk of gateway.stream(request('deepseek'))) emitted.push(chunk); })()).rejects.toThrow(/incomplete/i);
    expect(emitted.some(x => x.type === 'tool_call')).toBe(false);
  });
  it('rejects unavailable DeepSeek tools without exposing provider error text', async () => {
    const gateway = new Providers({ secrets: credentials(), fetch: async () => new Response(deepseek('tool_calls', 'steal_secret')) });
    await expect(collect(gateway.stream(request('deepseek')))).rejects.toThrow(/unavailable tool/i);
  });
  it('rejects a DeepSeek tool record cut off before its terminating SSE frame', async () => {
    const gateway = new Providers({ secrets: credentials(), fetch: async () => new Response(deepseek().replace('data: [DONE]\n\n', 'data: {"choices":[]')) });
    const emitted: ModelChunk[] = [];
    await expect((async () => { for await (const chunk of gateway.stream(request('deepseek'))) emitted.push(chunk); })()).rejects.toThrow(/incomplete/i);
    expect(emitted.some(x => x.type === 'tool_call')).toBe(false);
  });
  it('keeps DeepSeek reasoning on tool-free assistant turns for a subsequent tool request', async () => {
    const body = event({ choices: [{ index: 0, delta: { reasoning_content: 'private retained', content: 'Answer' }, finish_reason: 'stop' }] });
    const gateway = new Providers({ secrets: credentials(), fetch: async () => new Response(body) });
    const input = request('deepseek'); const chunks = await collect(gateway.stream(input));
    const continuation = chunks.find(x => x.type === 'continuation'); if (continuation?.type !== 'continuation') throw new Error('No continuation');
    input.messages.push({ role: 'assistant', content: 'Answer', providerData: continuation.providerData });
    expect(JSON.stringify(cloudBody(input))).toContain('private retained');
    expect(JSON.stringify(chunks.filter(x => x.type !== 'continuation'))).not.toContain('private retained');
  });
  it.each(['xai', 'deepseek'] as const)('cancels %s transport immediately on provider disable', async provider => {
    let signal: AbortSignal | undefined; let started!: () => void; const dispatched = new Promise<void>(resolve => { started = resolve; });
    const gateway = new Providers({ secrets: credentials(), fetch: async (_url, init) => { signal = init?.signal as AbortSignal; started(); return await new Promise<Response>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })); } });
    const result = collect(gateway.stream(request(provider))); const rejected = expect(result).rejects.toThrow(/disabled/i); await dispatched; gateway.setEnabled(provider, false); await rejected; expect(signal?.aborted).toBe(true);
  });
  it.each(['xai', 'deepseek'] as const)('classifies %s rate limits and never logs response secrets', async provider => {
    const gateway = new Providers({ secrets: credentials(), fetch: async () => new Response('secret echoed by upstream', { status: 429 }) });
    const status = await gateway.verify(provider); expect(status.state).toBe('rate_limited'); expect(JSON.stringify(status)).not.toContain('secret echoed');
  });
});
