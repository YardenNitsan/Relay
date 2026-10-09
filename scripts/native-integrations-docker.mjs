// Explicit development/CI setup: downloads official images and removes only its own container.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const call = (args, options = {}) => execFileSync(docker, args, { encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 4_000_000, ...options });
const server = JSON.parse(call(['info', '--format', '{{json .}}']));
if (server.OSType !== 'linux') throw new Error('A running local Linux Docker engine is required; this script does not change Docker settings');
const context = JSON.parse(call(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
if (!context.startsWith('unix:///') && !context.startsWith('npipe:////./pipe/')) throw new Error('Integration refuses remote Docker engines');
const images = {};
for (const tag of ['postgres:17-alpine', 'node:24-alpine']) {
  call(['pull', tag], { stdio: 'inherit', timeout: 180_000 });
  const inspected = JSON.parse(call(['image', 'inspect', tag]))[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(inspected.Id)) throw new Error('Invalid immutable image identity');
  images[tag] = { id: inspected.Id, digests: inspected.RepoDigests };
}
const name = `relay-integration-postgres-${randomUUID()}`;
const password = randomBytes(32).toString('base64url');
const database = `relay_integration_${randomBytes(6).toString('hex')}`;
let launched = false;
try {
  call(['run', '--detach', '--rm', '--name', name, '--memory', '512m', '--cpus', '1', '--pids-limit', '128', '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=256m', '--env', 'POSTGRES_PASSWORD', '--env', `POSTGRES_DB=${database}`, images['postgres:17-alpine'].id], { env: { ...process.env, POSTGRES_PASSWORD: password } });
  launched = true;
  let ready = false;
  for (let count = 0; count < 60; count++) {
    try { call(['exec', name, 'pg_isready', '-U', 'postgres', '-d', database], { stdio: 'ignore', timeout: 2000 }); ready = true; break; } catch { await delay(500); }
  }
  if (!ready) throw new Error('Disposable PostgreSQL did not become ready');
  const ports = JSON.parse(call(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name]));
  const binding = ports['5432/tcp']?.[0];
  if (binding?.HostIp !== '127.0.0.1') throw new Error('Database binding was not restricted to loopback');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native-integrations.ts', 'postgres'], { stdio: 'inherit', windowsHide: true, timeout: 90_000, env: { ...process.env, RELAY_TEST_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/${database}` } });
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native-integrations.ts', 'sandbox'], { stdio: 'inherit', windowsHide: true, timeout: 90_000, env: { ...process.env, RELAY_SANDBOX_IMAGE: images['node:24-alpine'].id } });
  const postgres = JSON.parse(await readFile('output/native-postgres.json', 'utf8'));
  const sandbox = JSON.parse(await readFile('output/native-sandbox.json', 'utf8'));
  await mkdir('output', { recursive: true });
  await writeFile('output/native-integrations.json', JSON.stringify({ testedAt: new Date().toISOString(), images, postgres, sandbox }, null, 2) + '\n');
} finally {
  if (launched) call(['rm', '--force', name], { stdio: 'ignore' });
}
