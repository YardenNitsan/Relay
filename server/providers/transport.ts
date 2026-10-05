/** Protocol parsing is bounded independently of HTTP chunk boundaries. */
export type JsonObject = Record<string, unknown>;
export function object(value: unknown): JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
export class ProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number) { super(message); this.name = 'ProviderError'; }
}

async function* lines(response: Response, maxBytes: number): AsyncGenerator<string> {
  if (!response.body) throw new ProviderError('empty_stream', 'Provider returned no stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) { buffer += decoder.decode(); break; }
      bytes += chunk.value.length;
      if (bytes > 32 * 1024 * 1024) throw new ProviderError('stream_limit', 'Provider stream exceeded the output limit');
      buffer += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, '');
        if (Buffer.byteLength(line) > maxBytes) throw new ProviderError('record_limit', 'Provider record exceeded the limit');
        yield line;
        buffer = buffer.slice(end + 1);
      }
      if (Buffer.byteLength(buffer) > maxBytes) throw new ProviderError('record_limit', 'Provider record exceeded the limit');
    }
    if (buffer.length) yield buffer.replace(/\r$/, '');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function parse(value: string): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ProviderError('invalid_json', 'Provider returned invalid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderError('invalid_record', 'Provider returned an invalid record');
  return parsed as JsonObject;
}
export async function* ndjson(response: Response, limit = 1024 * 1024): AsyncGenerator<JsonObject> {
  for await (const line of lines(response, limit)) if (line.trim()) yield parse(line);
}
export async function* sse(response: Response, limit = 1024 * 1024): AsyncGenerator<JsonObject> {
  let data: string[] = [];
  let size = 0;
  for await (const line of lines(response, limit)) {
    if (!line) {
      if (data.length) { const joined = data.join('\n'); if (joined !== '[DONE]') yield parse(joined); }
      data = []; size = 0;
    } else if (line.startsWith('data:')) {
      const value = line.slice(5).replace(/^ /, ''); size += Buffer.byteLength(value);
      if (size > limit) throw new ProviderError('record_limit', 'Provider event exceeded the limit');
      data.push(value);
    }
  }
  // An event without its terminating blank line is not complete.
  if (data.length) throw new ProviderError('incomplete_stream', 'Provider stream ended with an incomplete event');
}
export function toolArguments(value: unknown): JsonObject {
  let parsed: unknown = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { throw new ProviderError('invalid_tool_arguments', 'Provider tool arguments are not valid JSON'); } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ProviderError('invalid_tool_arguments', 'Provider tool arguments must be an object');
  return parsed as JsonObject;
}
export function requireSuccess(response: Response): void {
  if (!response.ok) throw new ProviderError(`http_${response.status}`, `Provider request failed (HTTP ${response.status})`, response.status);
}
