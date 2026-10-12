import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey, type JWTPayload } from 'jose';
import { createRelayWorker, type RelayWorkerEnv } from '../deploy/cloudflare/worker.js';

const origin = 'https://relay-owner.example-account.workers.dev';
const issuer = 'https://relay-team.cloudflareaccess.com';
const audience = 'relay-browser-audience';
let privateKey: CryptoKey, keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  keys = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'relay-worker-test' }] });
});
function sign(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: [audience], type: 'app', sub: 'google-or-otp-subject', email: 'friend@example.com', iat: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'relay-worker-test' }).sign(privateKey);
}
function incoming(token: string | undefined, path = '/api/session', init: RequestInit = {}) {
  const headers = new Headers({ host: new URL(origin).host });
  if (token) headers.set('cf-access-jwt-assertion', token);
  for (const [key, value] of new Headers(init.headers)) headers.set(key, value);
  return new Request(`${origin}${path}`, { ...init, headers });
}
function fixture(upstream = new Response('host-response', { headers: { 'Content-Security-Policy': "default-src 'self'", 'Set-Cookie': '__Host-relay_remote=session; Secure; HttpOnly; Path=/; SameSite=Strict' } })) {
  const seen: Request[] = [];
  const env: RelayWorkerEnv = { RELAY_PUBLIC_ORIGIN: origin, RELAY_ACCESS_ISSUER: issuer, RELAY_ACCESS_AUDIENCE: audience,
    RELAY_HOST: { async fetch(request) { seen.push(request); return upstream; } } };
  return { worker: createRelayWorker(keys), env, seen, upstream };
}

