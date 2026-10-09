import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = (name: string) => new Response(JSON.stringify({ csrfToken: `csrf-${name}`, remote: false, user: { id: name } }), { status: 200 });
const expired = () => new Response(JSON.stringify({ code: 'SESSION_EXPIRED', error: 'Session expired.' }), { status: 401 });
describe('browser session invalidation', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('includes session CSRF protection on configuration PUT requests', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(session('owner')).mockResolvedValueOnce(new Response('{"servers":[]}'));
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api');
    await api.api('/mcp/servers', { method: 'PUT', body: { servers: [] } });
    expect(fetcher).toHaveBeenLastCalledWith('/api/mcp/servers', expect.objectContaining({ method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-relay-csrf': 'csrf-owner' }, body: '{"servers":[]}' }));
  });

  it('notifies once and blocks automatic session/request retries after revocation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(session('owner')).mockResolvedValueOnce(expired());
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api');
    const listener = vi.fn();
    api.onSessionInvalidated(listener);
    await api.initializeSession();
    await expect(api.api('/status')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'PAIRING_REQUIRED' }));
    await expect(api.api('/models')).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
    await expect(api.initializeSession()).rejects.toMatchObject({ code: 'PAIRING_REQUIRED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not let a late old-session failure invalidate a newly paired session', async () => {
    let settle: (response: Response) => void = () => {};
    const delayed = new Promise<Response>(resolve => { settle = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(session('owner')).mockReturnValueOnce(delayed).mockResolvedValueOnce(expired()).mockResolvedValueOnce(session('paired')).mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api');
    const listener = vi.fn();
    api.onSessionInvalidated(listener);
    await api.initializeSession();
    const old = api.api('/old');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await expect(api.api('/status')).rejects.toMatchObject({ status: 401 });
    await api.pairSession('one-use-test-token');
    settle(expired());
    await expect(old).rejects.toMatchObject({ status: 401 });
    await expect(api.api('/status')).resolves.toEqual({});
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects successful private responses arriving after session invalidation', async () => {
    let settle: (response: Response) => void = () => {};
    const delayed = new Promise<Response>(resolve => { settle = resolve; });
    const fetcher = vi.fn().mockResolvedValueOnce(session('owner')).mockReturnValueOnce(delayed).mockResolvedValueOnce(expired());
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api');
    await api.initializeSession();
    const old = api.api('/conversations');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await expect(api.api('/status')).rejects.toMatchObject({ status: 401 });
    settle(new Response(JSON.stringify({ private: 'old session content' })));
    await expect(old).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  });

  it('invalidates explicit remote account revocation without treating ordinary permission denials as logout', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-remote', remote: true, user: { id: 'remote-user' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'OWNER_ONLY', error: 'Owner access required.' }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'NOT_INVITED', error: 'Account access was revoked.' }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api');
    const listener = vi.fn();
    api.onSessionInvalidated(listener);
    await expect(api.api('/admin/sessions')).rejects.toMatchObject({ code: 'OWNER_ONLY' });
    expect(listener).not.toHaveBeenCalled();
    await expect(api.api('/status')).rejects.toMatchObject({ code: 'NOT_INVITED' });
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'NOT_INVITED' }));
    await expect(api.initializeSession()).rejects.toMatchObject({ code: 'NOT_INVITED' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(['REMOTE_PENDING', 'REMOTE_DENIED', 'REMOTE_DISABLED'])('clears a remote session and stops private polling after %s', async code => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-remote', remote: true, user: { id: 'remote-user' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code, error: 'Access needs owner action.' }), { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api'); const listener = vi.fn(); api.onSessionInvalidated(listener);
    await expect(api.api('/status')).rejects.toMatchObject({ code });
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code }));
    await expect(api.api('/models')).rejects.toMatchObject({ code });
    await expect(api.initializeSession()).rejects.toMatchObject({ code });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns LAN invitation recovery rather than local owner pairing after LAN revocation', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: 'csrf-lan', remote: true, connection: 'lan', user: { id: 'guest' } }))).mockResolvedValueOnce(expired());
    vi.stubGlobal('fetch', fetcher);
    const api = await import('./api'); const listener = vi.fn(); api.onSessionInvalidated(listener);
    await expect(api.api('/status')).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'LAN_PAIRING_REQUIRED' }));
    await expect(api.api('/models')).rejects.toMatchObject({ code: 'LAN_PAIRING_REQUIRED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
