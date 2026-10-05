let csrfToken: string | null = null;
let sessionPromise: Promise<SessionInfo> | null = null;
let currentSession: SessionInfo | null = null;

export interface UserPermissions {
  providers: string[]; workspaceIds: string[]; maxAccess: 'read_only' | 'supervised' | 'workspace';
  maxConcurrentTasks: number; maxCallsPerTask: number; maxSecondsPerTask: number; dailyCloudBudgetUsd: number;
}
export interface SessionUser { id: string; name: string; email: string | null; role: 'owner' | 'trusted' | 'chat'; enabled: boolean; permissions: UserPermissions; createdAt: string; lastActiveAt: string | null }
export interface SessionInfo { user?: SessionUser; remote?: boolean; hostName?: string }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function initializeSession(): Promise<SessionInfo> {
  if (csrfToken && currentSession) return Promise.resolve(currentSession);
  if (!sessionPromise) sessionPromise = fetch('/api/session', { credentials: 'same-origin', signal: AbortSignal.timeout(15_000) })
    .then(async response => {
      if (!response.ok) throw new ApiError('The local service could not establish a session.', response.status);
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('csrfToken' in data) || typeof data.csrfToken !== 'string') throw new Error('The local service returned an invalid session.');
      csrfToken = data.csrfToken;
      currentSession = data as SessionInfo;
      return currentSession;
    }).catch(error => { sessionPromise = null; throw error; });
  return sessionPromise;
}

export function refreshSession(): Promise<SessionInfo> {
  csrfToken = null; sessionPromise = null; currentSession = null;
  return initializeSession();
}

export async function api<T>(path: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  await initializeSession();
  const method = options.method ?? 'GET';
  const response = await fetch(`/api${path}`, {
    method, credentials: 'same-origin',
    headers: { ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-relay-csrf': csrfToken! } : {}) },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal ?? AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    if (response.status === 401) { csrfToken = null; sessionPromise = null; currentSession = null; }
    throw new ApiError(payload?.error ?? `The service returned HTTP ${response.status}.`, response.status, payload?.code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const mutation = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.';
export function downloadText(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
