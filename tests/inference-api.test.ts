import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { chatPermissions } from '../server/auth/policy.js';
import { InferenceService } from '../server/inference/service.js';
import { createInferenceApp } from '../server/inference/routes.js';
import { LocalLease } from '../server/orchestration/lease.js';
import type { ModelChunk, ModelProfile, ModelRequest, ProviderGateway } from '../shared/types.js';

const local: ModelProfile = { id: 'ollama/http-fixture', name: 'HTTP fixture', provider: 'ollama', runtime: 'fixture', local: true, capabilities: { tools: true, vision: false, reasoning: false, structured: true }, contextWindow: 32768, quantization: null, sizeBytes: 100, state: 'ready', details: { privateRuntimeDetail: 'not-public-metadata' }, tokensPerSecond: null, inputPricePerMillion: null, outputPricePerMillion: null };
const studio: ModelProfile = { ...local, id: 'lmstudio/http-fixture', provider: 'lmstudio' };
const privatePrompt = 'Private HTTP prompt: only the selected provider receives this.';
const privateAnswer = 'Private HTTP answer: do not persist this text.';
const responseBody = (extra: Record<string, unknown> = {}) => ({ model: local.id, input: privatePrompt, store: false, max_output_tokens: 256, ...extra });
let store: Store, app: FastifyInstance, service: InferenceService, lease: LocalLease;
let tokens: Record<string, { id: string; token: string; expiresAt: string }>;
let requests: ModelRequest[], scopes: string[], stopped: boolean, directory: string | undefined;
let stream: (request: ModelRequest) => AsyncIterable<ModelChunk>;
const headers = (user = 'alice') => ({ host: '127.0.0.1:4315', authorization: `Bearer ${tokens[user]!.token}` });
const frames = (body: string): Record<string, unknown>[] => body.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)) as Record<string, unknown>);

beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init(); lease = new LocalLease(); stopped = false; requests = []; scopes = []; tokens = {}; directory = undefined;
  for (const [id, providers] of [['alice', ['ollama']], ['bob', ['lmstudio']]] as const) await store.db.query('INSERT INTO users(id,name,role,permissions) VALUES ($1,$1,$2,$3)', [id, 'chat', JSON.stringify({ ...chatPermissions, providers, externalModelAccess: true })]);
  stream = async function* () { yield { type: 'text', text: privateAnswer }; yield { type: 'usage', inputTokens: 19, outputTokens: 8 }; yield { type: 'done', finishReason: 'stop' }; };
  const gateway: ProviderGateway = {
    listModels: async () => [local, studio, { ...local, id: 'openai/private-owner', provider: 'openai', local: false }], statuses: async () => [],
    forUser: async userId => { scopes.push(userId); return gateway; },
    stream: async function* (request) { requests.push(request); yield* stream(request); },
  };
  service = new InferenceService(store, gateway, lease, () => stopped, async () => ({ allowed: true, decision: 'run', reasons: ['Deterministic HTTP test admission'], estimatedRamBytes: 100, estimatedVramBytes: 100, contextTokens: 8192, confidence: 'measured' }));
  app = await createInferenceApp(service); await app.ready();
  for (const user of ['alice', 'bob']) tokens[user] = await service.tokens.issue(user, { label: 'HTTP test client', expiresInDays: 2 }, 0);
});
afterEach(async () => { service?.stopAll(); await app?.close(); await store?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('real inference HTTP boundary', () => {
  it('returns account-scoped model metadata and preserves token ownership/revocation', async () => {
    for (const [user, id] of [['alice', local.id], ['bob', studio.id]]) {
      const response = await app.inject({ method: 'GET', url: '/v1/models', headers: headers(user) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ object: 'list', data: [{ id, object: 'model', created: 0, owned_by: 'relay-host' }] });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain('not-public-metadata');
    }
    await service.tokens.revoke('bob', tokens.alice!.id);
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: headers() })).statusCode).toBe(200);
    await service.tokens.revoke('alice', tokens.alice!.id);
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: headers() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/models', headers: headers('bob') })).statusCode).toBe(200);
    expect(requests).toHaveLength(0);
    expect(scopes).not.toContain('owner');
  });

  it('accepts native Bearer and Anthropic API-key authentication while rejecting missing, forged and revoked credentials', async () => {
    const valid = await app.inject({ method: 'POST', url: '/v1/messages', headers: { host: '127.0.0.1:4315', 'x-api-key': tokens.alice!.token, 'anthropic-version': '2023-06-01' }, payload: { model: local.id, max_tokens: 128, messages: [{ role: 'user', content: privatePrompt }] } });
    expect(valid.statusCode).toBe(200); expect(valid.json()).toMatchObject({ type: 'message', stop_reason: 'end_turn', usage: { input_tokens: 19, output_tokens: 8 } });
    for (const auth of [{}, { authorization: 'Bearer invalid' }, { 'x-api-key': 'invalid' }, { authorization: 'Bearer invalid', 'x-api-key': tokens.alice!.token }]) {
      const denied = await app.inject({ method: 'POST', url: '/v1/messages', headers: { host: '127.0.0.1:4315', ...auth }, payload: { model: local.id, max_tokens: 128, messages: [{ role: 'user', content: privatePrompt }] } });
      expect(denied.statusCode).toBe(401); expect(denied.json().type).toBe('error'); expect(denied.body).not.toContain(privatePrompt);
    }
    await store.db.query('UPDATE users SET session_version=session_version+1 WHERE id=$1', ['alice']);
    expect((await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody() })).statusCode).toBe(403);
    expect(requests).toHaveLength(1);
  });

  it('does not mount browser administration and rejects browsers, hostile Host headers and query credentials', async () => {
    for (const extra of [{ origin: 'https://attacker.example' }, { origin: 'http://127.0.0.1:4315' }, { 'sec-fetch-site': 'same-origin' }, { host: 'attacker.example' }]) {
      expect((await app.inject({ method: 'GET', url: '/v1/models', headers: { ...headers(), ...extra } })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'GET', url: `/v1/models?api_key=${tokens.alice!.token}`, headers: { host: '127.0.0.1:4315' } })).statusCode).toBe(400);
    for (const url of ['/api/session', '/api/admin/users', '/api/stop', '/api/workspaces']) expect((await app.inject({ method: 'GET', url, headers: headers() })).statusCode).toBe(404);
    expect(requests).toHaveLength(0);
  });

  it('supports only the documented Anthropic beta query flag', async () => {
    const payload = { model: local.id, max_tokens: 128, messages: [{ role: 'user', content: 'A short request' }] };
    expect((await app.inject({ method: 'POST', url: '/v1/messages?beta=true', headers: headers(), payload })).statusCode).toBe(200);
    for (const url of ['/v1/messages?beta=false', '/v1/messages?beta=true&extra=1', '/v1/responses?beta=true', '/v1/chat/completions?token=private']) {
      expect((await app.inject({ method: 'POST', url, headers: headers(), payload })).statusCode).toBe(400);
    }
    expect(requests).toHaveLength(1);
  });

  it('persists usage metadata without prompts, replies, conversations or host tool execution', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody() });
    expect(response.statusCode).toBe(200); expect(response.json()).toMatchObject({ object: 'response', status: 'completed', store: false, usage: { input_tokens: 19, output_tokens: 8, total_tokens: 27 } });
    expect(response.body).toContain(privateAnswer);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await store.db.query('SELECT * FROM inference_requests'))[0]).toMatchObject({ user_id: 'alice', token_id: tokens.alice!.id, model_id: local.id, status: 'completed', input_tokens: 19, output_tokens: 8 });
    for (const table of ['inference_requests', 'audit_events', 'conversations', 'messages', 'tasks', 'tool_calls', 'model_calls']) {
      const rows = await store.db.query(`SELECT * FROM ${table}`);
      expect(JSON.stringify(rows).includes(privatePrompt) || JSON.stringify(rows).includes(privateAnswer)).toBe(false);
      if (!['inference_requests', 'audit_events'].includes(table)) expect(rows).toEqual([]);
    }
  });

  it('returns client tool proposals and accepts complete stateless results without executing matching host tools', async () => {
    directory = await mkdtemp(join(tmpdir(), 'relay-client-tools-')); const sentinel = join(directory, 'unchanged.txt'); await writeFile(sentinel, 'Host content must remain intact');
    stream = async function* (request) {
      if (request.messages.some(message => message.role === 'tool')) yield { type: 'text', text: 'The client declined the requested deletion.' };
      else yield { type: 'tool_call', call: { id: 'client_only_call', name: 'host_delete', arguments: { path: sentinel } } };
      yield { type: 'usage', inputTokens: 21, outputTokens: 6 }; yield { type: 'done', finishReason: 'stop' };
    };
    const tools = [{ type: 'function', name: 'host_delete', description: 'Client-controlled operation, never a Relay host capability', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false } }];
    const proposal = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ input: 'Propose deleting the client file.', tools }) });
    expect(proposal.statusCode).toBe(200); const call = proposal.json().output[0];
    expect(call).toMatchObject({ type: 'function_call', name: 'host_delete', call_id: 'client_only_call' });
    expect(await readFile(sentinel, 'utf8')).toBe('Host content must remain intact');
    const result = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ input: [{ role: 'user', content: 'Propose deleting the client file.' }, call, { type: 'function_call_output', call_id: call.call_id, output: 'Client denied this operation.' }], tools }) });
    expect(result.statusCode).toBe(200); expect(result.body).toContain('client declined');
    expect(requests[1]!.messages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'client_only_call', content: 'Client denied this operation.' });
    expect(await readFile(sentinel, 'utf8')).toBe('Host content must remain intact');
    expect(await store.db.query('SELECT * FROM tool_calls')).toEqual([]);
    expect(await store.db.query('SELECT * FROM conversations')).toEqual([]);
    const invalid = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ previous_response_id: proposal.json().id }) });
    expect(invalid.statusCode).toBe(400); expect(requests).toHaveLength(2);
  });

  it.each(['responses', 'chat/completions', 'messages'] as const)('ends a failed %s stream with an error and no fabricated completion', async path => {
    stream = async function* () { yield { type: 'text', text: 'Partial answer' }; throw new Error(`Secret provider detail ${privatePrompt}`); };
    const payload = path === 'responses' ? responseBody({ stream: true }) : { model: local.id, max_tokens: 128, messages: [{ role: 'user', content: privatePrompt }], stream: true };
    const response = await app.inject({ method: 'POST', url: `/v1/${path}`, headers: headers(), payload });
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('Partial answer');
    expect(frames(response.body).some(frame => frame.type === 'error' || 'error' in frame)).toBe(true);
    expect(response.body).not.toMatch(/response\.completed|event: message_stop|data: \[DONE\]/);
    expect(response.body).not.toContain('Secret provider detail'); expect(response.body).not.toContain(privatePrompt);
    expect((await store.db.query('SELECT status FROM inference_requests'))[0]?.status).toBe('failed');
  });

  it('rejects provider failure before the first stream chunk without a successful HTTP response', async () => {
    stream = async function* () { throw new Error('Sensitive upstream failure'); };
    const response = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ stream: true }) });
    expect(response.statusCode).toBe(502); expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toContain('Sensitive upstream failure');
    expect((await store.db.query('SELECT status FROM inference_requests'))[0]?.status).toBe('failed');
  });

  it('shares the host lease, rejects duplicate account work and queues another permitted account fairly', async () => {
    const release = await lease.acquire(new AbortController().signal);
    const alice = app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody() });
    let bob: PromiseLike<{ statusCode: number }> | undefined;
    try {
      await expect.poll(async () => Number((await store.db.query("SELECT count(*) AS count FROM inference_requests WHERE status='queued'"))[0]?.count)).toBe(1);
      expect(requests).toHaveLength(0);
      const duplicate = await app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody() });
      expect(duplicate.statusCode).toBe(429);
      bob = app.inject({ method: 'POST', url: '/v1/responses', headers: headers('bob'), payload: responseBody({ model: studio.id }) });
      await expect.poll(async () => Number((await store.db.query("SELECT count(*) AS count FROM inference_requests WHERE status='queued'"))[0]?.count)).toBe(2);
    } finally { release(); }
    expect((await alice).statusCode).toBe(200); expect((await bob!).statusCode).toBe(200);
    expect(requests.map(request => request.model.id)).toEqual([local.id, studio.id]);
  });

  it('cancels queued work through emergency stop without calling the model', async () => {
    const release = await lease.acquire(new AbortController().signal);
    const pending = app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ stream: true }) });
    try {
      await expect.poll(async () => (await store.db.query('SELECT status FROM inference_requests'))[0]?.status).toBe('queued');
      stopped = true; service.stopAll();
      const response = await pending;
      expect(response.statusCode).toBeGreaterThanOrEqual(400); expect(response.body).not.toContain('response.completed');
      expect((await store.db.query('SELECT status FROM inference_requests'))[0]?.status).toBe('cancelled');
      expect(requests).toHaveLength(0);
    } finally { release(); }
  });

  it('cancels an active stream outside model control and preserves cancelled metadata', async () => {
    let activeSignal: AbortSignal | undefined;
    stream = async function* (request) {
      activeSignal = request.signal; yield { type: 'text', text: 'Started' };
      await new Promise<void>(resolve => { if (request.signal.aborted) resolve(); else request.signal.addEventListener('abort', () => resolve(), { once: true }); });
      request.signal.throwIfAborted();
    };
    const pending = app.inject({ method: 'POST', url: '/v1/responses', headers: headers(), payload: responseBody({ stream: true }) });
    await expect.poll(() => Boolean(activeSignal)).toBe(true);
    stopped = true; service.stopAll(); const response = await pending;
    expect(activeSignal?.aborted).toBe(true); expect(response.statusCode).toBe(200);
    expect(frames(response.body).some(frame => frame.type === 'error')).toBe(true);
    expect(response.body).not.toContain('response.completed');
    expect((await store.db.query('SELECT status FROM inference_requests'))[0]?.status).toBe('cancelled');
  });
});
