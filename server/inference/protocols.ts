import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import type { JsonSchemaValidator } from '@modelcontextprotocol/client';
import type { ModelChunk, ModelMessage, ToolDefinition, ToolRequest } from '../../shared/types.js';
import { AppError } from '../core/errors.js';

/** Stateless wire translation only. This module has no store, tool broker, filesystem or provider access. */
export type InferenceProtocol = 'responses' | 'chat-completions' | 'anthropic-messages';
export interface InferenceRequest {
  protocol: InferenceProtocol;
  modelId: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  maxOutputTokens: number;
  stream: boolean;
  includeUsage: boolean;
  parallelToolCalls: boolean;
}
export type ParsedInferenceRequest = InferenceRequest;
export interface InferenceIdentity { id: string; model: string; createdAt: number; }
export class InferenceProtocolError extends AppError {
  constructor(code: string, message: string, status = 400, public readonly param?: string) { super(code, message, status); this.name = 'InferenceProtocolError'; }
}
const LIMIT = 1024 * 1024;
const MAX_TOOLS = 64;
const text = z.string().max(LIMIT);
const identifier = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_.:/-]+$/);
const name = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const object = z.record(z.string(), z.unknown());
const outputTokens = z.number().int().min(1).max(8192);
const functionFields = { name, description: z.string().max(8192).optional(), parameters: object, strict: z.boolean().nullable().optional() };
const functionTool = z.object({ type: z.literal('function'), ...functionFields }).strict();
const textPart = z.object({ type: z.literal('text'), text }).strict();
const responsePart = z.union([
  z.object({ type: z.literal('input_text'), text }).strict(),
  z.object({ type: z.literal('output_text'), text, annotations: z.array(z.never()).optional(), logprobs: z.array(z.never()).optional() }).strict(),
]);
const responseMessage = z.object({
  type: z.literal('message').optional(), id: identifier.optional(), role: z.enum(['system', 'developer', 'user', 'assistant']),
  content: z.union([text, z.array(responsePart).min(1).max(256)]), status: z.literal('completed').optional(),
}).strict();
const responseCall = z.object({ type: z.literal('function_call'), id: identifier.optional(), call_id: identifier, name, arguments: text, status: z.literal('completed').optional() }).strict();
const responseResult = z.object({ type: z.literal('function_call_output'), id: identifier.optional(), call_id: identifier, output: z.union([text, z.array(z.object({ type: z.literal('input_text'), text }).strict()).max(256)]) }).strict();
const responsesSchema = z.object({
  model: identifier, input: z.union([text.min(1), z.array(z.union([responseMessage, responseCall, responseResult])).min(1).max(256)]),
  instructions: text.optional(), tools: z.array(functionTool).max(MAX_TOOLS).optional(), stream: z.boolean().optional(),
  max_output_tokens: outputTokens.optional(), store: z.literal(false).optional(), background: z.literal(false).optional(),
  tool_choice: z.enum(['auto', 'none']).optional(), parallel_tool_calls: z.boolean().optional(),
  include: z.array(z.never()).optional(), text: z.object({ format: z.object({ type: z.literal('text') }).strict().optional() }).strict().optional(),
}).strict();
const chatContent = z.union([text, z.array(textPart).min(1).max(256)]);
const chatCall = z.object({ id: identifier, type: z.literal('function'), function: z.object({ name, arguments: text }).strict() }).strict();
const chatSchema = z.object({
  model: identifier,
  messages: z.array(z.union([
    z.object({ role: z.enum(['system', 'developer', 'user']), content: chatContent }).strict(),
    z.object({ role: z.literal('assistant'), content: chatContent.nullable().optional(), tool_calls: z.array(chatCall).min(1).max(MAX_TOOLS).optional() }).strict(),
    z.object({ role: z.literal('tool'), content: chatContent, tool_call_id: identifier }).strict(),
  ])).min(1).max(256),
  tools: z.array(z.object({ type: z.literal('function'), function: z.object(functionFields).strict() }).strict()).max(MAX_TOOLS).optional(),
  stream: z.boolean().optional(), stream_options: z.object({ include_usage: z.boolean().optional() }).strict().optional(),
  max_tokens: outputTokens.optional(), max_completion_tokens: outputTokens.optional(), n: z.literal(1).optional(), store: z.literal(false).optional(),
  tool_choice: z.enum(['auto', 'none']).optional(), parallel_tool_calls: z.boolean().optional(),
  response_format: z.object({ type: z.literal('text') }).strict().optional(),
}).strict().refine(value => value.max_tokens === undefined || value.max_completion_tokens === undefined, 'Choose one output token limit');
const anthropicSchema = z.object({
  model: identifier, max_tokens: outputTokens, stream: z.boolean().optional(), system: chatContent.optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.union([text, z.array(z.union([
    textPart,
    z.object({ type: z.literal('tool_use'), id: identifier, name, input: object }).strict(),
    z.object({ type: z.literal('tool_result'), tool_use_id: identifier, content: z.union([text, z.array(textPart).max(256)]).optional(), is_error: z.boolean().optional() }).strict(),
  ])).min(1).max(256)]) }).strict()).min(1).max(256),
  tools: z.array(z.object({ name, description: z.string().max(8192).optional(), input_schema: object }).strict()).max(MAX_TOOLS).optional(),
  tool_choice: z.union([z.object({ type: z.literal('auto'), disable_parallel_tool_use: z.boolean().optional() }).strict(), z.object({ type: z.literal('none') }).strict()]).optional(),
  thinking: z.object({ type: z.literal('disabled') }).strict().optional(),
}).strict();

