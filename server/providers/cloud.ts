import type { ModelChunk, ModelMessage, ModelRequest, ProviderId, ToolRequest } from '../../shared/types.js';
import { array, number, object, ProviderError, outputLimitError, sse, string, toolArguments, type JsonObject } from './transport.js';

export const CLOUD_ENDPOINTS = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1', gemini: 'https://generativelanguage.googleapis.com/v1beta', xai: 'https://api.x.ai/v1', deepseek: 'https://api.deepseek.com' } as const;
export function rawModelId(request: ModelRequest): string { return request.model.id.startsWith(`${request.model.provider}/`) ? request.model.id.slice(request.model.provider.length + 1) : request.model.name; }
const native = (message: ModelMessage, provider: ProviderId): unknown[] | null => message.role === 'assistant' && message.providerData?.provider === provider && Array.isArray(message.providerData.data) ? message.providerData.data : null;
const system = (request: ModelRequest) => request.messages.filter(x => x.role === 'system').map(x => x.content).join('\n\n');
function toolName(request: ModelRequest, id?: string): string { return request.messages.flatMap(x => x.toolCalls ?? []).find(x => x.id === id)?.name ?? ''; }

export function cloudBody(request: ModelRequest): JsonObject {
  const provider = request.model.provider;
  const messages = request.messages.filter(x => x.role !== 'system');
  if (provider === 'openai' || provider === 'xai') {
    const input = messages.flatMap<unknown>(message => {
      const original = native(message, provider); if (original) return original;
      if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.toolCallId, output: message.content }];
      return [{ role: message.role, content: message.content }, ...(message.toolCalls ?? []).map(call => ({ type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments) }))];
    });
    return { model: rawModelId(request), ...(provider === 'xai' ? { input: [...(system(request) ? [{ role: 'system', content: system(request) }] : []), ...input] } : { instructions: system(request), input }), tools: request.tools.map(tool => ({ type: 'function', ...tool, strict: false })), max_output_tokens: request.maxOutputTokens, stream: true, store: false, include: ['reasoning.encrypted_content'] };
  }
  if (provider === 'deepseek') {
    // Tool-enabled thinking requires every historical assistant turn's original
    // reasoning. Ordinary chat history, rerouting and redaction can lack it.
    // Use the documented non-thinking mode instead of inventing private state.
    const missingReasoning = request.tools.length > 0 && request.messages.some(message => message.role === 'assistant' &&
      (message.providerData?.provider !== 'deepseek' || typeof object(message.providerData.data).reasoning_content !== 'string'));
    return { model: rawModelId(request), messages: request.messages.map(message => {
      if (message.role === 'assistant' && message.providerData?.provider === 'deepseek') return message.providerData.data;
      if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
      return { role: message.role, content: message.content, ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) };
    }), ...(request.tools.length ? { tools: request.tools.map(tool => ({ type: 'function', function: tool })) } : {}), ...(missingReasoning ? { thinking: { type: 'disabled' } } : {}), max_tokens: request.maxOutputTokens, stream: true, stream_options: { include_usage: true } };
  }
  if (provider === 'anthropic') {
    return { model: rawModelId(request), system: system(request), messages: messages.map(message => {
      const original = native(message, provider);
      if (original) return { role: 'assistant', content: original };
      if (message.role === 'tool') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content }] };
      return { role: message.role, content: [...(message.content ? [{ type: 'text', text: message.content }] : []), ...(message.toolCalls ?? []).map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }))] };
    }), tools: request.tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })), max_tokens: request.maxOutputTokens, stream: true };
  }
  if (provider === 'gemini') {
    const input = messages.flatMap<unknown>(message => {
      const original = native(message, provider); if (original) return original;
      if (message.role === 'tool') return [{ type: 'function_result', call_id: message.toolCallId, name: toolName(request, message.toolCallId), result: message.content }];
      return [{ type: message.role === 'assistant' ? 'model_output' : 'user_input', content: [{ type: 'text', text: message.content }] }, ...(message.toolCalls ?? []).map(call => ({ type: 'function_call', id: call.id, name: call.name, arguments: call.arguments }))];
    });
    return { model: rawModelId(request), input, system_instruction: system(request), tools: request.tools.map(tool => ({ type: 'function', ...tool })), generation_config: { max_output_tokens: request.maxOutputTokens }, stream: true, store: false };
  }
  throw new ProviderError('unsupported_provider', 'Unsupported cloud provider');
}

function validateCall(id: unknown, name: unknown, args: unknown, request: ModelRequest): ToolRequest {
  if (!string(id) || !string(name) || !request.tools.some(tool => tool.name === name)) throw new ProviderError('invalid_tool', 'Provider requested an unavailable tool');
  return { id: string(id), name: string(name), arguments: toolArguments(args) };
}
function usage(input: unknown, output: unknown): ModelChunk | null {
  const inputTokens = number(input); const outputTokens = number(output);
  return inputTokens === null || outputTokens === null ? null : { type: 'usage', inputTokens, outputTokens };
}
function incomplete(): never { throw new ProviderError('incomplete_stream', 'Provider stream ended incomplete; no tools were dispatched'); }

