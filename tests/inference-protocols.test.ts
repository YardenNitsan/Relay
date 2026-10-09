import { describe, expect, it } from 'vitest';
import type { ModelChunk } from '../shared/types.js';
import { encodeInferenceError, encodeInferenceResponse, encodeInferenceStream, InferenceProtocolError, parseInferenceRequest, type InferenceProtocol } from '../server/inference/protocols.js';

const identity = { id: 'relay_test', model: 'ollama/test', createdAt: 1700000000 };
const schema = { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false };
const tool = { type: 'function', name: 'file_read', description: 'Client filesystem only', parameters: schema, strict: true };
const request = (protocol: InferenceProtocol = 'responses', extra: Record<string, unknown> = {}) => parseInferenceRequest(protocol, protocol === 'responses'
  ? { model: identity.model, input: 'hello', tools: [tool], ...extra }
  : protocol === 'chat-completions'
    ? { model: identity.model, messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: schema, strict: true } }], ...extra }
    : { model: identity.model, max_tokens: 1024, messages: [{ role: 'user', content: 'hello' }], tools: [{ name: tool.name, description: tool.description, input_schema: schema }], ...extra });
async function* chunks(items: ModelChunk[]): AsyncGenerator<ModelChunk> { yield* items; }
const measured: ModelChunk = { type: 'usage', inputTokens: 13, outputTokens: 4 };
const done: ModelChunk = { type: 'done', finishReason: 'stop' };
const call: ModelChunk = { type: 'tool_call', call: { id: 'client_call', name: 'file_read', arguments: { path: 'client.txt' } } };
async function frames(protocol: InferenceProtocol, items: ModelChunk[], extra: Record<string, unknown> = {}) {
  const text: string[] = [];
  for await (const frame of encodeInferenceStream(request(protocol, extra), identity, chunks(items))) text.push(frame);
  return text.flatMap(frame => frame.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)) as Record<string, any>));
}

