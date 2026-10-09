import { isIP } from 'node:net';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../core/errors.js';

export interface InferenceRemoteConfig { origin: string; issuer: string; audience: string; port: number; }

function httpsOrigin(value: string | undefined, issuer: boolean): string {
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) throw new Error('Inference remote access requires a canonical HTTPS origin');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Inference remote access requires a canonical HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (value !== url.origin && value !== `${url.origin}/`)) throw new Error('Inference remote access requires a canonical HTTPS origin without credentials, path, query or fragment');
  if (isIP(url.hostname) || url.hostname.startsWith('[') || !url.hostname.includes('.') || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local') || url.hostname.endsWith('.')) throw new Error('Inference remote origin must use a public DNS hostname');
  if (issuer && (url.port || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(url.hostname))) throw new Error('Inference Access issuer must be your HTTPS Cloudflare Access team origin');
  return url.origin;
}

/** Independent from the browser gateway: never infer service credentials from browser Access settings. */
export function inferenceRemoteConfig(env: NodeJS.ProcessEnv): InferenceRemoteConfig | null {
  if (env.RELAY_INFERENCE_REMOTE_ENABLED !== '1') return null;
  const origin = httpsOrigin(env.RELAY_INFERENCE_REMOTE_ORIGIN, false);
  const issuer = httpsOrigin(env.RELAY_INFERENCE_ACCESS_ISSUER, true);
  const audience = env.RELAY_INFERENCE_ACCESS_AUDIENCE;
  if (!audience || audience.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(audience)) throw new Error('Inference remote access requires a bounded Access application audience');
  const configuredPort = env.RELAY_INFERENCE_REMOTE_PORT ?? '4320';
  if (!/^[1-9]\d{3,4}$/.test(configuredPort)) throw new Error('Inference remote gateway requires a separate loopback port');
  const port = Number(configuredPort);
  if (port < 1024 || port > 65535 || [4315, 4317, 4318, 4319].includes(port)) throw new Error('Inference remote gateway requires a separate loopback port');
  return { origin, issuer, audience, port };
}

/** Verifies only the outer service gate. A Relay account token is still mandatory on every request. */
export class InferenceRemoteIdentity {
  readonly config: Readonly<InferenceRemoteConfig>;
  private readonly keys: JWTVerifyGetKey;
  constructor(config: InferenceRemoteConfig, keys?: JWTVerifyGetKey) {
    const validated = inferenceRemoteConfig({ RELAY_INFERENCE_REMOTE_ENABLED: '1', RELAY_INFERENCE_REMOTE_ORIGIN: config.origin, RELAY_INFERENCE_ACCESS_ISSUER: config.issuer, RELAY_INFERENCE_ACCESS_AUDIENCE: config.audience, RELAY_INFERENCE_REMOTE_PORT: String(config.port) })!;
    this.config = Object.freeze(validated);
    this.keys = keys ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', validated.issuer), { timeoutDuration: 5000, cooldownDuration: 30000 });
  }
  async verify(header: string | string[] | undefined): Promise<{ expiresAt: number }> {
    if (typeof header !== 'string' || !header.length || header.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header)) throw new AppError('INFERENCE_REMOTE_AUTH', 'A signed inference gateway service identity is required.', 401);
    try {
      const { payload } = await jwtVerify(header, this.keys, { issuer: this.config.issuer, audience: this.config.audience, algorithms: ['RS256'], clockTolerance: 5, requiredClaims: ['exp', 'iat', 'sub', 'common_name', 'type'] });
      const now = Math.floor(Date.now() / 1000);
      if (payload.type !== 'app' || payload.sub !== '' || payload.email !== undefined || typeof payload.common_name !== 'string' || !/^[a-zA-Z0-9_.-]{1,512}$/.test(payload.common_name)) throw new Error('Wrong service identity');
      if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.exp * 1000) || !Number.isSafeInteger(payload.iat * 1000) || payload.iat < 0 || payload.iat > now + 5 || payload.exp <= now || payload.exp <= payload.iat) throw new Error('Invalid application lifetime');
      return { expiresAt: payload.exp * 1000 };
    } catch { throw new AppError('INFERENCE_REMOTE_AUTH', 'The inference gateway service identity could not be verified.', 401); }
  }
}
