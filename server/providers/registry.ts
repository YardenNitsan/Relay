import type { ModelProfile, ProviderId } from '../../shared/types.js';
import { array, number, object, string, type JsonObject } from './transport.js';
import {reasoningControls,type GeminiTransport} from './reasoning.js';

export function profile(provider: ProviderId, id: string): ModelProfile {
  return { id: `${provider}/${id}`, name: id, provider, runtime: provider, local: provider === 'ollama' || provider === 'lmstudio', capabilities: { tools: false, vision: false, reasoning: false, structured: false }, contextWindow: null, quantization: null, sizeBytes: null, state: 'available', details: { discoveredAt: new Date().toISOString(), capabilitySource: 'unknown' }, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null };
}
export function ollamaModel(tag: JsonObject, metadata: JsonObject, running: JsonObject): ModelProfile {
  const result = profile('ollama', string(tag.name) || string(tag.model));
  const info = object(metadata.model_info); const details = object(tag.details); const capabilities = array(metadata.capabilities);
  const remoteHost = string(metadata.remote_host || tag.remote_host); const remoteModel = string(metadata.remote_model || tag.remote_model);
  result.sizeBytes = number(tag.size); result.quantization = string(details.quantization_level) || null;
  result.contextWindow = number(info[`${string(info['general.architecture'])}.context_length`]);
  result.capabilities = { tools: capabilities.includes('tools'), vision: capabilities.includes('vision'), reasoning: capabilities.includes('thinking'), structured: capabilities.includes('completion') };
  result.local = !remoteHost && !remoteModel;
  result.state = result.local ? running.name ? 'ready' : 'available' : 'offline';
  result.details = { ...result.details, capabilitySource: 'runtime /api/show', digest: tag.digest, modelInfo: info, thinking: metadata.thinking ?? null, ...(result.local ? {} : { remoteHost, remoteModel, limitation: 'Ollama cloud forwarding is unsupported; configure a direct authorized cloud provider.' }), ...(running.name ? { loaded: { sizeVram: number(running.size_vram), sizeBytes: number(running.size), contextLength: number(running.context_length), sampledAt: new Date().toISOString() } } : {}) };
  return result;
}
export function cloudModels(provider: 'openai' | 'anthropic' | 'gemini' | 'xai' | 'deepseek', response: JsonObject,transport:GeminiTransport='interactions'): ModelProfile[] {
  return array(provider === 'gemini' ? response.models : response.data).map(object).filter(item => {
    const id = string(item.id || item.name).replace(/^models\//, '');
    if (provider === 'openai') return /^(gpt-|o[134])/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|embedding)/.test(id);
    if (provider === 'gemini') return /^gemini-/.test(id) && !/(image|tts|embedding|robotics|live)/.test(id);
    if (provider === 'xai') return /^grok-/.test(id) && !/(image|imagine|video|voice|audio|embedding|multi-agent)/.test(id);
    if (provider === 'deepseek') return /^deepseek-/.test(id) && !/(embedding|ocr)/.test(id);
    return /^claude-/.test(id);
  }).map(item => {
    const id = string(item.id || item.name).replace(/^models\//, ''); const result = profile(provider, id);
    result.name = string(item.display_name || item.displayName || (provider==='deepseek'?item.name:undefined)) || id;
    result.contextWindow = number(item.max_input_tokens ?? item.inputTokenLimit ?? item.context_window ?? item.context_length);
    // A capability is control metadata, never evidence of model quality.
    result.reasoning=reasoningControls(provider,id,item,transport);
    if(provider==='gemini')result.details.transport=transport;
    result.details.maxOutputTokens = provider==='xai'?null:number(item.max_output_tokens ?? item.max_tokens ?? item.outputTokenLimit);
    if (provider === 'xai' || provider === 'deepseek') {
      const known = provider === 'xai' ? /^grok-(?:[34](?:[.-]|$)|code-fast(?:-|$))/.test(id) || id === 'grok-build-0.1' : /^(?:deepseek-flash|deepseek-v4-pro|deepseek-v4-flash|deepseek-v4-flash-vision-exp|deepseek-chat|deepseek-reasoner)$/.test(id);
      const documentedContext = provider === 'xai' && id === 'grok-4.7' ? 500_000 : provider === 'deepseek' && /^(deepseek-flash|deepseek-v4-pro|deepseek-v4-flash|deepseek-v4-flash-vision-exp)$/.test(id) ? 1_000_000 : null;
      result.contextWindow ??= documentedContext;
      result.capabilities = { tools: known, vision: false, reasoning: known && !/non-reasoning/.test(id), structured: known };
      result.details = { ...result.details, capabilitySource: known ? 'documented text/function support, checked 2026-10-09; not a measured benchmark' : 'unknown', contextSource: documentedContext ? 'official model documentation, checked 2026-10-09' : 'provider metadata or unknown', protocol: provider === 'xai' ? 'responses' : 'chat-completions', limitation: 'Text and broker-controlled functions only. Images and provider-hosted tools are not enabled. Financial budgets require current model-specific pricing evidence.' };
      return result;
    }
    // Conservative family compatibility is labelled, never presented as a benchmark.
    const knownFamily = provider === 'openai' ? /^(gpt-[456]|o[34])/.test(id) : provider === 'anthropic' ? /^claude-(sonnet|opus|haiku)-[45]/.test(id) : /^gemini-[23]/.test(id);
    const capabilities = object(item.capabilities);
    result.capabilities = { tools: knownFamily, vision: !!object(capabilities.image_input).supported, reasoning: provider==='gemini'&&item.thinking===false?false:item.thinking===true || !!object(capabilities.thinking).supported || !!result.reasoning?.levels.some(level=>level!=='none') || /^(o[34]|gpt-[56]|gemini-[23])/.test(id), structured: knownFamily };
    result.details = { ...result.details, capabilitySource: Object.keys(capabilities).length ? 'provider model metadata + documented family tool support' : 'documented family support; model-specific limits unknown', capabilities };
    return result;
  });
}
export function lmstudioModels(response: JsonObject): ModelProfile[] {
  return array(response.models).map(object).filter(item => item.type === 'llm' && string(item.key).trim()).map(item => {
    const result = profile('lmstudio', string(item.key)); const loaded = object(array(item.loaded_instances)[0]); const config = object(loaded.config);
    result.name = string(item.display_name) || string(item.key); result.sizeBytes = number(item.size_bytes); result.quantization = string(object(item.quantization).name) || null;
    result.contextWindow = number(item.max_context_length); result.state = array(item.loaded_instances).length ? 'ready' : 'available';
    const capabilities=object(item.capabilities);
    result.capabilities={tools:capabilities.trained_for_tool_use===true,vision:capabilities.vision===true,reasoning:array(object(capabilities.reasoning).allowed_options).some(option=>['on','low','medium','high'].includes(string(option))),structured:false};
    result.details = { ...result.details, capabilitySource: 'LM Studio /api/v1/models', architecture: item.architecture, loaded, loadedContext: number(config.context_length), limitation: 'Relay checks native runtime memory estimates and loads a private, bounded-context instance before generation. Models that exceed current safe RAM/VRAM remain queued.' };
    return result;
  });
}
