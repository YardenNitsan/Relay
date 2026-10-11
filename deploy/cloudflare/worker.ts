import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import {offlinePage} from './offline-page.js';

export interface RelayWorkerEnv {
  RELAY_HOST: { fetch(request: Request): Promise<Response> };
  RELAY_PUBLIC_ORIGIN: string;
  RELAY_ACCESS_ISSUER: string;
  RELAY_ACCESS_AUDIENCE: string;
}

const MAX_BODY = 1024 * 1024;
const bytes = new TextEncoder();
const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const publicOrigin = new RegExp(`^https://${label}\\.${label}\\.workers\\.dev$`);
const accessIssuer = new RegExp(`^https://${label}\\.cloudflareaccess\\.com$`);
const safeMethods = new Set(['GET', 'HEAD']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const forwardedHeaders = ['accept', 'accept-language', 'content-type', 'cookie', 'origin', 'user-agent', 'x-relay-csrf', 'last-event-id', 'if-none-match', 'if-modified-since', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'];

class Denied extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function deny(status: number, message: string): never { throw new Denied(status, message); }
function failure(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': 'max-age=31536000',
  } });
}
function configuration(env: RelayWorkerEnv) {
  if (typeof env.RELAY_PUBLIC_ORIGIN !== 'string' || !publicOrigin.test(env.RELAY_PUBLIC_ORIGIN)
    || typeof env.RELAY_ACCESS_ISSUER !== 'string' || !accessIssuer.test(env.RELAY_ACCESS_ISSUER)
    || typeof env.RELAY_ACCESS_AUDIENCE !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(env.RELAY_ACCESS_AUDIENCE) || typeof env.RELAY_HOST?.fetch !== 'function')
    deny(503, 'Gateway configuration is incomplete.');
  return { origin: env.RELAY_PUBLIC_ORIGIN, host: new URL(env.RELAY_PUBLIC_ORIGIN).host, issuer: env.RELAY_ACCESS_ISSUER, audience: env.RELAY_ACCESS_AUDIENCE };
}
function allowedPath(path: string, method: string): boolean {
  if (safeMethods.has(method) && (path === '/' || path === '/index.html' || /^\/assets\/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:js|css|woff2?|ttf|svg|png|ico)$/.test(path))) return true;
  if (!/^\/api\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) return false;
  // Local owner operations and native-client inference are never routed here.
  return !/^\/api\/(?:admin(?:\/|$)|session\/pair$|stop$|resume$|hardware$)/.test(path);
}
function validateRequest(request: Request, config: ReturnType<typeof configuration>): URL {
  if (bytes.encode(request.url).byteLength > 8192) deny(414, 'Request URL is too large.');
  const url = new URL(request.url);
  if (url.origin !== config.origin || request.headers.get('host') !== config.host || url.username || url.password || url.hash)
    deny(403, 'Unrecognized request origin.');
  if (!methods.has(request.method) || request.headers.has('upgrade')) deny(405, 'Request method is not supported.');
  if (!allowedPath(url.pathname, request.method)) deny(404, 'This route is not exposed.');
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== config.origin || !safeMethods.has(request.method) && origin !== config.origin)
    deny(403, 'A same-origin request is required.');
  const entry = request.method === 'GET' && ['/', '/index.html'].includes(url.pathname)
    && request.headers.get('sec-fetch-mode') === 'navigate' && request.headers.get('sec-fetch-dest') === 'document';
  if (request.headers.get('sec-fetch-site') === 'cross-site' && !entry) deny(403, 'Cross-site requests are not permitted.');
  let size = 0;
  for (const [name, value] of request.headers) {
    size += bytes.encode(name).byteLength + bytes.encode(value).byteLength;
    if (size > 32 * 1024) deny(431, 'Request headers are too large.');
  }
  return url;
}

/** Buffer only a bounded inbound body so oversize/partial JSON never reaches an
 * action handler. Responses, including indefinite SSE, are never buffered. */