export async function* openaiStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  let terminal: JsonObject | undefined;
  for await (const data of sse(response)) {
    request.signal.throwIfAborted();
    if (data.type === 'response.output_text.delta') yield { type: 'text', text: string(data.delta) };
    if (data.type === 'error' || data.type === 'response.failed') throw new ProviderError('provider_failed', 'Responses provider generation failed');
    if (data.type === 'response.incomplete') {const response=object(data.response),stats=object(response.usage),measured=usage(stats.input_tokens,stats.output_tokens);if(measured)yield measured;if(object(response.incomplete_details).reason==='max_output_tokens')throw outputLimitError();incomplete();}
    if (data.type === 'response.completed') { terminal = object(data.response); break; }
  }
  if (!terminal || terminal.status !== 'completed') incomplete();
  const output = array(terminal.output);
  const calls = output.map(object).filter(item => item.type === 'function_call').map(item => validateCall(item.call_id, item.name, item.arguments, request));
  yield { type: 'continuation', providerData: { provider: request.model.provider, data: output } };
  const stats = object(terminal.usage); const measured = usage(stats.input_tokens, stats.output_tokens); if (measured) yield measured;
  for (const call of calls) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: calls.length ? 'tool_calls' : 'stop' };
}

export async function* anthropicStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  const blocks = new Map<number, JsonObject>();
  const partial = new Map<number, string>();
  const open = new Set<number>();
  let stopped = false; let finish = ''; let input: number | null = null; let output: number | null = null;
  for await (const data of sse(response)) {
    request.signal.throwIfAborted();
    const index = number(data.index) ?? 0;
    if (data.type === 'error') throw new ProviderError(string(object(data.error).type) || 'provider_failed', `Anthropic generation failed (${string(object(data.error).type).replace(/[^a-z_]/g, '') || 'unknown'})`);
    if (data.type === 'message_start') { const stats = object(object(data.message).usage); const base = number(stats.input_tokens); input = base === null ? null : base + (number(stats.cache_read_input_tokens) ?? 0) + (number(stats.cache_creation_input_tokens) ?? 0); }
    if (data.type === 'content_block_start') { blocks.set(index, { ...object(data.content_block) }); open.add(index); }
    if (data.type === 'content_block_delta') {
      const delta = object(data.delta); const block = blocks.get(index); if (!block) incomplete();
      if (delta.type === 'text_delta' && block.type === 'text') { const text = string(delta.text); block.text = string(block.text) + text; yield { type: 'text', text }; }
      if (delta.type === 'input_json_delta' && block.type === 'tool_use') partial.set(index, (partial.get(index) ?? '') + string(delta.partial_json));
      if (delta.type === 'thinking_delta') block.thinking = string(block.thinking) + string(delta.thinking);
      if (delta.type === 'signature_delta') block.signature = string(block.signature) + string(delta.signature);
    }
    if (data.type === 'content_block_stop') { const block = blocks.get(index); if (!block) incomplete(); open.delete(index); }
    if (data.type === 'message_delta') { finish = string(object(data.delta).stop_reason); output = number(object(data.usage).output_tokens) ?? output; }
    if (data.type === 'message_stop') { stopped = true; break; }
  }
  if(finish==='max_tokens'){const measured=usage(input,output);if(measured)yield measured;throw outputLimitError();}
  if (!stopped || open.size || !['end_turn', 'tool_use', 'stop_sequence'].includes(finish)) incomplete();
  const content = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([index, block]) => partial.has(index)?{...block,input:toolArguments(partial.get(index))}:block);
  const calls = content.filter(block => block.type === 'tool_use').map(block => validateCall(block.id, block.name, block.input, request));
  yield { type: 'continuation', providerData: { provider: 'anthropic', data: content } };
  const measured = usage(input, output); if (measured) yield measured;
  for (const call of calls) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: finish };
}

export async function* geminiStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  const steps = new Map<number, JsonObject>(); const partial = new Map<number, string>(); const open = new Set<number>();
  let terminal: JsonObject | undefined;
  for await (const data of sse(response)) {
    request.signal.throwIfAborted(); const index = number(data.index) ?? 0;
    if (data.event_type === 'error' || data.event_type === 'interaction.failed') throw new ProviderError('provider_failed', 'Gemini generation failed');
    if (data.event_type === 'step.start') { steps.set(index, { ...object(data.step) }); open.add(index); }
    if (data.event_type === 'step.delta') {
      const delta = object(data.delta); const step = steps.get(index); if (!step) incomplete();
      if (delta.type === 'text' && step.type === 'model_output') {
        const text = string(delta.text); const content = array(step.content); const last = object(content.at(-1));
        if (last.type === 'text') last.text = string(last.text) + text; else content.push({ type: 'text', text }); step.content = content;
        yield { type: 'text', text };
      }
      if (delta.type === 'arguments_delta' && step.type === 'function_call') partial.set(index, (partial.get(index) ?? '') + string(delta.arguments));
      if (delta.type === 'thought_signature') step.signature = string(delta.signature);
      if (delta.type === 'thought_summary') step.summary = [...array(step.summary), delta.content];
    }
    if (data.event_type === 'step.stop') { if (!steps.has(index)) incomplete(); open.delete(index); }
    if (data.event_type === 'interaction.completed') { terminal = object(data.interaction); break; }
  }
  if(!terminal)incomplete();
  const stats = object(terminal.usage); const measured = usage(stats.total_input_tokens, stats.total_output_tokens); if (measured) yield measured;
  if (open.size || !['completed', 'requires_action'].includes(string(terminal.status))) incomplete();
  for(const [index,args] of partial){const step=steps.get(index);if(!step)incomplete();step.arguments=toolArguments(args);}
  const content = [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([, step]) => step);
  const calls = content.filter(step => step.type === 'function_call').map(step => validateCall(step.id, step.name, step.arguments, request));
  yield { type: 'continuation', providerData: { provider: 'gemini', data: content } };
  for (const call of calls) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: string(terminal.status) };
}