function invalid(message: string, param?: string): never { throw new InferenceProtocolError('invalid_request', message, 400, param); }
/** Run before recursive schema parsing: total size, depth, graph shape and plain JSON are bounded independently. */
function boundedJson(value: unknown, limit = LIMIT): string {
  let nodes = 0, bytes = 0;
  const parents = new Set<object>();
  const visit = (item: unknown, depth: number) => {
    if (++nodes > 20000 || depth > 32) invalid('JSON structure exceeds the supported limits');
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) { bytes += 8; return; }
    if (typeof item === 'string') { bytes += Buffer.byteLength(item); if (bytes > limit) invalid('JSON exceeds the supported byte limit'); return; }
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) invalid('Only ordinary JSON values are supported');
    if (parents.has(item)) invalid('Cyclic JSON is not supported');
    parents.add(item);
    for (const [key, child] of Object.entries(item)) { bytes += Buffer.byteLength(key); if (['__proto__', 'prototype', 'constructor'].includes(key)) invalid('Unsupported JSON key'); visit(child, depth + 1); }
    parents.delete(item);
  };
  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized) > limit) invalid('JSON exceeds the supported byte limit');
  return serialized;
}
function argumentObject(value: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return invalid('Function arguments must contain a JSON object'); }
  boundedJson(parsed, 65536);
  const result = object.safeParse(parsed);
  if (!result.success) return invalid('Function arguments must contain a JSON object');
  return result.data;
}
function toolValidator(parameters: Record<string, unknown>): JsonSchemaValidator<Record<string, unknown>> {
  boundedJson(parameters, 16384);
  if (parameters.type !== 'object') invalid('Function parameters must use an object JSON schema');
  let nodes = 0;
  const inspect = (value: unknown, depth: number) => {
    if (++nodes > 512 || depth > 16) invalid('Function schema exceeds complexity limits');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['$ref', '$dynamicRef', '$recursiveRef', 'pattern', 'patternProperties', 'format', 'contentSchema'].includes(key)) invalid('Function schema references, patterns and formats are unsupported');
      inspect(child, depth + 1);
    }
  };
  inspect(parameters, 0);
  try { return new AjvJsonSchemaValidator().getValidator<Record<string, unknown>>(parameters); }
  catch { return invalid('Function parameters contain an unsupported JSON schema'); }
}
function content(value: string | { text: string }[] | null | undefined): string { return typeof value === 'string' ? value : (value ?? []).map(part => part.text).join('\n'); }
function history(messages: ModelMessage[]): void {
  if (messages.length > 512) invalid('Normalized message count exceeds the limit');
  const seen = new Set<string>(), pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId || !pending.delete(message.toolCallId)) invalid('Tool results require a preceding unmatched client tool call');
    } else if (pending.size && message.role !== 'assistant') invalid('Client tool results must resolve all calls before the next conversation turn');
    for (const call of message.toolCalls ?? []) {
      if (seen.has(call.id)) invalid('Tool call identifiers must be unique within the supplied history');
      seen.add(call.id); pending.add(call.id);
    }
  }
  if (pending.size) invalid('Supply every outstanding client tool result; Relay does not execute client tools');
}

