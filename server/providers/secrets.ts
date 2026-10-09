import type { ProviderId } from '../../shared/types.js';

interface CredentialEntry { getPassword(): string | null | undefined | Promise<string | null | undefined>; setPassword(password: string): void | Promise<void>; deletePassword(): void | boolean | Promise<void | boolean>; }
export interface CredentialStore { entry(provider: ProviderId): CredentialEntry; }
interface SecretOptions { env?: Record<string, string | undefined>; keyring?: CredentialStore | null; userId?: string; }
const environmentNames: Record<ProviderId, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', ollama: 'OLLAMA_API_KEY', lmstudio: 'LMSTUDIO_API_KEY', xai: 'XAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY' };

/** Keys never become public configuration or model context. No disk fallback. */
export class SecretManager {
  private readonly session = new Map<ProviderId, string>();
  private readonly sessionStorage = new Map<ProviderId, string>();
  private readonly removed = new Set<ProviderId>();
  private readonly env: Record<string, string | undefined>;
  private store: Promise<CredentialStore | null>;
  constructor(options: SecretOptions = {}) {
    if(options.userId && !/^[a-zA-Z0-9_-]{1,128}$/.test(options.userId))throw new Error('Invalid credential owner');
    // Personal accounts can never inherit the host owner's environment or vault entry.
    this.env = options.userId ? {} : options.env ?? process.env;
    this.store = options.keyring !== undefined ? Promise.resolve(options.keyring) : import('@napi-rs/keyring').then(module => {
      // Pin Linux persistence to Secret Service; kernel-keyring fallback is volatile.
      const Entry = (module.AsyncEntry ?? module.Entry) as unknown as new (service: string, account: string, options?: unknown) => CredentialEntry;
      return { entry: (provider: ProviderId) => new Entry(options.userId ? `relay-local.user.${options.userId}` : 'relay-local.provider', provider, { linux: { store: 'secret-service' } }) };
    }).catch(() => null);
  }
  async get(provider: ProviderId): Promise<string | null> {
    if (this.removed.has(provider)) return null;
    const session = this.session.get(provider);
    if (session) return session;
    const env = this.env[environmentNames[provider]];
    if (env?.trim()) return env.trim();
    try { return await (await this.store)?.entry(provider).getPassword() ?? null; } catch { return null; }
  }
  async set(provider: ProviderId, key: string, persist: boolean): Promise<{ saved: boolean; storage: string }> {
    if (!key.trim() || key.length > 8192 || /[\r\n\0]/.test(key)) throw new Error('Invalid provider credential');
    if (persist) {
      const store = await this.store;
      if (!store) throw new Error('OS keyring unavailable; choose session-only storage');
      try { await store.entry(provider).setPassword(key.trim()); } catch { throw new Error('OS keyring could not save credential; choose session-only storage'); }
    }
    this.session.set(provider, key.trim()); this.sessionStorage.set(provider, persist ? 'os-keyring' : 'session'); this.removed.delete(provider);
    return { saved: true, storage: persist ? 'os-keyring' : 'session' };
  }
  async remove(provider: ProviderId): Promise<void> {
    this.session.delete(provider); this.sessionStorage.delete(provider); this.removed.add(provider);
    const store = await this.store;
    if (!store) return;
    try {
      const entry = store.entry(provider);
      if (await entry.getPassword()) await entry.deletePassword();
    } catch { throw new Error('Credential disabled for this session; OS keyring removal could not be confirmed'); }
  }
  async status(provider: ProviderId): Promise<{ configured: boolean; storage: string }> {
    if (this.removed.has(provider)) return { configured: false, storage: 'none' };
    if (this.session.has(provider)) return { configured: true, storage: this.sessionStorage.get(provider) ?? 'session' };
    if (this.env[environmentNames[provider]]?.trim()) return { configured: true, storage: 'environment' };
    const configured = !!await this.get(provider);
    return { configured, storage: configured ? 'os-keyring' : 'none' };
  }
}
