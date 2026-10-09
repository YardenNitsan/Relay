import { request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { chatPermissions } from '../server/auth/policy.js';
import { InferenceService } from '../server/inference/service.js';
import { createInferenceApp } from '../server/inference/routes.js';
import { parseInferenceRequest } from '../server/inference/protocols.js';
import { LocalLease } from '../server/orchestration/lease.js';
import type { ModelChunk, ModelProfile, ModelRequest, ProviderGateway } from '../shared/types.js';

const model: ModelProfile = { id: 'ollama/cancellation', provider: 'ollama', name: 'Cancellation fixture', runtime: 'fixture', local: true, capabilities: { tools: true, vision: false, reasoning: false, structured: false }, contextWindow: 32768, quantization: null, sizeBytes: 1, tokensPerSecond: null, state: 'ready', details: {}, inputPricePerMillion: null, outputPricePerMillion: null };
let store: Store, service: InferenceService, lease: LocalLease, produced: number, providerClosed: boolean;
let generate: (request: ModelRequest) => AsyncGenerator<ModelChunk>;
beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init(); lease = new LocalLease(); produced = 0; providerClosed = false;
  await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)', ['reader', 'chat', JSON.stringify({ ...chatPermissions, externalModelAccess: true })]);
  generate = async function* () { try { produced++; yield { type: 'text', text: 'first' }; produced++; yield { type: 'text', text: 'second' }; yield { type: 'done', finishReason: 'stop' }; } finally { providerClosed = true; } };
  const gateway: ProviderGateway = { listModels: async () => [model], statuses: async () => [], stream: request => generate(request) };
  service = new InferenceService(store, gateway, lease, () => false, async () => ({ allowed: true, decision: 'run', reasons: [], estimatedRamBytes: 1, estimatedVramBytes: 1, contextTokens: 2048, confidence: 'measured' }));
});
afterEach(async () => { await service.shutdown(); await store.close(); });
async function token() { return service.tokens.issue('reader', { label: 'Cancellation test', expiresInDays: 1 }, 0); }
async function settledWithin(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  const timer = new AbortController();
  try { return await Promise.race([operation.then(() => true), delay(milliseconds, false, { signal: timer.signal })]); }
  finally { timer.abort(); }
}

it('shuts down a generator suspended at yield without asking its consumer to read again', async () => {
  const who = await service.tokens.authenticate((await token()).token);
  const parsed = parseInferenceRequest('responses', { model: model.id, input: 'bounded cancellation test' });
  const iterator = service.stream(who, parsed, new AbortController().signal);
  expect((await iterator.next()).value).toMatchObject({ type: 'text', text: 'first' });
  const stopping = service.shutdown();
  try {
    expect(await settledWithin(stopping, 500)).toBe(true);
    expect(providerClosed).toBe(true); expect(produced).toBe(1);
    const release = await lease.acquire(AbortSignal.timeout(500)); release();
    expect((await store.db.query('SELECT status FROM inference_requests'))[0].status).toBe('cancelled');
  } finally { await iterator.return(undefined); await stopping; }
});

it('terminates an actual HTTP SSE response with a non-reading client and releases the model lease', async () => {
  generate = async function* (request) {
    try {
      // Tiny text deltas keep provider output within its byte limit while SSE
      // framing fills real socket buffers and produces downstream backpressure.
      for (let i = 0; i < 50000; i++) { request.signal.throwIfAborted(); produced++; yield { type: 'text', text: 'x' }; }
      yield { type: 'done', finishReason: 'stop' };
    } finally { providerClosed = true; }
  };
  let downstreamClosed = false;
  const app = await createInferenceApp(service);
  app.addHook('onRequest', (_request, reply, done) => { reply.raw.once('close', () => { downstreamClosed = true; }); done(); });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('Missing test socket');
  let client: ClientRequest | undefined, response: IncomingMessage | undefined;
  let stopping: Promise<void> | undefined;
  try {
    const issued = await token();
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      client = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/v1/responses', method: 'POST',
        headers: { host: '127.0.0.1:4315', authorization: `Bearer ${issued.token}`, 'content-type': 'application/json' } }, incoming => { incoming.pause(); incoming.on('error', () => undefined); resolve(incoming); });
      client.on('error', reject); client.end(JSON.stringify({ model: model.id, input: 'bounded cancellation test', stream: true }));
    });
    expect(response.statusCode).toBe(200);
    let previous = -1, stable = 0;
    await expect.poll(async () => {
      await delay(100);
      stable = produced === previous && produced > 1 && !providerClosed ? stable + 1 : 0; previous = produced;
      return stable >= 3;
    }, { timeout: 5000 }).toBe(true);
    expect(produced).toBeLessThan(50000); expect(providerClosed).toBe(false);
    stopping = service.shutdown();
    expect(await settledWithin(stopping, 2000)).toBe(true);
    expect(providerClosed).toBe(true);
    await expect.poll(() => downstreamClosed, { timeout: 2000 }).toBe(true);
    const release = await lease.acquire(AbortSignal.timeout(500)); release();
    expect((await store.db.query('SELECT status FROM inference_requests'))[0].status).toBe('cancelled');
  } finally { response?.destroy(); client?.destroy(); if (stopping) await stopping; await app.close(); }
});

it('removes disconnect listeners if the provider fails before the first chunk', async () => {
  generate = async function* () { throw new Error('Initial provider failure'); };
  const app = await createInferenceApp(service);
  let rawRequest: IncomingMessage | undefined, rawReply: ServerResponse | undefined, requestListeners = 0, replyListeners = 0;
  app.addHook('onRequest', (request, reply, done) => {
    rawRequest = request.raw; rawReply = reply.raw;
    requestListeners = request.raw.listenerCount('aborted'); replyListeners = reply.raw.listenerCount('close'); done();
  });
  try {
    const issued = await token();
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: { host: '127.0.0.1:4315', authorization: `Bearer ${issued.token}` },
      payload: { model: model.id, input: 'bounded cancellation test', stream: true } });
    expect(response.statusCode).toBe(502);
    expect(rawRequest!.listenerCount('aborted')).toBeLessThanOrEqual(requestListeners);
    expect(rawReply!.listenerCount('close')).toBeLessThanOrEqual(replyListeners);
    const release = await lease.acquire(AbortSignal.timeout(500)); release();
    expect((await store.db.query('SELECT status FROM inference_requests'))[0].status).toBe('failed');
  } finally { await app.close(); }
});
