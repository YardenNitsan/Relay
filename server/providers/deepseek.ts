import type { ModelChunk, ModelRequest } from '../../shared/types.js';
import { array, number, object, ProviderError, outputLimitError, sse, string, toolArguments } from './transport.js';
import { VisibleText } from './visible-text.js';

/** DeepSeek requires reasoning_content to remain attached to assistant turns in
 * tool conversations. It travels only through private provider continuation. */
export async function* deepseekStream(response: Response, request: ModelRequest): AsyncGenerator<ModelChunk> {
  const calls = new Map<number, { id: string; name: string; arguments: string }>();
  const visibility = new VisibleText();
  let content = ''; let reasoning = ''; let finish = '';
  let input: number | null = null; let output: number | null = null; let cached: number | null = null;
  for await (const data of sse(response)) {
    request.signal.throwIfAborted();
    if (data.error) throw new ProviderError('provider_failed', 'DeepSeek generation failed');
    if (data.usage) { const stats = object(data.usage); input = number(stats.prompt_tokens) ?? input; output = number(stats.completion_tokens) ?? output; cached = number(stats.prompt_cache_hit_tokens) ?? cached; }
    const choices = array(data.choices);
    if (!choices.length) continue;
    const choice = object(choices[0]);
    if (choices.length !== 1 || (choice.index !== undefined && choice.index !== 0) || finish) throw new ProviderError('invalid_stream', 'DeepSeek returned unexpected completion choices');
    const delta = object(choice.delta);
    const text = string(delta.content); content += text; reasoning += string(delta.reasoning_content);
    const visible = visibility.push(text); if (visible) yield { type: 'text', text: visible };
    for (const item of array(delta.tool_calls).map(object)) {
      const index = number(item.index);
      if (index === null || !Number.isSafeInteger(index) || index > 7) throw new ProviderError('invalid_tool', 'DeepSeek returned an invalid tool index');
      const call = calls.get(index) ?? { id: '', name: '', arguments: '' }; const fn = object(item.function);
      call.id += string(item.id); call.name += string(fn.name); call.arguments += string(fn.arguments); calls.set(index, call);
    }
    if (choice.finish_reason) finish = string(choice.finish_reason);
  }
  if(finish==='length'){if(input!==null&&output!==null)yield {type:'usage',inputTokens:input,outputTokens:output,...(cached!==null?{cachedInputTokens:cached}:{})};throw outputLimitError();}
  if (!['stop', 'tool_calls'].includes(finish) || (calls.size > 0) !== (finish === 'tool_calls')) throw new ProviderError('incomplete_stream', 'DeepSeek stream ended incomplete; no tools were dispatched');
  const complete = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => {
    if (!call.id || !request.tools.some(tool => tool.name === call.name)) throw new ProviderError('invalid_tool', 'DeepSeek requested an unavailable tool');
    return { ...call, arguments: toolArguments(call.arguments) };
  });
  if (new Set(complete.map(call => call.id)).size !== complete.length) throw new ProviderError('invalid_tool', 'DeepSeek returned duplicate tool calls');
  const tail = visibility.finish(); if (tail) yield { type: 'text', text: tail };
  yield { type: 'continuation', providerData: { provider: 'deepseek', data: {
    role: 'assistant', content, reasoning_content: reasoning,
    ...(complete.length ? { tool_calls: complete.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
  } } };
  if (input !== null && output !== null) yield { type: 'usage', inputTokens: input, outputTokens: output, ...(cached !== null ? { cachedInputTokens: cached } : {}) };
  for (const call of complete) yield { type: 'tool_call', call };
  yield { type: 'done', finishReason: finish };
}
