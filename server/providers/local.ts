import { randomUUID } from 'node:crypto';
import type { ModelChunk, ModelRequest, ToolRequest } from '../../shared/types.js';
import { array, ndjson, number, object, ProviderError, sse, string, toolArguments, type JsonObject } from './transport.js';
import { rawModelId } from './cloud.js';
import { VisibleText } from './visible-text.js';

export function localBody(request: ModelRequest): JsonObject {
  const ollama = request.model.provider === 'ollama';
  const messages = request.messages.map(message => {
    if (ollama && message.role === 'assistant' && message.providerData?.provider === 'ollama') return message.providerData.data;
    const base: JsonObject = { role: message.role, content: message.content };
    if (message.toolCalls?.length) base.tool_calls = message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: ollama ? call.arguments : JSON.stringify(call.arguments) } }));
    if (message.role === 'tool') {
      base.tool_call_id = message.toolCallId;
      base.tool_name = request.messages.flatMap(x => x.toolCalls ?? []).find(x => x.id === message.toolCallId)?.name;
    }
    return base;
  });
  const common = { model: rawModelId(request), messages, tools: request.tools.map(tool => ({ type: 'function', function: tool })), stream: true };
  // Never force think:false: for thinking-only model templates it disables Ollama's
  // separation of private reasoning without stopping the model from generating it.
  return ollama ? { ...common, options: { num_ctx: request.contextTokens, num_predict: request.maxOutputTokens, ...(request.execution ? { num_gpu: request.execution.numGpu } : {}) }, keep_alive: '5m' } : { ...common, max_tokens: request.maxOutputTokens, stream_options: { include_usage: true } };
}

export async function* ollamaStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  let terminal: JsonObject | undefined; let text = ''; let thinking = '';
  const visibility = new VisibleText();
  const proposals: JsonObject[] = [];
  for await (const data of ndjson(response)) {
    request.signal.throwIfAborted();
    if (data.error) throw new ProviderError('runtime_failed', 'Ollama generation failed; inspect runtime logs');
    const message = object(data.message); const delta = string(message.content);
    text += delta; thinking += string(message.thinking);
    const visible = visibility.push(delta);
    if (visible) yield { type: 'text', text: visible };
    for (const call of array(message.tool_calls)) proposals.push(object(call));
    if (data.done === true) { terminal = data; break; }
  }
  if (!terminal || terminal.done_reason === 'length') throw new ProviderError('incomplete_stream', 'Ollama stream ended incomplete; no tools were dispatched');
  const tail = visibility.finish(); if (tail) yield { type: 'text', text: tail };
  const calls: ToolRequest[] = proposals.map(call => {
    const fn = object(call.function); const name = string(fn.name);
    if (!request.tools.some(tool => tool.name === name)) throw new ProviderError('invalid_tool', 'Ollama requested an unavailable tool');
    return { id: string(call.id) || randomUUID(), name, arguments: toolArguments(fn.arguments) };
  });
  yield { type: 'continuation', providerData: { provider: 'ollama', data: { role: 'assistant', content: text, ...(thinking ? { thinking } : {}), ...(calls.length ? { tool_calls: calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } })) } : {}) } } };
  const promptCount = number(terminal.prompt_eval_count); const outputCount = number(terminal.eval_count);
  const loadNs=number(terminal.load_duration);const cached=number(terminal.prompt_eval_cached_count);
  const promptNs = number(terminal.prompt_eval_duration); const generationNs = number(terminal.eval_duration); const totalNs = number(terminal.total_duration);
  if (promptCount !== null && outputCount !== null) yield { type: 'usage', inputTokens: promptCount, outputTokens: outputCount, ...(loadNs!==null?{loadDurationMs:loadNs/1e6}:{}),...(cached!==null?{cachedInputTokens:cached}:{}), ...(totalNs !== null ? { durationMs: totalNs / 1e6 } : {}), ...(generationNs && outputCount ? { generationTokensPerSecond: outputCount / generationNs * 1e9 } : {}), ...(promptNs && promptCount>(cached??0) ? { promptTokensPerSecond: (promptCount-(cached??0)) / promptNs * 1e9 } : {}) };
  for (const call of calls) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: calls.length ? 'tool_calls' : string(terminal.done_reason) || 'stop' };
}

export async function* compatibleStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  const visibility = new VisibleText();
  let finish = ''; let input: number | null = null; let output: number | null = null;
  for await (const data of sse(response)) {
    request.signal.throwIfAborted();
    if (data.error) throw new ProviderError('runtime_failed', 'Local runtime generation failed');
    if (data.usage) { const stats = object(data.usage); input = number(stats.prompt_tokens) ?? input; output = number(stats.completion_tokens) ?? output; }
    const choice = object(array(data.choices)[0]); const delta = object(choice.delta);
    const visible = visibility.push(string(delta.content));
    if (visible) yield { type: 'text', text: visible };
    for (const item of array(delta.tool_calls).map(object)) {
      const index = number(item.index) ?? 0; const call = calls.get(index) ?? { id: '', name: '', arguments: '' }; const fn = object(item.function);
      call.id += string(item.id); call.name += string(fn.name); call.arguments += string(fn.arguments); calls.set(index, call);
    }
    if (choice.finish_reason) finish = string(choice.finish_reason);
  }
  if (!['stop', 'tool_calls'].includes(finish)) throw new ProviderError('incomplete_stream', 'Local runtime stream ended incomplete; no tools were dispatched');
  const tail = visibility.finish(); if (tail) yield { type: 'text', text: tail };
  const complete = [...calls.values()].map(call => {
    if (!call.id || !request.tools.some(tool => tool.name === call.name)) throw new ProviderError('invalid_tool', 'Local runtime requested an unavailable tool');
    return { ...call, arguments: toolArguments(call.arguments) };
  });
  if (input !== null && output !== null) yield { type: 'usage', inputTokens: input, outputTokens: output };
  for (const call of complete) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: finish };
}