async function requestBody(request: Request): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const path=new URL(request.url).pathname;
  const maximum=request.method==='POST'&&/^\/api\/workspaces\/[a-f0-9-]{36}\/documents$/.test(path)?12*1024*1024:MAX_BODY;
  const declared = request.headers.get('content-length');
  if (declared !== null && !/^(0|[1-9][0-9]{0,9})$/.test(declared)) deny(400, 'Invalid request length.');
  const expected = declared === null ? null : Number(declared);
  if (expected !== null && expected > maximum) deny(413, 'Request exceeds this route’s size limit.');
  if (request.headers.has('content-encoding')) deny(400, 'Encoded request bodies are not supported.');
  if (!request.body) {
    if (expected !== null && expected !== 0) deny(400, 'Request length does not match its body.');
    return undefined;
  }
  if (safeMethods.has(request.method) || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? ''))
    deny(400, 'Only JSON action bodies are supported.');
  const reader = request.body.getReader(), bounded = new Uint8Array(maximum);
  let size = 0, chunks = 0, timer: ReturnType<typeof setTimeout> | undefined, rejectRead!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { rejectRead = reject; });
  const cancel = () => { rejectRead(new Denied(408, 'Request body was interrupted.')); void reader.cancel().catch(() => undefined); };
  request.signal.addEventListener('abort', cancel, { once: true });
  timer = setTimeout(cancel, 10000);
  try {
    if (request.signal.aborted) cancel();
    while (true) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) break;
      if (++chunks > 65536 || size + next.value.byteLength > maximum) deny(413, 'Request exceeds processing limits.');
      bounded.set(next.value, size); size += next.value.byteLength;
    }
    if (expected !== null && expected !== size) deny(400, 'Request length does not match its body.');
    return bounded.slice(0, size);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener('abort', cancel);
    void reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}

/** One public browser origin and one fixed VPC Service binding. No public fetch
 * fallback, user-selected destination, database, content logs or Worker state. */
export function createRelayWorker(keys?: JWTVerifyGetKey) {
  let cached: { issuer: string; keys: JWTVerifyGetKey } | undefined;
  return { async fetch(request: Request, env: RelayWorkerEnv): Promise<Response> {
    try {
      const config = configuration(env), url = validateRequest(request, config);
      const token = request.headers.get('cf-access-jwt-assertion');
      if (!token || token.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) deny(401, 'A verified Cloudflare Access browser login is required.');
      if (!keys && cached?.issuer !== config.issuer) cached = { issuer: config.issuer, keys: createRemoteJWKSet(new URL('/cdn-cgi/access/certs', config.issuer), { timeoutDuration: 5000, cooldownDuration: 30000 }) };
      let expiresAt: number;
      try {
        const { payload } = await jwtVerify(token, keys ?? cached!.keys, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'email'], clockTolerance: 5 });
        const now = Date.now();
        if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub.length || payload.sub.length > 512 || /[\x00-\x1f\x7f]/.test(payload.sub)
          || typeof payload.email !== 'string' || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
          || typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp * 1000) || payload.exp * 1000 <= now
          || typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat * 1000) || payload.iat * 1000 > now + 5000 || payload.iat >= payload.exp) throw new Error('Invalid identity');
        expiresAt = payload.exp * 1000;
      } catch { deny(401, 'The Cloudflare Access browser identity could not be verified.'); }
      const body = await requestBody(request);
      if (Date.now() >= expiresAt) deny(401, 'The Cloudflare Access browser identity expired.');
      if (request.signal.aborted) deny(408, 'Request was interrupted.');
      const headers = new Headers();
      for (const name of forwardedHeaders) { const value = request.headers.get(name); if (value !== null) headers.set(name, value); }
      headers.set('host', config.host); headers.set('cf-access-jwt-assertion', token);
      // VPC configuration fixes the physical target at 127.0.0.1:4318. This URL
      // controls HTTP Host only; it is never fetched over the public Internet.
      const target = `http://${config.host}${url.pathname}${url.search}`;
      const upstream = new Request(target, { method: request.method, headers, body, redirect: 'manual', signal: request.signal });
      try { return await env.RELAY_HOST.fetch(upstream); }
      catch {
        if(request.method==='GET'&&['/','/index.html'].includes(url.pathname)&&request.headers.get('accept')?.includes('text/html'))return offlinePage();
        return failure(502, 'The Relay host is unavailable. Local access is independent.');
      }
    } catch (error) {
      return error instanceof Denied ? failure(error.status, error.message) : failure(503, 'The secure gateway is unavailable.');
    }
  } };
}

export default createRelayWorker();