export function parseInferenceRequest(protocol: InferenceProtocol, input: unknown): InferenceRequest {
  boundedJson(input);
  let messages: ModelMessage[] = [], tools: ToolDefinition[] = [];
  let modelId: string, maxOutputTokens = 2048, stream = false, includeUsage = false, parallelToolCalls = true;
  if (protocol === 'responses') {
    const parsed = responsesSchema.safeParse(input);
    if (!parsed.success) invalid('Unsupported or invalid Responses request; send complete text/function history with store:false', parsed.error.issues[0]?.path.join('.'));
    const body = parsed.data;
    modelId = body.model; stream = body.stream ?? false; maxOutputTokens = body.max_output_tokens ?? 2048; parallelToolCalls = body.parallel_tool_calls ?? true;
    if (body.instructions) messages.push({ role: 'system', content: body.instructions });
    for (const item of typeof body.input === 'string' ? [{ role: 'user' as const, content: body.input }] : body.input) {
      if (item.type === 'function_call') messages.push({ role: 'assistant', content: '', toolCalls: [{ id: item.call_id, name: item.name, arguments: argumentObject(item.arguments) }] });
      else if (item.type === 'function_call_output') messages.push({ role: 'tool', toolCallId: item.call_id, content: content(item.output) });
      else messages.push({ role: item.role === 'developer' ? 'system' : item.role, content: content(item.content) });
    }
    tools = (body.tool_choice === 'none' ? [] : body.tools ?? []).map(item => ({ name: item.name, description: item.description ?? '', parameters: item.parameters }));
  } else if (protocol === 'chat-completions') {
    const parsed = chatSchema.safeParse(input);
    if (!parsed.success) invalid('Unsupported or invalid Chat Completions request; only text and function tools are supported', parsed.error.issues[0]?.path.join('.'));
    const body = parsed.data;
    modelId = body.model; stream = body.stream ?? false; maxOutputTokens = body.max_completion_tokens ?? body.max_tokens ?? 2048;
    parallelToolCalls = body.parallel_tool_calls ?? true; includeUsage = body.stream_options?.include_usage ?? false;
    messages = body.messages.map(message => ({ role: message.role === 'developer' ? 'system' : message.role, content: content(message.content),
      ...(message.role === 'tool' ? { toolCallId: message.tool_call_id } : {}),
      ...(message.role === 'assistant' && message.tool_calls ? { toolCalls: message.tool_calls.map(call => ({ id: call.id, name: call.function.name, arguments: argumentObject(call.function.arguments) })) } : {}),
    }));
    tools = (body.tool_choice === 'none' ? [] : body.tools ?? []).map(({ function: item }) => ({ name: item.name, description: item.description ?? '', parameters: item.parameters }));
  } else {
    const parsed = anthropicSchema.safeParse(input);
    if (!parsed.success) invalid('Unsupported or invalid Messages request; only text and client function tools are supported', parsed.error.issues[0]?.path.join('.'));
    const body = parsed.data;
    modelId = body.model; stream = body.stream ?? false; maxOutputTokens = body.max_tokens;
    parallelToolCalls = !(body.tool_choice?.type === 'auto' && body.tool_choice.disable_parallel_tool_use);
    if (body.system) messages.push({ role: 'system', content: content(body.system) });
    for (const message of body.messages) {
      if (typeof message.content === 'string') { messages.push({ role: message.role, content: message.content }); continue; }
      for (const block of message.content) {
        if (block.type === 'text') messages.push({ role: message.role, content: block.text });
        else if (block.type === 'tool_use') {
          if (message.role !== 'assistant') invalid('Only assistant messages may contain tool_use');
          boundedJson(block.input, 65536);
          messages.push({ role: 'assistant', content: '', toolCalls: [{ id: block.id, name: block.name, arguments: block.input }] });
        } else {
          if (message.role !== 'user') invalid('Only user messages may contain tool_result');
          messages.push({ role: 'tool', toolCallId: block.tool_use_id, content: `${block.is_error ? '[Client tool returned an error]\n' : ''}${content(block.content)}` });
        }
      }
    }
    tools = (body.tool_choice?.type === 'none' ? [] : body.tools ?? []).map(item => ({ name: item.name, description: item.description ?? '', parameters: item.input_schema }));
  }
  if (new Set(tools.map(tool => tool.name)).size !== tools.length) invalid('Function names must be unique');
  for (const tool of tools) toolValidator(tool.parameters);
  history(messages);
  return { protocol, modelId, messages, tools, maxOutputTokens, stream, includeUsage, parallelToolCalls };
}

