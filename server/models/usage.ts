import type { ModelChunk } from '../../shared/types.js';

/** Persist only finite counters, never arbitrary provider metadata or private continuation. */
export function usageRecord(usage:Extract<ModelChunk,{type:'usage'}>|undefined):Record<string,number>|null {
  if(!usage)return null;
  const result:Record<string,number>={};
  for(const key of ['inputTokens','outputTokens','durationMs','loadDurationMs','cachedInputTokens','generationTokensPerSecond','promptTokensPerSecond'] as const){const value=usage[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)result[key]=value;}
  return result;
}
