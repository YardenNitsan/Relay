import {describe, expect, it} from 'vitest';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';

type Cloud = 'anthropic' | 'gemini';
function fixture(provider: Cloud, reply: (url: URL, call: number) => Response) {
  const requests: URL[] = [];
  const providers = new Providers({
    secrets: new SecretManager({env: {[`${provider.toUpperCase()}_API_KEY`]: 'synthetic-test-key'}, keyring: null}),
    fetch: async url => {
      const parsed = new URL(String(url));
      if (parsed.hostname === '127.0.0.1') return Response.json({models: []});
      requests.push(parsed);
      return reply(parsed, requests.length);
    },
  });
  return {providers, requests};
}

describe('account model catalog pagination', () => {
  it.each(['anthropic', 'gemini'] as const)('discovers later %s pages, encodes opaque cursors and caches the complete catalog', async provider => {
    const cursor = 'opaque/+=?&next=https://untrusted.invalid';
    const first = provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gemini-2.5-flash';
    const second = provider === 'anthropic' ? 'claude-opus-4-6' : 'gemini-2.5-pro';
    const {providers, requests} = fixture(provider, (_url, call) => Response.json(provider === 'anthropic'
      ? {data: [{id: call === 1 ? first : second}], has_more: call === 1, last_id: cursor}
      : {models: [{name: `models/${call === 1 ? first : second}`}], ...(call === 1 ? {nextPageToken: cursor} : {})}));
    const models = (await providers.listModels()).filter(model => model.provider === provider);
    expect(models.map(model => model.id)).toEqual([`${provider}/${first}`, `${provider}/${second}`]);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.origin).toBe(requests[0]!.origin);
    expect(requests[1]!.pathname).toBe(requests[0]!.pathname);
    expect(requests[1]!.searchParams.get(provider === 'anthropic' ? 'after_id' : 'pageToken')).toBe(cursor);
    expect(models.every(model => model.tokensPerSecond === null && model.contextWindow === null)).toBe(true);
    await providers.listModels();
    expect(requests).toHaveLength(2);
  });

  it('discards all pages when a later page fails authentication', async () => {
    const {providers} = fixture('anthropic', (_url, call) => call === 1
      ? Response.json({data: [{id: 'claude-sonnet-4-6'}], has_more: true, last_id: 'first'})
      : Response.json({}, {status: 401}));
    expect((await providers.listModels()).filter(model => model.provider === 'anthropic')).toEqual([]);
    expect((await providers.statuses()).find(status => status.id === 'anthropic')).toMatchObject({state: 'unauthorized', connected: false});
  });

  it('rejects a repeated cursor instead of publishing a partial catalog', async () => {
    const {providers, requests} = fixture('gemini', () => Response.json({models: [{name: 'models/gemini-2.5-pro'}], nextPageToken: 'same'}));
    expect((await providers.listModels()).filter(model => model.provider === 'gemini')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'error', reachable: true, connected: false});
  });

  it('rejects missing Anthropic cursors when more pages are advertised', async () => {
    const {providers, requests} = fixture('anthropic', () => Response.json({data: [{id: 'claude-sonnet-4-6'}], has_more: true}));
    expect((await providers.listModels()).filter(model => model.provider === 'anthropic')).toEqual([]);
    expect(requests).toHaveLength(1);
  });

  it('bounds pages even when every cursor is new', async () => {
    const {providers, requests} = fixture('gemini', (_url, call) => Response.json({models: [], nextPageToken: `page-${call}`}));
    expect((await providers.listModels()).filter(model => model.provider === 'gemini')).toEqual([]);
    expect(requests).toHaveLength(20);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'error', connected: false});
  });

  it('never publishes the first page after credential revocation', async () => {
    const {providers, requests} = fixture('anthropic', () => {
      const response = Response.json({data: [{id: 'claude-sonnet-4-6'}], has_more: true, last_id: 'first'});
      const originalText = response.text.bind(response);
      response.text = async () => { const body = await originalText(); providers.setEnabled('anthropic', false); return body; };
      return response;
    });
    expect((await providers.listModels()).filter(model => model.provider === 'anthropic')).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((await providers.statuses()).find(status => status.id === 'anthropic')).toMatchObject({state: 'disabled', connected: false});
  });

  it('discards previously collected pages if credentials are revoked during the final body read', async () => {
    const {providers, requests} = fixture('gemini', (_url, call) => {
      const response = Response.json({models: [{name: `models/gemini-test-${call}`}], ...(call === 1 ? {nextPageToken: 'second'} : {})});
      if (call === 2) {
        const originalText = response.text.bind(response);
        response.text = async () => { const body = await originalText(); providers.setEnabled('gemini', false); return body; };
      }
      return response;
    });
    expect((await providers.listModels()).filter(model => model.provider === 'gemini')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'disabled', connected: false});
  });

  it('retains the first metadata observation when a changing catalog repeats a model on a later page', async () => {
    const {providers} = fixture('anthropic', (_url, call) => Response.json({
      data: [{id: 'claude-sonnet-4-6', display_name: call === 1 ? 'First observation' : 'Later observation', max_input_tokens: call === 1 ? 1000 : 2000}],
      has_more: call === 1, last_id: 'next',
    }));
    const models = (await providers.listModels()).filter(model => model.provider === 'anthropic');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({name: 'First observation', contextWindow: 1000});
  });

  it('rejects a malformed later page without retaining its valid first page', async () => {
    const {providers, requests} = fixture('gemini', (_url, call) => Response.json(call === 1
      ? {models: [{name: 'models/gemini-2.5-pro'}], nextPageToken: 'second'}
      : {models: {name: 'models/gemini-2.5-flash'}}));
    expect((await providers.listModels()).filter(model => model.provider === 'gemini')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'error', reachable: true, connected: false});
  });

  it('bounds cumulative raw rows before deduplication', async () => {
    const {providers, requests} = fixture('anthropic', (_url, call) => Response.json({
      data: Array.from({length: call === 1 ? 1000 : 1001}, () => ({id: 'claude-sonnet-4-6'})),
      has_more: call === 1, last_id: 'second',
    }));
    expect((await providers.listModels()).filter(model => model.provider === 'anthropic')).toEqual([]);
    expect(requests).toHaveLength(2);
    expect((await providers.statuses()).find(status => status.id === 'anthropic')).toMatchObject({state: 'error', connected: false});
  });

  it('bounds cumulative catalog bytes even when each page fits the existing response limit', async () => {
    const metadata = 'x'.repeat(3 * 1024 * 1024);
    const {providers, requests} = fixture('gemini', (_url, call) => Response.json({
      models: [{name: `models/gemini-test-${call}`, description: metadata}],
      ...(call < 3 ? {nextPageToken: `page-${call}`} : {}),
    }));
    expect((await providers.listModels()).filter(model => model.provider === 'gemini')).toEqual([]);
    expect(requests).toHaveLength(3);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'error', reachable: true, connected: false});
  });

  it('accepts a complete catalog that ends exactly at the page limit', async () => {
    const {providers, requests} = fixture('gemini', (_url, call) => Response.json({
      models: [{name: `models/gemini-test-${call}`}], ...(call < 20 ? {nextPageToken: `page-${call}`} : {}),
    }));
    const models = (await providers.listModels()).filter(model => model.provider === 'gemini');
    expect(models).toHaveLength(20);
    expect(models.at(-1)?.id).toBe('gemini/gemini-test-20');
    expect(requests).toHaveLength(20);
    expect((await providers.statuses()).find(status => status.id === 'gemini')).toMatchObject({state: 'ready', connected: true});
  });
});