type Usage = { input_tokens: number; output_tokens: number; total_tokens: number };
class Output {
  text = '';
  calls: ToolRequest[] = [];
  usage: Usage | null = null;
  done = false;
  private bytes = 0;
  private count = 0;
  private readonly validators: Map<string, JsonSchemaValidator<Record<string, unknown>>>;
  private readonly ids: Set<string>;
  constructor(private readonly request: InferenceRequest) {
    this.validators = new Map(request.tools.map(tool => [tool.name, toolValidator(tool.parameters)]));
    this.ids = new Set(request.messages.flatMap(message => (message.toolCalls ?? []).map(call => call.id)));
  }
  take(chunk: ModelChunk): void {
    if (++this.count > 65536 || this.done) this.fail('Provider returned too many chunks or data after completion');
    if (chunk.type === 'text') { this.bytes += Buffer.byteLength(chunk.text); this.text += chunk.text; }
    if (chunk.type === 'tool_call') {
      const call = chunk.call;
      if (!identifier.safeParse(call.id).success || this.ids.has(call.id) || this.calls.length >= MAX_TOOLS || (!this.request.parallelToolCalls && this.calls.length)) this.fail('Provider returned invalid or duplicate tool call identifiers, or too many calls');
      const validator = this.validators.get(call.name);
      if (!validator) this.fail('Provider requested a tool not offered by the client');
      let serialized: string;
      try { serialized = boundedJson(call.arguments, 65536); } catch { return this.fail('Provider tool arguments exceeded the JSON limits'); }
      if (!validator(call.arguments).valid) this.fail('Provider tool arguments failed the client JSON schema');
      this.ids.add(call.id); this.calls.push(structuredClone(call)); this.bytes += Buffer.byteLength(serialized);
    }
    if (chunk.type === 'usage') {
      if (![chunk.inputTokens, chunk.outputTokens, chunk.inputTokens + chunk.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) this.fail('Provider returned invalid token usage');
      this.usage = { input_tokens: chunk.inputTokens, output_tokens: chunk.outputTokens, total_tokens: chunk.inputTokens + chunk.outputTokens };
    }
    if (this.bytes > LIMIT) this.fail('Provider output exceeded the byte limit');
    if (chunk.type === 'done') {
      if (!['stop', 'tool_calls', 'end_turn'].includes(chunk.finishReason)) this.fail('Provider did not finish successfully');
      if (chunk.finishReason === 'tool_calls' && !this.calls.length) this.fail('Provider reported tool calls without any complete calls');
      if (!this.text && !this.calls.length) this.fail('Provider returned no visible content or client tools');
      this.done = true;
    }
    // Provider continuations may contain private reasoning. They are neither stored nor returned.
  }
  finish(): void {
    if (!this.done) this.fail('Provider stream ended without a successful terminal record');
    if (this.request.protocol === 'anthropic-messages' && !this.usage) this.fail('Provider did not report measured token usage required by the Messages protocol');
  }
  private fail(message: string): never { throw new InferenceProtocolError('invalid_provider_output', message, 502); }
}
function messageItem(identity: InferenceIdentity, text: string, status = 'completed'): Record<string, unknown> {
  return { id: `msg_${identity.id}`, type: 'message', role: 'assistant', status, content: text ? [{ type: 'output_text', text, annotations: [] }] : [] };
}
function callItem(identity: InferenceIdentity, call: ToolRequest, index: number, status = 'completed'): Record<string, unknown> {
  return { id: `fc_${identity.id}_${index}`, type: 'function_call', status, call_id: call.id, name: call.name, arguments: status === 'completed' ? JSON.stringify(call.arguments) : '' };
}
function responseObject(request: InferenceRequest, identity: InferenceIdentity, output: Output, status = 'completed'): Record<string, unknown> {
  if (request.protocol === 'responses') return {
    id: identity.id, object: 'response', created_at: identity.createdAt, model: identity.model, status, error: null, incomplete_details: null,
    output: status === 'completed' ? [...(output.text ? [messageItem(identity, output.text)] : []), ...output.calls.map((call, index) => callItem(identity, call, index))] : [],
    usage: status === 'completed' ? output.usage : null, store: false, parallel_tool_calls: request.parallelToolCalls,
  };
  if (request.protocol === 'chat-completions') return {
    id: identity.id, object: 'chat.completion', created: identity.createdAt, model: identity.model,
    choices: [{ index: 0, message: { role: 'assistant', content: output.text || null, ...(output.calls.length ? { tool_calls: output.calls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}) }, finish_reason: output.calls.length ? 'tool_calls' : 'stop', logprobs: null }],
    usage: chatUsage(output.usage),
  };
  return { id: identity.id, type: 'message', role: 'assistant', model: identity.model,
    content: [...(output.text ? [{ type: 'text', text: output.text }] : []), ...output.calls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments }))],
    stop_reason: output.calls.length ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: output.usage ? { input_tokens: output.usage.input_tokens, output_tokens: output.usage.output_tokens } : null,
  };
}
function chatUsage(usage: Usage | null): Record<string, number> | null { return usage ? { prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, total_tokens: usage.total_tokens } : null; }
export async function encodeInferenceResponse(request: InferenceRequest, identity: InferenceIdentity, chunks: AsyncIterable<ModelChunk>): Promise<Record<string, unknown>> {
  const output = new Output(request);
  for await (const chunk of chunks) output.take(chunk);
  output.finish();
  return responseObject(request, identity, output);
}

