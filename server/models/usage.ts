import type { ModelChunk,ModelTiming } from '../../shared/types.js';

/** Adapter observations, kept distinct from provider-reported usage counters. */
export function timingRecord(timing:ModelTiming):Record<string,number>{
  const result:Record<string,number>={};
  for(const key of ['firstContentMs','loadWallMs','cleanupWallMs','streamWallMs'] as const){const value=timing[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)result[key]=value;}
  return result;
}

/** Persist only finite counters, never arbitrary provider metadata or private continuation. */
export function usageRecord(usage:Extract<ModelChunk,{type:'usage'}>|undefined):Record<string,number>|null {
  if(!usage)return null;
  const result:Record<string,number>={};
  for(const key of ['inputTokens','outputTokens','durationMs','loadDurationMs','cachedInputTokens','generationTokensPerSecond','promptTokensPerSecond'] as const){const value=usage[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0)result[key]=value;}
  return result;
}
