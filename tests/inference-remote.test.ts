import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { inferenceRemoteConfig, InferenceRemoteIdentity } from '../server/inference/remote.js';

const env = { RELAY_INFERENCE_REMOTE_ENABLED: '1', RELAY_INFERENCE_REMOTE_ORIGIN: 'https://inference.example.com', RELAY_INFERENCE_ACCESS_ISSUER: 'https://relay-team.cloudflareaccess.com', RELAY_INFERENCE_ACCESS_AUDIENCE: 'inference-app-audience' };
const config = { origin: env.RELAY_INFERENCE_REMOTE_ORIGIN, issuer: env.RELAY_INFERENCE_ACCESS_ISSUER, audience: env.RELAY_INFERENCE_ACCESS_AUDIENCE, port: 4320 };
let privateKey: CryptoKey, keys: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey); jwk.kid = 'inference-test';
  keys = createLocalJWKSet({ keys: [jwk] });
});
function sign(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: config.issuer, aud: [config.audience], iat: now, exp: now + 300, type: 'app', sub: '', common_name: '0123456789abcdef.access', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'inference-test', typ: 'JWT' }).sign(privateKey);
}

describe('optional public inference configuration', () => {
  it('is disabled by default and never falls back to browser Access configuration', () => {
    expect(inferenceRemoteConfig({})).toBeNull();
    expect(inferenceRemoteConfig({ RELAY_REMOTE_ENABLED: '1', RELAY_ACCESS_ISSUER: config.issuer, RELAY_ACCESS_AUDIENCE: 'browser' })).toBeNull();
    expect(() => inferenceRemoteConfig({ RELAY_INFERENCE_REMOTE_ENABLED: '1' })).toThrow();
  });
  it('returns validated HTTPS identifiers and an independent loopback port', () => {
    expect(inferenceRemoteConfig(env)).toEqual(config);
    expect(inferenceRemoteConfig({ ...env, RELAY_INFERENCE_REMOTE_PORT: '14020' })).toEqual({ ...config, port: 14020 });
    expect(inferenceRemoteConfig({ ...env, RELAY_INFERENCE_REMOTE_ORIGIN: `${config.origin}/` })).toEqual(config);
  });
  it.each(['http://inference.example.com', 'https://user:password@inference.example.com', 'https://inference.example.com/private', 'https://inference.example.com?token=x', 'https://inference.example.com#fragment', 'https://inference.example.com/path/..', 'https://inference.example.com\\', 'https://127.0.0.1', 'https://localhost'])('rejects ambiguous or inappropriate public origin %s', origin => {
    expect(() => inferenceRemoteConfig({ ...env, RELAY_INFERENCE_REMOTE_ORIGIN: origin })).toThrow();
  });
  it.each(['https://cloudflareaccess.com', 'https://team.cloudflareaccess.com.attacker.example', 'https://attacker.example', 'http://team.cloudflareaccess.com', 'https://team.cloudflareaccess.com:8443', 'https://team.cloudflareaccess.com/a', 'https://team.cloudflareaccess.com?x=1'])('rejects non-team issuer %s', issuer => {
    expect(() => inferenceRemoteConfig({ ...env, RELAY_INFERENCE_ACCESS_ISSUER: issuer })).toThrow();
  });
  it.each(['0', '80', '4315', '4317', '4318', '4319', '65536', '4e3', ' 4320', '4320.5'])('rejects unsafe or noncanonical listener port %s', port => {
    expect(() => inferenceRemoteConfig({ ...env, RELAY_INFERENCE_REMOTE_PORT: port })).toThrow();
  });
  it.each(['', 'application audience', 'x'.repeat(513), 'aud\nience'])('rejects invalid audiences', audience => {
    expect(() => inferenceRemoteConfig({ ...env, RELAY_INFERENCE_ACCESS_AUDIENCE: audience })).toThrow();
  });
});

describe('Cloudflare service identity is a distinct gate from Relay account authorization', () => {
  it('verifies a signed service token and returns only bounded expiration metadata', async () => {
    const verifier = new InferenceRemoteIdentity(config, keys);
    const expires = Math.floor(Date.now() / 1000) + 180;
    expect(await verifier.verify(await sign({ exp: expires }))).toEqual({ expiresAt: expires * 1000 });
  });
  it.each([
    { aud: ['another-application'] }, { iss: 'https://other-team.cloudflareaccess.com' },
    { type: 'org' }, { type: undefined }, { sub: 'browser-user', email: 'owner@example.com' },
    { sub: undefined }, { common_name: undefined }, { common_name: '' }, { common_name: 'x'.repeat(513) },
    { common_name: 'bad\nclient' }, { email: 'browser@example.com' }, { exp: undefined }, { iat: undefined },
    { exp: 1 }, { exp: 9_007_199_254_740_992 }, { iat: 9_007_199_254_740_992 },
  ] as JWTPayload[])('rejects a correctly signed token with the wrong identity contract', async override => {
    await expect(new InferenceRemoteIdentity(config, keys).verify(await sign(override))).rejects.toMatchObject({ code: 'INFERENCE_REMOTE_AUTH', status: 401 });
  });
  it('rejects future issuance, not-before and backwards lifetime', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const claims of [{ iat: now + 60 }, { nbf: now + 60 }, { iat: now + 120, exp: now + 60 }]) {
      await expect(new InferenceRemoteIdentity(config, keys).verify(await sign(claims))).rejects.toMatchObject({ status: 401 });
    }
  });
  it('rejects a forged signature and algorithm confusion', async () => {
    const token = await sign();
    const pieces = token.split('.'); pieces[2] = `bad${pieces[2]!.slice(3)}`;
    await expect(new InferenceRemoteIdentity(config, keys).verify(pieces.join('.'))).rejects.toMatchObject({ status: 401 });
    const symmetric = await new SignJWT({ type: 'app', sub: '', common_name: 'fake.access' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(config.issuer).setAudience(config.audience).setIssuedAt().setExpirationTime('5m').sign(new Uint8Array(32));
    await expect(new InferenceRemoteIdentity(config, keys).verify(symmetric)).rejects.toMatchObject({ status: 401 });
  });
  it('rejects duplicate, oversized and absent headers without exposing token contents', async () => {
    const verifier = new InferenceRemoteIdentity(config, keys);
    for (const input of [undefined, '', 'x'.repeat(16_001), ['one', 'two'], 'not.a.jwt']) {
      await expect(verifier.verify(input)).rejects.toMatchObject({ code: 'INFERENCE_REMOTE_AUTH', status: 401 });
    }
    await expect(verifier.verify('private-token')).rejects.not.toThrow('private-token');
  });
});
