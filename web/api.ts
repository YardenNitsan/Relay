let csrfToken: string | null = null;
let sessionPromise: Promise<SessionInfo> | null = null;
let currentSession: SessionInfo | null = null;
let sessionEpoch = 0;
let blockedSessionError: ApiError | null = null;
const sessionListeners = new Set<(error: ApiError) => void>();

export interface UserPermissions {
  providers: string[]; workspaceIds: string[]; maxAccess: 'read_only' | 'supervised' | 'workspace';
  maxConcurrentTasks: number; maxCallsPerTask: number; maxSecondsPerTask: number; dailyCloudBudgetUsd: number;
  allowUnpricedCloud?: boolean; externalModelAccess?: boolean;
  networkOrigins?: string[]; maxNetworkAccess?: 'deny' | 'ask' | 'allow';
  mcpServerIds?: string[];
}
export interface SessionUser { id: string; name: string; email: string | null; role: 'owner' | 'trusted' | 'chat'; enabled: boolean; permissions: UserPermissions; createdAt: string; lastActiveAt: string | null; registrationStatus?: 'pending' | 'approved' | 'denied'; accessRequestedAt?: string | null }
export interface SessionInfo { user?: SessionUser; remote?: boolean; hostName?: string; connection?: 'local' | 'lan' | 'remote' }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function onSessionInvalidated(listener: (error: ApiError) => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

function invalidateSession(error: ApiError) {
  if (blockedSessionError) return;
  blockedSessionError = currentSession?.connection === 'lan'
    ? new ApiError('This session expired or was revoked. Ask the host owner for a new invitation.', 401, 'LAN_PAIRING_REQUIRED')
    : currentSession?.remote === false
    ? new ApiError('This session expired or was revoked. Pair this browser with the local host again.', 401, 'PAIRING_REQUIRED')
    : error;
  sessionEpoch++;
  csrfToken = null; sessionPromise = null; currentSession = null;
  for (const listener of sessionListeners) listener(blockedSessionError);
}

function assertSessionEpoch(expected: number) {
  if (expected !== sessionEpoch) throw new ApiError('The browser session changed before this request completed.', 401, 'SESSION_CHANGED');
}

export function initializeSession(): Promise<SessionInfo> {
  if (blockedSessionError) return Promise.reject(blockedSessionError);
  if (csrfToken && currentSession) return Promise.resolve(currentSession);
  const epoch = sessionEpoch;
  if (!sessionPromise) sessionPromise = fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(15_000) })
    .then(async response => {
      assertSessionEpoch(epoch);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
        throw new ApiError(payload?.error ?? 'The service could not establish a session.', response.status, payload?.code);
      }
      const data: unknown = await response.json();
      assertSessionEpoch(epoch);
      return acceptSession(data);
    }).catch(error => { if (epoch === sessionEpoch) sessionPromise = null; throw error; });
  return sessionPromise;
}

function acceptSession(data: unknown): SessionInfo {
  if (!data || typeof data !== 'object' || !('csrfToken' in data) || typeof data.csrfToken !== 'string') throw new Error('The service returned an invalid session.');
  csrfToken = data.csrfToken;
  currentSession = data as SessionInfo;
  return currentSession;
}

export async function pairSession(token: string): Promise<SessionInfo> {
  const response = await fetch('/api/session/pair', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new ApiError(payload?.error ?? 'This browser could not be paired.', response.status, payload?.code);
  }
  const data: unknown = await response.json();
  sessionEpoch++; blockedSessionError = null; sessionPromise = null;
  return acceptSession(data);
}

export function refreshSession(): Promise<SessionInfo> {
  sessionEpoch++; blockedSessionError = null;
  csrfToken = null; sessionPromise = null; currentSession = null;
  return initializeSession();
}

export async function api<T>(path: string, options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  await initializeSession();
  const epoch = sessionEpoch;
  const method = options.method ?? 'GET';
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-relay-csrf': csrfToken! } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal ?? AbortSignal.timeout(120_000),
  });
  assertSessionEpoch(epoch);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    assertSessionEpoch(epoch);
    const error = new ApiError(payload?.error ?? `The service returned HTTP ${response.status}.`, response.status, payload?.code);
    if (response.status === 401 || response.status === 403 && ['NOT_INVITED', 'IDENTITY_CHANGED', 'USER_DISABLED', 'REMOTE_PENDING', 'REMOTE_DENIED', 'REMOTE_DISABLED'].includes(error.code ?? '')) invalidateSession(error);
    throw error;
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json() as T;
  assertSessionEpoch(epoch);
  return result;
}

export const mutation = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
export function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
