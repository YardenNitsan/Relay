import type {ProviderId} from '../../shared/types.js';
import {object, ProviderError, string, type JsonObject} from './transport.js';

/** Provider cursors are opaque data, never URLs. A failed or bounded scan cannot
 * masquerade as a complete account catalog. Credential scope stays with caller. */
export async function cloudCatalog(provider: ProviderId, fetchPage: (path: string) => Promise<JsonObject>): Promise<JsonObject> {
  const key = provider === 'gemini' ? 'models' : 'data';
  const entries: unknown[] = [];
  const cursors = new Set<string>();
  let path = '/models';
  let bytes = 0;
  for (let page = 0; page < 20; page++) {
    const response = await fetchPage(path);
    const rows = response[key];
    if (!Array.isArray(rows)) throw new ProviderError('catalog_invalid', 'Provider model catalog returned an invalid page.');
    bytes += Buffer.byteLength(JSON.stringify(response));
    if (entries.length + rows.length > 2000 || bytes > 8 * 1024 * 1024) {
      throw new ProviderError('catalog_limit', 'Provider model catalog exceeded safe discovery limits.');
    }
    entries.push(...rows);
    let cursor: unknown;
    if (provider === 'anthropic') {
      if (response.has_more !== undefined && typeof response.has_more !== 'boolean') throw new ProviderError('catalog_invalid', 'Provider model catalog returned invalid pagination.');
      if (response.has_more === true) cursor = response.last_id;
      else break;
    } else if (provider === 'gemini') {
      cursor = response.nextPageToken;
      if (cursor === undefined || cursor === null || cursor === '') break;
    } else break;
    if (typeof cursor !== 'string' || !cursor.trim() || cursor.length > 4096 || cursors.has(cursor)) {
      throw new ProviderError('catalog_invalid', 'Provider model catalog returned invalid or repeated pagination.');
    }
    cursors.add(cursor);
    if (page === 19) throw new ProviderError('catalog_limit', 'Provider model catalog exceeded safe discovery limits.');
    path = `/models?${new URLSearchParams({[provider === 'anthropic' ? 'after_id' : 'pageToken']: cursor})}`;
  }
  // A provider catalog can change between pages. Retain the first observation
  // for duplicate identities; don't advertise duplicate selectable models.
  const seen = new Set<string>();
  return {[key]: entries.filter(entry => {
    const row = object(entry);
    const id = string(row.id || row.name);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  })};
}