describe('stateless external inference parsing', () => {
  it('normalizes Responses instructions and complete client tool round trips', () => {
    const parsed = request('responses', { store: false, stream: true, instructions: 'Use client tools', input: [
      { role: 'user', content: [{ type: 'input_text', text: 'read' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'file_read', arguments: '{"path":"client.txt"}', status: 'completed' },
      { type: 'function_call_output', call_id: 'call_1', output: 'client file content' },
    ] });
    expect(parsed.messages).toEqual([{ role: 'system', content: 'Use client tools' }, { role: 'user', content: 'read' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'file_read', arguments: { path: 'client.txt' } }] },
      { role: 'tool', content: 'client file content', toolCallId: 'call_1' }]);
    expect(parsed).toMatchObject({ modelId: identity.model, maxOutputTokens: 2048, stream: true });
  });

  it('normalizes Chat Completions developer messages and parallel result histories', () => {
    const parsed = request('chat-completions', { messages: [
      { role: 'developer', content: 'instructions' }, { role: 'user', content: [{ type: 'text', text: 'read' }] },
      { role: 'assistant', content: null, tool_calls: ['a', 'b'].map(id => ({ id, type: 'function', function: { name: 'file_read', arguments: '{"path":"a"}' } })) },
      { role: 'tool', tool_call_id: 'a', content: 'A' }, { role: 'tool', tool_call_id: 'b', content: 'B' },
    ], max_completion_tokens: 1200, stream_options: { include_usage: true } });
    expect(parsed.messages[0]).toEqual({ role: 'system', content: 'instructions' });
    expect(parsed.messages[2]?.toolCalls).toHaveLength(2);
    expect(parsed.maxOutputTokens).toBe(1200);
    expect(parsed.includeUsage).toBe(true);
  });

  it('normalizes Anthropic mixed text and client tool blocks without host execution', () => {
    const parsed = request('anthropic-messages', { system: [{ type: 'text', text: 'system' }], messages: [
      { role: 'user', content: 'read a client file' },
      { role: 'assistant', content: [{ type: 'text', text: 'Reading' }, { type: 'tool_use', id: 'a', name: 'file_read', input: { path: 'client.txt' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'permission denied' }], is_error: true }, { type: 'text', text: 'explain' }] },
    ] });
    expect(parsed.messages.at(-2)).toMatchObject({ role: 'tool', toolCallId: 'a' });
    expect(parsed.messages.at(-2)?.content).toContain('permission denied');
    expect(parsed.messages.at(-1)).toEqual({ role: 'user', content: 'explain' });
    expect(parsed.messages.flatMap(message => message.toolCalls ?? [])).toEqual([{ id: 'a', name: 'file_read', arguments: { path: 'client.txt' } }]);
  });

  it.each([
    ['responses', { previous_response_id: 'resp_older' }], ['responses', { previous_response_id: null }],
    ['responses', { store: true }], ['responses', { background: true }], ['responses', { conversation: 'old' }],
    ['responses', { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'https://example.com/a.png' }] }] }],
    ['responses', { tools: [{ type: 'web_search' }] }], ['responses', { tools: [{ type: 'custom', name: 'shell' }] }],
    ['responses', { reasoning: { effort: 'high' } }], ['responses', { text: { format: { type: 'json_schema', schema } } }],
    ['chat-completions', { temperature: 0 }], ['chat-completions', { n: 2 }], ['chat-completions', { max_tokens: 5, max_completion_tokens: 6 }],
    ['chat-completions', { messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'x' } }] }] }],
    ['anthropic-messages', { thinking: { type: 'enabled', budget_tokens: 1024 } }], ['anthropic-messages', { max_tokens: 0 }],
    ['anthropic-messages', { stop_sequences: ['stop'] }], ['anthropic-messages', { tools: [{ type: 'computer_20250124', name: 'computer' }] }],
  ] as [InferenceProtocol, Record<string, unknown>][])('rejects unsupported %s request fields', (protocol, extra) => {
    expect(() => request(protocol, extra)).toThrow(InferenceProtocolError);
  });

  it('rejects unmatched, duplicate and incomplete tool histories', () => {
    for (const input of [
      [{ type: 'function_call_output', call_id: 'missing', output: 'x' }],
      [{ type: 'function_call', call_id: 'a', name: 'file_read', arguments: '{}' }],
      [{ type: 'function_call', call_id: 'a', name: 'file_read', arguments: '{}' }, { type: 'function_call_output', call_id: 'a', output: 'x' }, { type: 'function_call_output', call_id: 'a', output: 'again' }],
      [{ type: 'function_call', call_id: 'a', name: 'file_read', arguments: '{}' }, { role: 'user', content: 'interrupt' }],
    ]) expect(() => request('responses', { input })).toThrow(InferenceProtocolError);
  });

  it('bounds aggregate UTF-8 bytes, nesting, messages and tool schemas before inference', () => {
    expect(() => request('responses', { input: '🙂'.repeat(300_000) })).toThrow(InferenceProtocolError);
    expect(() => request('responses', { input: Array.from({ length: 257 }, () => ({ role: 'user', content: 'x' })) })).toThrow(InferenceProtocolError);
    expect(() => request('responses', { tools: [tool, tool] })).toThrow(InferenceProtocolError);
    expect(() => request('responses', { tools: [{ ...tool, parameters: { type: 'object', properties: { x: { $ref: 'https://attacker.test/' } } } }] })).toThrow(InferenceProtocolError);
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    expect(() => request('responses', { input: cyclic })).toThrow(InferenceProtocolError);
  });

  it('honors tool_choice none and refuses unknown required-tool semantics', () => {
    expect(request('responses', { tool_choice: 'none' }).tools).toEqual([]);
    expect(() => request('responses', { tool_choice: 'required' })).toThrow(InferenceProtocolError);
    expect(request('responses', { parallel_tool_calls: false }).parallelToolCalls).toBe(false);
  });

  it('preserves assistant commentary inside a multi-tool Anthropic turn', () => {
    const parsed = request('anthropic-messages', { messages: [
      { role: 'user', content: 'read' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'file_read', input: { path: 'a' } }, { type: 'text', text: 'Also reading b' }, { type: 'tool_use', id: 'b', name: 'file_read', input: { path: 'b' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'A' }, { type: 'tool_result', tool_use_id: 'b', content: 'B' }] },
    ] });
    expect(parsed.messages.map(message => message.content)).toContain('Also reading b');
    expect(parsed.messages.filter(message => message.role === 'tool')).toHaveLength(2);
  });

  it('rejects client tools claimed in the wrong role and preserves error confidentiality', () => {
    expect(() => request('anthropic-messages', { messages: [{ role: 'user', content: [{ type: 'tool_use', id: 'a', name: 'file_read', input: {} }] }] })).toThrow(InferenceProtocolError);
    expect(JSON.stringify(encodeInferenceError('responses', new Error('private prompt Bearer secret-token')))).not.toContain('secret-token');
    expect(encodeInferenceError('anthropic-messages', new InferenceProtocolError('invalid_request', 'Unsupported input'))).toMatchObject({ type: 'error', error: { type: 'invalid_request_error' } });
  });
});

