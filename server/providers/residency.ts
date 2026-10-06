import { array, number, object, ProviderError, string, type JsonObject } from './transport.js';

export interface ResidentModel {
  id: string;
  digest: string | null;
  reportedBytes: number | null;
  gpuBytes: number | null;
  contextTokens: number | null;
  expiresAt: string | null;
}
export interface ResidentModelsSnapshot {
  state: 'observed' | 'unavailable' | 'disabled';
  source: 'ollama/api/ps';
  sampledAt: string;
  models: ResidentModel[];
  truncated: boolean;
  error: string | null;
}

/** Runtime resident allocation is an observation, never a measured peak or ownership proof. */
export function residentSnapshot(data: JsonObject): ResidentModelsSnapshot {
  if (!Array.isArray(data.models)) throw new ProviderError('invalid_inventory', 'Ollama returned an invalid resident inventory');
  const rows = array(data.models);
  const models = rows.slice(0, 100).map(object).flatMap(model => {
    const name = string(model.name || model.model); if (!name || name.length > 512) return [];
    const context = number(model.context_length); const expiry = Date.parse(string(model.expires_at));
    return [{ id: `ollama/${name}`, digest: string(model.digest).slice(0, 512) || null, reportedBytes: number(model.size), gpuBytes: number(model.size_vram), contextTokens: context !== null && context > 0 && Number.isSafeInteger(context) ? context : null, expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : null }];
  });
  return { state: 'observed', source: 'ollama/api/ps', sampledAt: new Date().toISOString(), models, truncated: rows.length > 100, error: null };
}
