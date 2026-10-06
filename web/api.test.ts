import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const session = (name: string) => new Response(JSON.stringify({ csrfToken: `csrf-${name}`, remote: false, user: { id: name } }), { status: 200 });
const expired = () => new Response(JSON.stringify({ code: 'SESSION_EXPIRED', error: 'Session expired.' }), { status: 401 });
describe('browser session invalidation', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

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
});