describe('external inference response wire formats', () => {
  it.each(['responses', 'chat-completions', 'anthropic-messages'] as const)('returns real tool calls and measured usage in %s', async protocol => {
    const response = await encodeInferenceResponse(request(protocol), identity, chunks([{ type: 'text', text: 'Inspecting' }, call, measured, { type: 'done', finishReason: 'tool_calls' }]));
    expect(JSON.stringify(response)).toContain('client.txt');
    expect(JSON.stringify(response)).toContain('client_call');
    expect(response.model).toBe(identity.model);
    if (protocol === 'responses') expect(response).toMatchObject({ object: 'response', status: 'completed', store: false, usage: { input_tokens: 13, output_tokens: 4, total_tokens: 17 } });
    if (protocol === 'chat-completions') expect(response).toMatchObject({ object: 'chat.completion', choices: [{ finish_reason: 'tool_calls' }], usage: { prompt_tokens: 13, completion_tokens: 4, total_tokens: 17 } });
    if (protocol === 'anthropic-messages') expect(response).toMatchObject({ type: 'message', stop_reason: 'tool_use', usage: { input_tokens: 13, output_tokens: 4 } });
  });

  it('round-trips Responses output as next-turn stateless input', async () => {
    const response = await encodeInferenceResponse(request(), identity, chunks([call, measured, { type: 'done', finishReason: 'tool_calls' }]));
    const parsed = request('responses', { input: [{ role: 'user', content: 'read' }, ...(response.output as unknown[]), { type: 'function_call_output', call_id: 'client_call', output: 'client bytes' }] });
    expect(parsed.messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'client_call', content: 'client bytes' });
  });

  it('uses explicit unknown usage for OpenAI and refuses unknown final Anthropic usage', async () => {
    expect((await encodeInferenceResponse(request(), identity, chunks([{ type: 'text', text: 'Hi' }, done]))).usage).toBeNull();
    await expect(encodeInferenceResponse(request('anthropic-messages'), identity, chunks([{ type: 'text', text: 'Hi' }, done]))).rejects.toThrow(/usage/i);
  });

  it('streams Responses items, text and arguments with monotonic sequence numbers and a complete final object', async () => {
    const events = await frames('responses', [{ type: 'text', text: 'Hi\n' }, { type: 'text', text: 'there' }, call, measured, { type: 'done', finishReason: 'tool_calls' }]);
    expect(events[0]?.type).toBe('response.created');
    expect(events.map(event => event.type)).toContain('response.function_call_arguments.done');
    expect(events.filter(event => event.type === 'response.output_text.delta').map(event => event.delta).join('')).toBe('Hi\nthere');
    expect(events.at(-1)?.type).toBe('response.completed');
    expect(events.map(event => event.sequence_number)).toEqual(events.map((_, i) => i));
    expect(events.at(-1)?.response.output).toHaveLength(2);
  });

  it('streams OpenAI chat indexed tool deltas and the requested final usage event', async () => {
    const events = await frames('chat-completions', [{ type: 'text', text: 'Hi' }, call, measured, { type: 'done', finishReason: 'tool_calls' }], { stream_options: { include_usage: true } });
    expect(events[0]?.choices[0].delta.role).toBe('assistant');
    expect(events.find(event => event.choices[0]?.delta.tool_calls)?.choices[0].delta.tool_calls[0]).toMatchObject({ index: 0, id: 'client_call', type: 'function' });
    expect(events.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 17 } });
  });

  it('streams Anthropic matching content indices with final measured token counters', async () => {
    const events = await frames('anthropic-messages', [{ type: 'text', text: 'Hi' }, call, measured, { type: 'done', finishReason: 'tool_calls' }]);
    expect(events[0]?.type).toBe('message_start');
    expect(events.filter(event => event.type === 'content_block_start').map(event => event.index)).toEqual([0, 1]);
    expect(events.at(-2)).toMatchObject({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 13, output_tokens: 4 } });
    expect(events.at(-1)?.type).toBe('message_stop');
  });

  it('streams visible text before completion and never reveals private continuation', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    async function* source(): AsyncGenerator<ModelChunk> { yield { type: 'text', text: 'first' }; await gate; yield { type: 'continuation', providerData: { provider: 'ollama', data: { thinking: 'private' } } }; yield done; }
    const iterator = encodeInferenceStream(request(), identity, source());
    const first: string[] = [];
    while (!first.some(frame => frame.includes('response.output_text.delta'))) first.push((await iterator.next()).value as string);
    expect(first.join('')).toContain('first'); finish?.();
    for await (const frame of iterator) first.push(frame);
    expect(first.join('')).not.toContain('private');
  });

  it.each([
    [{ type: 'text', text: 'partial' }],
    [{ type: 'text', text: 'partial' }, { type: 'done', finishReason: 'length' }],
    [{ type: 'tool_call', call: { id: 'x', name: 'host_secret', arguments: {} } }, done],
    [{ type: 'tool_call', call: { id: 'x', name: 'file_read', arguments: { path: 42 } } }, done],
    [call, call, done], [done, { type: 'text', text: 'late' }],
  ] as ModelChunk[][])('never completes a broken or unsafe provider output', async (...items) => {
    await expect(encodeInferenceResponse(request(), identity, chunks(items))).rejects.toThrow(InferenceProtocolError);
  });

  it('withholds tool execution candidates until a complete provider terminal and rejects multiple when prohibited', async () => {
    const observed: string[] = [];
    try { for await (const frame of encodeInferenceStream(request(), identity, chunks([call]))) observed.push(frame); } catch { /* expected */ }
    expect(observed.join('')).not.toContain('client_call');
    expect(observed.join('')).not.toContain('response.completed');
    await expect(encodeInferenceResponse(request('responses', { parallel_tool_calls: false }), identity, chunks([call, { type: 'tool_call', call: { id: 'second', name: 'file_read', arguments: { path: 'b' } } }, done]))).rejects.toThrow(InferenceProtocolError);
  });

  it('bounds generated UTF-8 bytes and refuses invented or corrupt usage counters', async () => {
    await expect(encodeInferenceResponse(request(), identity, chunks([{ type: 'text', text: '🙂'.repeat(300_000) }, done]))).rejects.toThrow(InferenceProtocolError);
    await expect(encodeInferenceResponse(request(), identity, chunks([{ type: 'text', text: 'Hi' }, { type: 'usage', inputTokens: -1, outputTokens: 4 }, done]))).rejects.toThrow(InferenceProtocolError);
    await expect(encodeInferenceResponse(request(), identity, chunks([{ type: 'text', text: 'Hi' }, { type: 'usage', inputTokens: Infinity, outputTokens: 4 }, done]))).rejects.toThrow(InferenceProtocolError);
  });

  it('never publishes a successful stream footer when the provider throws after its terminal chunk', async () => {
    async function* fails(): AsyncGenerator<ModelChunk> { yield { type: 'text', text: 'partial' }; yield done; throw new Error('transport closed'); }
    const observed: string[] = [];
    await expect((async () => { for await (const frame of encodeInferenceStream(request(), identity, fails())) observed.push(frame); })()).rejects.toThrow('transport closed');
    expect(observed.join('')).not.toContain('response.completed');
  });
});
