// Exercises the compiled production service under a native Linux runtime.
// Pairing credentials stay in process memory/private delivery files, never output.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'linux', 'This verification requires native Linux Node');
const runDirectory = resolve(process.argv[2] ?? '.');
assert.match(runDirectory, /^\/tmp\/relay-linux-verification[^/]*(\/|$)/);
const dataDirectory = join(runDirectory, 'host-data');
await mkdir(dataDirectory, { mode: 0o700, recursive: true });
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((accept, reject) => reservation.close(error => error ? reject(error) : accept()));
const origin = `http://127.0.0.1:${port}`;
const environment = {
  PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8',
  RELAY_PORT: String(port), RELAY_DATA_DIR: dataDirectory,
};
let child;
let logs = '';
const credentials = [];
const checkOutput = (await readFile(join(runDirectory, 'check.log'), 'utf8')).replace(/\x1b\[[0-9;]*m/g, '');
const report = {
  testedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
  sourceSnapshotSha256: (await readFile(join(runDirectory, 'source.sha256'), 'utf8')).split(' ')[0],
  testFiles: Number(checkOutput.match(/Test Files\s+(\d+) passed/)?.[1] ?? 0),
  tests: Number(checkOutput.match(/Tests\s+(\d+) passed/)?.[1] ?? 0),
  checks: [], database: null, hardware: null, gracefulStops: 0,
};
assert.ok(report.tests > 0 && report.testFiles > 0, 'Cannot identify a passing test report');
async function start() {
  child = spawn(process.execPath, ['dist-server/main.js'], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', buffer => { logs += buffer.toString(); });
  child.stderr.on('data', buffer => { logs += buffer.toString(); });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw new Error(`Production host exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/api/session`);
      if (response.status === 401) return;
      throw new Error(`Unpaired session returned ${response.status}`);
    } catch (error) { if (!(error instanceof TypeError)) throw error; }
    await delay(250);
  }
  throw new Error('Production host did not become ready');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  const exited = once(current, 'exit');
  current.kill('SIGTERM');
  const timer = setTimeout(() => current.kill('SIGKILL'), 15_000);
  try {
    const [code, signal] = await exited;
    assert.equal(code, 0, `Host failed graceful SIGTERM shutdown (${signal})`);
    report.gracefulStops++;
  } finally { clearTimeout(timer); child = undefined; }
}
async function issue() {
  execFileSync(process.execPath, ['dist-server/pair.js', '--data-dir', dataDirectory], { env: environment, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 });
  const file = join(dataDirectory, 'auth', 'owner-pairing.json');
  const delivery = JSON.parse(await readFile(file, 'utf8'));
  credentials.push(delivery.token);
  assert.equal((await stat(dataDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(join(dataDirectory, 'auth'))).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  return delivery.token;
}
async function pair(token) {
  return fetch(`${origin}/api/session/pair`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
}
try {
  await start();
  report.checks.push('Unpaired loopback session requires authentication');
  assert.equal((await fetch(`${origin}/api/conversations`)).status, 401);
  const token = await issue();
  report.checks.push('Native owner pairing CLI produces POSIX 0700 directories and 0600 credential delivery');
  const paired = await pair(token);
  assert.equal(paired.status, 200);
  const cookie = paired.headers.get('set-cookie')?.split(';')[0];
  const session = await paired.json();
  assert.equal(session.user.role, 'owner');
  assert.ok(cookie);
  credentials.push(session.csrfToken, cookie.split('=')[1]);
  assert.equal((await pair(token)).status, 401);
  report.checks.push('Pairing establishes owner session and replay of consumed code is rejected');
  const headers = { cookie, origin, 'content-type': 'application/json', 'x-relay-csrf': session.csrfToken };
  const denied = await fetch(`${origin}/api/conversations`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Should not exist' }) });
  assert.equal(denied.status, 403);
  report.checks.push('Paired mutation without CSRF token is rejected');
  const created = await fetch(`${origin}/api/conversations`, { method: 'POST', headers, body: JSON.stringify({ title: 'Native Linux persistence verification' }) });
  assert.equal(created.status, 200);
  const conversation = await created.json();
  const status = await fetch(`${origin}/api/status`, { headers });
  assert.equal(status.status, 200);
  report.database = (await status.json()).database;
  assert.equal(report.database, 'Embedded PostgreSQL');
  const telemetryResponse = await fetch(`${origin}/api/hardware`, { headers });
  assert.equal(telemetryResponse.status, 200);
  const telemetry = await telemetryResponse.json();
  assert.equal(telemetry.platform, 'linux');
  assert.ok(telemetry.memory.totalBytes > 0 && telemetry.memory.availableBytes > 0);
  assert.ok(telemetry.cpu.logicalCores > 0);
  report.hardware = {
    sampledAt: telemetry.sampledAt, platform: telemetry.platform, architecture: telemetry.architecture,
    memoryArchitecture: telemetry.memoryArchitecture, logicalCores: telemetry.cpu.logicalCores,
    totalRamBytes: telemetry.memory.totalBytes, availableRamBytes: telemetry.memory.availableBytes,
    gpuCount: telemetry.gpus.length, warnings: telemetry.warnings,
  };
  report.checks.push('Authenticated hardware endpoint returns actual Linux host telemetry');
  const html = await fetch(origin);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /<html/);
  report.checks.push('Compiled service serves browser assets and writes a real embedded PostgreSQL conversation');
  await stop();
  await start();
  const restored = await fetch(`${origin}/api/conversations/${conversation.id}`, { headers });
  assert.equal(restored.status, 200);
  const detail = await restored.json();
  assert.equal(detail.conversation.title, 'Native Linux persistence verification');
  report.checks.push('Conversation and paired owner session survive production service restart');
  const streamController = new AbortController();
  const deadline = setTimeout(() => streamController.abort(), 17_000);
  try {
    const stream = await fetch(`${origin}/api/events?after=${detail.cursor}`, { headers, signal: streamController.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    let streamed = '';
    try {
      while (!streamed.includes(': heartbeat')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false, 'Event stream closed before idle heartbeat');
        streamed += Buffer.from(chunk.value).toString();
      }
    } finally { await reader.cancel(); }
    report.checks.push('Authenticated SSE remains open through its idle heartbeat after restart');
  } finally { clearTimeout(deadline); streamController.abort(); }
  await stop();
  for (const secret of credentials) assert.ok(!logs.includes(secret), 'Pairing secret appeared in host logs');
  report.checks.push('Host logs contain no issued pairing token, session token, or CSRF token');
  report.passed = true;
  await writeFile(join(runDirectory, 'host-smoke.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(runDirectory, 'host.log'), logs, { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
} finally { await stop(); }
