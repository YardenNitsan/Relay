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
// Verified official image identities from the 2026-10-10 native acceptance run.
const references = {
  'postgres:17-alpine': 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24',
  'node:24-alpine': 'node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1',
};
for (const [tag, reference] of Object.entries(references)) {
  call(['pull', reference], { stdio: 'inherit', timeout: 180_000 });
  const inspected = JSON.parse(call(['image', 'inspect', reference]))[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(inspected.Id)) throw new Error('Invalid immutable image identity');
  images[tag] = { reference, id: inspected.Id, digests: inspected.RepoDigests };
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
  // The source pools have closed. Archive/restore remain inside this script's
  // disposable container; no production database or host data path is accepted.
  call(['exec',name,'pg_dump','-U','postgres','-d',database,'--format=custom','--file=/tmp/relay-native.dump']);
  call(['exec',name,'createdb','-U','postgres',`${database}_restored`]);
  call(['exec',name,'pg_restore','-U','postgres','-d',`${database}_restored`,'/tmp/relay-native.dump']);
  execFileSync(process.execPath,['--import','tsx','scripts/native-restore-acceptance.ts'],{stdio:'inherit',windowsHide:true,timeout:90_000,env:{...process.env,RELAY_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${binding.HostPort}/${database}`}});
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/native-integrations.ts', 'sandbox'], { stdio: 'inherit', windowsHide: true, timeout: 90_000, env: { ...process.env, RELAY_SANDBOX_IMAGE: images['node:24-alpine'].id } });
  const postgres = JSON.parse(await readFile('output/native-postgres.json', 'utf8'));
  const sandbox = JSON.parse(await readFile('output/native-sandbox.json', 'utf8'));
  const restore = JSON.parse(await readFile('output/native-postgres-restore.json','utf8'));
  await mkdir('output', { recursive: true });
  await writeFile('output/native-integrations.json', JSON.stringify({ testedAt: new Date().toISOString(), images, postgres, restore, sandbox }, null, 2) + '\n');
} finally {
  if (launched) call(['rm', '--force', name], { stdio: 'ignore' });
}
