import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = pathToFileURL(resolve('scripts/setup.mjs')).href;
const setup = await import(modulePath);
const directories: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()))));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function directory() { const value = await mkdtemp(join(tmpdir(), 'relay-setup-')); directories.push(value); return value; }
async function listen(kind: 'relay' | 'other' | 'redirect') {
  const server = createServer((request, response) => {
    if (kind === 'redirect') { response.writeHead(302, { location: 'https://example.invalid' }); response.end(); return; }
    if (kind === 'other') { response.writeHead(200); response.end('unrelated service'); return; }
    response.setHeader('x-frame-options', 'DENY'); response.setHeader('cache-control', 'no-store');
    if (request.url === '/api/session') { response.writeHead(401, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: 'PAIRING_REQUIRED', error: 'Pair this browser with the local host to continue.' })); }
    else { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><html><head><title>Relay — Local intelligence, coordinated.</title></head><body><div id="root"></div><script type="module" src="/assets/index-example.js"></script></body></html>'); }
  });
  servers.push(server); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  return `http://127.0.0.1:${address.port}`;
}
describe('one-command setup boundaries', () => {
  it('rejects ambiguous flags and validates the explicit loopback port', () => {
    expect(setup.parseArguments(['--check', '--no-browser'])).toEqual({ check: true, noBrowser: true, stop: false, help: false, serve: false });
    expect(() => setup.parseArguments(['--check', '--stop'])).toThrow(/combine/);
    expect(() => setup.parseArguments(['--url=https://attacker.invalid'])).toThrow(/Unknown/);
    expect(setup.localOrigin('4317')).toBe('http://127.0.0.1:4317');
    expect(() => setup.localOrigin('4317/path')).toThrow(/port/i);
    expect(() => setup.localOrigin('80')).toThrow(/port/i);
  });
  it('recognizes Relay’s paired-owner boundary and browser shell, not an arbitrary HTTP success or redirect', async () => {
    expect((await setup.probeService(await listen('relay'))).kind).toBe('relay');
    expect((await setup.probeService(await listen('other'))).kind).toBe('occupied');
    expect((await setup.probeService(await listen('redirect'))).kind).toBe('occupied');
    await expect(setup.probeService('https://example.invalid')).rejects.toThrow(/loopback/i);
  });
  it('invalidates the build fingerprint when source content changes without relying on timestamps', async () => {
    const root = await directory(); await mkdir(join(root, 'server')); await writeFile(join(root, 'server/main.ts'), 'before'); await writeFile(join(root, 'package-lock.json'), '{}');
    const before = await setup.sourceFingerprint(root);
    expect(await setup.sourceFingerprint(root)).toBe(before);
    await writeFile(join(root, 'server/main.ts'), 'after'); expect(await setup.sourceFingerprint(root)).not.toBe(before);
    await mkdir(join(root, 'output')); await writeFile(join(root, 'output/ignored.log'), 'noise');
    const after = await setup.sourceFingerprint(root); await writeFile(join(root, 'output/ignored.log'), 'more noise'); expect(await setup.sourceFingerprint(root)).toBe(after);
  });
  it('rejects shutdown requests from a previous host or expired request without killing any process', () => {
    const now = Date.now(); const token = 'x'.repeat(43);
    expect(setup.validStopRequest({ token, expiresAt: now + 1000 }, token, now)).toBe(true);
    expect(setup.validStopRequest({ token: 'y'.repeat(43), expiresAt: now + 1000 }, token, now)).toBe(false);
    expect(setup.validStopRequest({ token, expiresAt: now - 1 }, token, now)).toBe(false);
    expect(setup.validStopRequest({ token, expiresAt: now + 1000000 }, token, now)).toBe(false);
  });
  it('chooses only official native Node distributions and refuses unsupported architectures', () => {
    expect(setup.runtimeArtifact('win32', 'arm64')).toEqual({ version: 'v24.21.0', directory: 'node-v24.21.0-win-arm64', archive: 'node-v24.21.0-win-arm64.zip' });
    expect(setup.runtimeArtifact('linux', 'x64').archive).toBe('node-v24.21.0-linux-x64.tar.gz');
    expect(() => setup.runtimeArtifact('linux', 'ia32')).toThrow(/Unsupported/);
  });
});