/** Text streams immediately; complete tool proposals are withheld until the entire provider stream validates. */
export async function* encodeInferenceStream(request: InferenceRequest, identity: InferenceIdentity, chunks: AsyncIterable<ModelChunk>): AsyncGenerator<string> {
  const output = new Output(request);
  let sequence = 0, textStarted = false;
  const event = (type: string, fields: Record<string, unknown> = {}) => `event: ${type}\ndata: ${JSON.stringify({ type, ...(request.protocol === 'responses' ? { sequence_number: sequence++ } : {}), ...fields })}\n\n`;
  const chat = (delta: Record<string, unknown>, finish: string | null = null) => `data: ${JSON.stringify({ id: identity.id, object: 'chat.completion.chunk', created: identity.createdAt, model: identity.model, choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }], ...(request.includeUsage ? { usage: null } : {}) })}\n\n`;
  if (request.protocol === 'responses') {
    yield event('response.created', { response: responseObject(request, identity, output, 'in_progress') });
    yield event('response.in_progress', { response: responseObject(request, identity, output, 'in_progress') });
  } else if (request.protocol === 'chat-completions') yield chat({ role: 'assistant', content: '' });
  else yield event('message_start', { message: { id: identity.id, type: 'message', role: 'assistant', model: identity.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 }, relay_usage_status: 'pending' } });
  for await (const chunk of chunks) {
    output.take(chunk);
    if (chunk.type !== 'text' || !chunk.text) continue;
    if (request.protocol === 'responses') {
      if (!textStarted) {
        yield event('response.output_item.added', { output_index: 0, item: messageItem(identity, '', 'in_progress') });
        yield event('response.content_part.added', { item_id: `msg_${identity.id}`, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      }
      yield event('response.output_text.delta', { item_id: `msg_${identity.id}`, output_index: 0, content_index: 0, delta: chunk.text });
    } else if (request.protocol === 'chat-completions') yield chat({ content: chunk.text });
    else {
      if (!textStarted) yield event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      yield event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: chunk.text } });
    }
    textStarted = true;
  }
  output.finish();
  if (textStarted && request.protocol === 'responses') {
    const fields = { item_id: `msg_${identity.id}`, output_index: 0, content_index: 0 };
    yield event('response.output_text.done', { ...fields, text: output.text });
    yield event('response.content_part.done', { ...fields, part: { type: 'output_text', text: output.text, annotations: [] } });
    yield event('response.output_item.done', { output_index: 0, item: messageItem(identity, output.text) });
  } else if (textStarted && request.protocol === 'anthropic-messages') yield event('content_block_stop', { index: 0 });
  for (const [index, call] of output.calls.entries()) {
    const outputIndex = index + (textStarted ? 1 : 0);
    if (request.protocol === 'responses') {
      yield event('response.output_item.added', { output_index: outputIndex, item: callItem(identity, call, index, 'in_progress') });
      const fields = { item_id: `fc_${identity.id}_${index}`, output_index: outputIndex };
      yield event('response.function_call_arguments.delta', { ...fields, delta: JSON.stringify(call.arguments) });
      yield event('response.function_call_arguments.done', { ...fields, arguments: JSON.stringify(call.arguments) });
      yield event('response.output_item.done', { output_index: outputIndex, item: callItem(identity, call, index) });
    } else if (request.protocol === 'chat-completions') yield chat({ tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] });
    else {
      yield event('content_block_start', { index: outputIndex, content_block: { type: 'tool_use', id: call.id, name: call.name, input: {} } });
      yield event('content_block_delta', { index: outputIndex, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.arguments) } });
      yield event('content_block_stop', { index: outputIndex });
    }
  }
  if (request.protocol === 'responses') yield event('response.completed', { response: responseObject(request, identity, output) });
  else if (request.protocol === 'chat-completions') {
    yield chat({}, output.calls.length ? 'tool_calls' : 'stop');
    if (request.includeUsage) yield `data: ${JSON.stringify({ id: identity.id, object: 'chat.completion.chunk', created: identity.createdAt, model: identity.model, choices: [], usage: chatUsage(output.usage) })}\n\n`;
    yield 'data: [DONE]\n\n';
  } else {
    yield event('message_delta', { delta: { stop_reason: output.calls.length ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { input_tokens: output.usage!.input_tokens, output_tokens: output.usage!.output_tokens }, relay_usage_status: 'measured' });
    yield event('message_stop');
  }
}

/** Errors deliberately exclude provider messages, prompt content and client tool arguments. */
export function encodeInferenceError(protocol: InferenceProtocol, error: unknown): Record<string, unknown> {
  const known = error instanceof InferenceProtocolError;
  const message = known ? error.message : 'Inference failed or was interrupted';
  const code = known ? error.code : 'inference_error';
  if (protocol === 'anthropic-messages') return { type: 'error', error: { type: known && error.status < 500 ? 'invalid_request_error' : 'api_error', message } };
  return { error: { message, type: known && error.status < 500 ? 'invalid_request_error' : 'server_error', code, param: known ? error.param ?? null : null } };
}