describe('fixed Cloudflare VPC browser gateway', () => {
  it('gives authenticated document navigation a private, actionable offline page while API failures stay JSON',async()=>{
    const f=fixture();f.env.RELAY_HOST.fetch=async()=>{throw new Error('private endpoint sentinel');};
    const token=await sign();
    for(const path of ['/','/index.html']){
      const response=await f.worker.fetch(incoming(token,path,{headers:{accept:'text/html'}}),f.env);
      expect(response.status).toBe(502);expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('cache-control')).toBe('no-store');
      const html=await response.text();expect(html).toContain('Your Relay host is unavailable');expect(html).toContain('Try again');
      expect(html).not.toContain('private endpoint');expect(html).not.toContain(token);expect(html).not.toContain('<script');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    }
    const api=await f.worker.fetch(incoming(token,'/api/session',{headers:{accept:'text/html'}}),f.env);
    expect(api.headers.get('content-type')).toContain('application/json');expect(api.status).toBe(502);
    const anonymous=await f.worker.fetch(incoming(undefined,'/',{headers:{accept:'text/html'}}),f.env);
    expect(anonymous.status).toBe(401);expect(anonymous.headers.get('content-type')).toContain('application/json');
  });
  it('verifies browser identity and forwards the original assertion only to the fixed binding', async () => {
    const token = await sign(), f = fixture();
    const response = await f.worker.fetch(incoming(token, '/api/events?after=42', { headers: { origin, cookie: '__Host-relay_remote=opaque', 'x-relay-csrf': 'csrf' } }), f.env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('host-response');
    expect(f.seen).toHaveLength(1);
    expect(f.seen[0].url).toBe('http://relay-owner.example-account.workers.dev/api/events?after=42');
    expect(f.seen[0].redirect).toBe('manual');
    expect(f.seen[0].headers.get('host')).toBe('relay-owner.example-account.workers.dev');
    expect(f.seen[0].headers.get('cf-access-jwt-assertion')).toBe(token);
    expect(f.seen[0].headers.get('cookie')).toBe('__Host-relay_remote=opaque');
    expect(f.seen[0].headers.get('x-relay-csrf')).toBe('csrf');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(response.headers.get('set-cookie')).toContain('SameSite=Strict');
  });
  it('does not call the host without an authenticated browser identity', async () => {
    for (const token of [undefined, 'not.a.jwt', 'x'.repeat(16_001)]) {
      const f = fixture(); const response = await f.worker.fetch(incoming(token), f.env);
      expect(response.status).toBe(401); expect(f.seen).toHaveLength(0);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it.each([
    { type: 'org' }, { sub: '', common_name: 'service.access', email: undefined }, { aud: 'other-app' },
    { iss: 'https://other.cloudflareaccess.com' }, { email: undefined }, { email: 'bad-email' }, { sub: undefined },
    { exp: undefined }, { exp: 1 }, { iat: undefined }, { iat: 9_007_199_254_740_992 },
  ] as JWTPayload[])('rejects signed identities outside the configured human application boundary', async override => {
    const f = fixture(); const response = await f.worker.fetch(incoming(await sign(override)), f.env);
    expect(response.status).toBe(401); expect(f.seen).toHaveLength(0);
  });
  it('rejects a wrong signing key, future issuance and algorithm confusion', async () => {
    const now = Math.floor(Date.now() / 1000), wrongKey = (await generateKeyPair('RS256')).privateKey;
    const forged = await new SignJWT({ type: 'app', sub: 'x', email: 'friend@example.com' }).setProtectedHeader({ alg: 'RS256', kid: 'relay-worker-test' }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(wrongKey);
    const symmetric = await new SignJWT({ type: 'app', sub: 'x', email: 'friend@example.com' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(new Uint8Array(32));
    for (const token of [forged, symmetric, await sign({ iat: now + 60 }), await sign({ nbf: now + 60 })]) {
      const f = fixture(); expect((await f.worker.fetch(incoming(token), f.env)).status).toBe(401); expect(f.seen).toHaveLength(0);
    }
  });
  it.each([
    { RELAY_PUBLIC_ORIGIN: 'http://relay-owner.example-account.workers.dev' },
    { RELAY_PUBLIC_ORIGIN: 'https://evil.example' },
    { RELAY_PUBLIC_ORIGIN: `${origin}/path` },
    { RELAY_PUBLIC_ORIGIN: 'https://relay-owner.example-account.workers.dev@evil.example' },
    { RELAY_ACCESS_ISSUER: 'https://evil.example' },
    { RELAY_ACCESS_ISSUER: 'https://team.cloudflareaccess.com.evil.example' },
    { RELAY_ACCESS_ISSUER: `${issuer}:8443` }, { RELAY_ACCESS_AUDIENCE: '' },
  ])('fails closed on invalid deployment identifiers', async override => {
    const f = fixture(); const response = await f.worker.fetch(incoming(await sign()), { ...f.env, ...override });
    expect(response.status).toBe(503); expect(f.seen).toHaveLength(0);
  });
  it('rejects mismatched URL host, Host, Origin, cross-site API calls and missing mutation Origin', async () => {
    const token = await sign();
    const requests = [new Request('https://evil.example/api/session', { headers: { host: new URL(origin).host, 'cf-access-jwt-assertion': token } }),
      incoming(token, '/api/session', { headers: { host: 'evil.example' } }),
      incoming(token, '/api/session', { headers: { origin: 'https://evil.example' } }),
      incoming(token, '/api/session', { headers: { 'sec-fetch-site': 'cross-site' } }),
      incoming(token, '/api/conversations', { method: 'POST', body: '{}' })];
    for (const request of requests) { const f = fixture(); expect((await f.worker.fetch(request, f.env)).status).toBe(403); expect(f.seen).toHaveLength(0); }
  });
  it('requires a real audience string rather than coercing an absent binding', async () => {
    for (const missing of [undefined, null, 123]) {
      const f = fixture(); f.env.RELAY_ACCESS_AUDIENCE = missing as unknown as string;
      expect((await f.worker.fetch(incoming(await sign()), f.env)).status).toBe(503); expect(f.seen).toHaveLength(0);
    }
  });
  it('allows the authenticated Access return navigation to the entry document', async () => {
    const f = fixture(); const response = await f.worker.fetch(incoming(await sign(), '/', { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }), f.env);
    expect(response.status).toBe(200); expect(f.seen).toHaveLength(1);
  });
  it('forwards the authenticated task collection with its cursor while preserving Access and origin gates', async () => {
    const path='/api/tasks?limit=40&before=opaque_cursor',token=await sign(),f=fixture();
    const response=await f.worker.fetch(incoming(token,path),f.env);
    expect(response.status).toBe(200);expect(f.seen).toHaveLength(1);
    expect(new URL(f.seen[0].url).pathname+new URL(f.seen[0].url).search).toBe(path);
    expect(f.seen[0].method).toBe('GET');
    const anonymous=fixture();expect((await anonymous.worker.fetch(incoming(undefined,path),anonymous.env)).status).toBe(401);expect(anonymous.seen).toHaveLength(0);
    const foreign=fixture();expect((await foreign.worker.fetch(incoming(token,path,{headers:{origin:'https://evil.example'}}),foreign.env)).status).toBe(403);expect(foreign.seen).toHaveLength(0);
  });
  it.each(['/v1/models', '/api/admin/users', '/api/session/pair', '/api/stop', '/api/resume', '/.env', '/api//session', '/api/%2fadmin', '/api/session%00', '/unknown'])('denies out-of-scope or ambiguous routes %s', async path => {
    const f = fixture(); expect((await f.worker.fetch(incoming(await sign(), path), f.env)).status).toBe(404); expect(f.seen).toHaveLength(0);
  });
  it('never forwards Cloudflare infrastructure routes to Relay', async () => {
    const f = fixture(); expect((await f.worker.fetch(incoming(undefined, '/cdn-cgi/access/logout'), f.env)).status).toBe(404); expect(f.seen).toHaveLength(0);
  });
  it('allows production assets but rejects unsupported methods and upgrades', async () => {
    const token = await sign(), f = fixture();
    expect((await f.worker.fetch(incoming(token, '/assets/index-abc123.js'), f.env)).status).toBe(200);
    for (const request of [incoming(token, '/api/session', { method: 'OPTIONS' }), incoming(token, '/api/events', { headers: { upgrade: 'websocket' } })]) {
      const g = fixture(); expect((await g.worker.fetch(request, g.env)).status).toBe(405); expect(g.seen).toHaveLength(0);
    }
  });
  it('forwards bounded JSON mutations with their CSRF proof and rejects oversize bodies before host access', async () => {
    const token = await sign(), f = fixture();
    const body = '{"objective":"hello"}';
    expect((await f.worker.fetch(incoming(token, '/api/conversations', { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-relay-csrf': 'proof' }, body }), f.env)).status).toBe(200);
    expect(await f.seen[0].text()).toBe(body);
    for (const init of [{ headers: { origin, 'content-length': '1048577', 'content-type': 'application/json' }, body: '{}' },
      { headers: { origin, 'content-type': 'application/json' }, body: 'x'.repeat(1048577) }] as RequestInit[]) {
      const g = fixture(); expect((await g.worker.fetch(incoming(token, '/api/conversations', { method: 'POST', ...init }), g.env)).status).toBe(413); expect(g.seen).toHaveLength(0);
    }
  });
  it('allows the larger document envelope only on the authenticated document-import route',async()=>{
    const token=await sign(),path='/api/workspaces/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/documents',body=JSON.stringify({name:'report.pdf',contentBase64:'a'.repeat(1100000)});
    const init={method:'POST',headers:{origin,'content-type':'application/json'},body};
    const f=fixture();expect((await f.worker.fetch(incoming(token,path,init),f.env)).status).toBe(200);
    expect(await f.seen[0].text()).toBe(body);
    for(const other of ['/api/conversations',path.replace('/documents','/files')]){const denied=fixture();expect((await denied.worker.fetch(incoming(token,other,init),denied.env)).status).toBe(413);expect(denied.seen).toHaveLength(0);}
    const oversized=fixture();expect((await oversized.worker.fetch(incoming(token,path,{...init,headers:{...init.headers,'content-length':String(12*1024*1024+1)}}),oversized.env)).status).toBe(413);
    const anonymous=fixture();expect((await anonymous.worker.fetch(incoming(undefined,path,init),anonymous.env)).status).toBe(401);expect(anonymous.seen).toHaveLength(0);
  });
  it('rejects compressed and misdeclared bodies and prevents forwarding spoofed transport credentials', async () => {
    const token = await sign();
    for (const headers of [{ 'content-encoding': 'gzip' }, { 'content-length': '3' }, { 'content-type': 'text/plain' }] as Record<string,string>[]) {
      const f = fixture(); expect((await f.worker.fetch(incoming(token, '/api/conversations', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: '{}' }), f.env)).status).toBe(400); expect(f.seen).toHaveLength(0);
    }
    const f = fixture(); await f.worker.fetch(incoming(token, '/api/session', { headers: { authorization: 'Bearer do-not-forward', 'cf-access-client-secret': 'secret', 'x-forwarded-host': 'evil.example', forwarded: 'host=evil.example' } }), f.env);
    for (const header of ['authorization', 'cf-access-client-secret', 'x-forwarded-host', 'forwarded']) expect(f.seen[0].headers.has(header)).toBe(false);
  });
  it('passes SSE through immediately without consuming or buffering its future events', async () => {
    let output!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { output = controller; } });
    const f = fixture(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    const response = await f.worker.fetch(incoming(await sign(), '/api/events'), f.env);
    expect(response).toBe(f.upstream);
    const reader = response.body!.getReader(); output.enqueue(new TextEncoder().encode('data: first\n\n'));
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n');
    output.enqueue(new TextEncoder().encode('data: second\n\n')); output.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: second\n\n'); expect((await reader.read()).done).toBe(true);
  });
  it('returns upstream redirects without following them and hides tunnel errors', async () => {
    const f = fixture(new Response(null, { status: 302, headers: { location: '/index.html' } }));
    expect((await f.worker.fetch(incoming(await sign()), f.env)).status).toBe(302); expect(f.seen[0].redirect).toBe('manual');
    const g = fixture(); g.env.RELAY_HOST.fetch = async () => { throw new Error('private tunnel address and credentials'); };
    const response = await g.worker.fetch(incoming(await sign()), g.env);
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('private tunnel');
  });
  it('bounds request URL and header bytes before contacting the host', async () => {
    const token = await sign();
    for (const [request, status] of [[incoming(token, `/api/events?after=${'x'.repeat(8192)}`), 414], [incoming(token, '/api/session', { headers: { cookie: 'x'.repeat(32768) } }), 431]] as const) {
      const f = fixture(); expect((await f.worker.fetch(request, f.env)).status).toBe(status); expect(f.seen).toHaveLength(0);
    }
  });
  it('cancels an unfinished body without forwarding a partial action', async () => {
    const f = fixture(), controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(out) { out.enqueue(new TextEncoder().encode('{')); } });
    const request = incoming(await sign(), '/api/conversations', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body, signal: controller.signal, duplex: 'half' } as RequestInit);
    const result = f.worker.fetch(request, f.env); controller.abort();
    expect((await result).status).toBe(408); expect(f.seen).toHaveLength(0);
  });
  it('propagates response cancellation to the upstream event stream', async () => {
    let cancelled = false;
    const f = fixture(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const response = await f.worker.fetch(incoming(await sign(), '/api/events'), f.env);
    await response.body!.cancel(); expect(cancelled).toBe(true);
  });
  it('bounds fragmented request processing independently from byte size', async () => {
    let count = 0;
    const body = new ReadableStream<Uint8Array>({ pull(out) { if (++count <= 65537) out.enqueue(new Uint8Array()); else out.close(); } });
    const f = fixture(), request = incoming(await sign(), '/api/conversations', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit);
    expect((await f.worker.fetch(request, f.env)).status).toBe(413); expect(f.seen).toHaveLength(0);
  });
});
