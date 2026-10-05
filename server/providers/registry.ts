import type { ModelProfile, ProviderId } from '../../shared/types.js';
import { array, number, object, string, type JsonObject } from './transport.js';

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
export function cloudModels(provider: 'openai' | 'anthropic' | 'gemini', response: JsonObject): ModelProfile[] {
  return array(provider === 'gemini' ? response.models : response.data).map(object).filter(item => {
    const id = string(item.id || item.name).replace(/^models\//, '');
    if (provider === 'openai') return /^(gpt-|o[134])/.test(id) && !/(audio|realtime|transcribe|tts|image|search|instruct|embedding)/.test(id);
    if (provider === 'gemini') return /^gemini-/.test(id) && !/(image|tts|embedding|robotics|live)/.test(id);
    return /^claude-/.test(id);
  }).map(item => {
    const id = string(item.id || item.name).replace(/^models\//, ''); const result = profile(provider, id);
    result.name = string(item.display_name || item.displayName) || id;
    result.contextWindow = number(item.max_input_tokens ?? item.inputTokenLimit);
    // Conservative family compatibility is labelled, never presented as a benchmark.
    const knownFamily = provider === 'openai' ? /^(gpt-[456]|o[34])/.test(id) : provider === 'anthropic' ? /^claude-(sonnet|opus|haiku)-[45]/.test(id) : /^gemini-[23]/.test(id);
    const capabilities = object(item.capabilities);
    result.capabilities = { tools: knownFamily, vision: !!object(capabilities.image_input).supported, reasoning: !!object(capabilities.thinking).supported || /^(o[34]|gpt-[56]|gemini-[23])/.test(id), structured: knownFamily };
    result.details = { ...result.details, capabilitySource: Object.keys(capabilities).length ? 'provider model metadata + documented family tool support' : 'documented family support; model-specific limits unknown', capabilities, maxOutputTokens: number(item.max_tokens ?? item.outputTokenLimit) };
    return result;
  });
}
export function lmstudioModels(response: JsonObject): ModelProfile[] {
  return array(response.models).map(object).filter(item => item.type === 'llm').map(item => {
    const result = profile('lmstudio', string(item.key)); const loaded = object(array(item.loaded_instances)[0]); const config = object(loaded.config);
    result.name = string(item.display_name) || string(item.key); result.sizeBytes = number(item.size_bytes); result.quantization = string(object(item.quantization).name) || null;
    result.contextWindow = number(item.max_context_length); result.state = array(item.loaded_instances).length ? 'ready' : 'available';
    result.details = { ...result.details, architecture: item.architecture, loaded, loadedContext: number(config.context_length), limitation: 'Native metadata does not provide attention geometry; automatic memory admission is unavailable until calibrated.' };
    return result;
  });
}
