import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, readdir, stat, open, unlink, mkdir, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help = `Relay setup\n\nWindows: setup.cmd [--no-browser | --check | --stop | --help]\nLinux/macOS: sh setup.sh [--no-browser | --check | --stop | --help]\n\nDefault: prepare locked dependencies and production build, start or reuse the\nlocal host, create a private one-use pairing code, and open the browser and code\nfile. --no-browser prints locations without opening applications.\n--check inspects readiness without installing, building, starting, or pairing.\n--stop gracefully stops only a host previously started by this setup command.\nNode 24+ is required; wrappers can download it into project-local .tools.\nOptional Ollama and model installation remain under your control.\n`;

export function parseArguments(args) {
  const options = { check: false, noBrowser: false, stop: false, help: false, serve: false };
  for (const arg of args) {
    const key = { '--check': 'check', '--no-browser': 'noBrowser', '--stop': 'stop', '--help': 'help', '--serve': 'serve' }[arg];
    if (!key) throw new Error(`Unknown setup option: ${arg}`);
    options[key] = true;
  }
  if ([options.check, options.stop, options.serve].filter(Boolean).length > 1) throw new Error('Do not combine --check, --stop, or internal host mode');
  return options;
}
export function localOrigin(value = '4317') {
  if (!/^\d{4,5}$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535) throw new Error('RELAY_PORT must be a port between 1024 and 65535');
  return `http://127.0.0.1:${Number(value)}`;
}
export function runtimeArtifact(platform, architecture) {
  const os = { win32: 'win', linux: 'linux', darwin: 'darwin' }[platform];
  if (!os || !['x64', 'arm64'].includes(architecture)) throw new Error('Unsupported Node bootstrap platform or architecture');
  const version = 'v24.21.0'; const directory = `node-${version}-${os}-${architecture}`;
  return { version, directory, archive: directory + (platform === 'win32' ? '.zip' : '.tar.gz') };
}
async function boundedText(response, maximum = 256 * 1024) {
  const reader = response.body?.getReader(); if (!reader) return '';
  let length = 0; const chunks = [];
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > maximum) throw new Error('Unexpectedly large service response'); chunks.push(chunk.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function probeService(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Setup probes only an exact loopback origin');
  try {
    const response = await fetch(`${url.origin}/api/session`, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    const body = await boundedText(response); let value;
    try { value = JSON.parse(body); } catch { return { kind: 'occupied' }; }
    if (response.status !== 401 || value.code !== 'PAIRING_REQUIRED' || response.headers.get('x-frame-options') !== 'DENY' || response.headers.get('cache-control') !== 'no-store') return { kind: 'occupied' };
    const shell = await fetch(url.origin, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
    const html = await boundedText(shell);
    if (shell.status !== 200 || !/<title>[^<]*Relay/i.test(html) || !/id=["']root["']/.test(html) || !/type=["']module["']/.test(html)) return { kind: 'occupied' };
    return { kind: 'relay' };
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED' || error.cause?.errors?.every(item => item.code === 'ECONNREFUSED')) return { kind: 'absent' };
    return { kind: 'unresponsive', reason: 'The loopback listener could not be identified safely' };
  }
}
async function sourceFiles(directory) {
  const files = [];
  async function walk(path, relative) {
    let entries; try { entries = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Build input contains a link: ${relative}${entry.name}`);
      if (entry.isDirectory()) await walk(join(path, entry.name), `${relative}${entry.name}/`);
      else if (entry.isFile()) files.push(relative + entry.name);
    }
  }
  for (const name of ['server', 'shared', 'web', 'scripts', 'tests']) await walk(join(directory, name), `${name}/`);
  for (const name of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts']) if (existsSync(join(directory, name))) files.push(name);
  return files.sort();
}
export async function sourceFingerprint(directory) {
  const digest = createHash('sha256');
  for (const name of await sourceFiles(directory)) { digest.update(name + '\0'); digest.update(await readFile(join(directory, name))); digest.update('\0'); }
  return digest.digest('hex');
}
async function npmPath() {
  const binaryDirectory = dirname(await realpath(process.execPath));
  const candidates = [join(binaryDirectory, 'node_modules/npm/bin/npm-cli.js'), join(binaryDirectory, '../lib/node_modules/npm/bin/npm-cli.js'), '/usr/share/nodejs/npm/bin/npm-cli.js'];
  for (const path of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    const npm = join(path, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    if (existsSync(npm)) { if (process.platform === 'win32') candidates.push(join(path, 'node_modules/npm/bin/npm-cli.js')); else candidates.push(await realpath(npm)); }
  }
  const found = candidates.find(existsSync); if (!found) throw new Error('The selected Node installation has no npm. Use the complete official Node distribution.');
  return found;
}
async function installedDependencies(directory, npm) {
  try {
    const wanted = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
    const actual = JSON.parse(await readFile(join(directory, 'node_modules/.package-lock.json'), 'utf8'));
    for (const [name, record] of Object.entries(actual.packages ?? {})) {
      if (!wanted.packages[name] || record.version !== wanted.packages[name].version || record.integrity !== wanted.packages[name].integrity) return false;
    }
    await run(process.execPath, [npm, 'ls', '--all', '--parseable'], { cwd: directory, windowsHide: true, timeout: 30000, maxBuffer: 4_000_000 });
    return true;
  } catch { return false; }
}
function runForeground(args) {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? process.env.Path ?? ''}` } });
    child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(new Error(`Setup command exited ${code}: ${args.slice(1).join(' ')}`)));
  });
}
async function optionalRuntime() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Offline');
    const value = JSON.parse(await boundedText(response));
    console.log(`Ollama: reachable; ${Array.isArray(value.models) ? value.models.length : 0} installed models detected. Relay still checks hardware compatibility before use.`);
  } catch { console.log('Ollama: not reachable. Local model setup is optional during installation; see https://ollama.com/download and docs/setup.md. No model was downloaded.'); }
}
async function privateStorage() { return import(pathToFileURL(join(root, 'server/host/private-storage.ts')).href); }
async function alivePid(path) { try { const pid = Number(await readFile(path, 'utf8')); if (!Number.isInteger(pid) || pid < 1) return null; process.kill(pid, 0); return pid; } catch { return null; } }
export function validStopRequest(request, token, now = Date.now()) {
  if (!request || typeof request.token !== 'string' || !Number.isFinite(request.expiresAt) || request.expiresAt < now || request.expiresAt > now + 30000) return false;
  const a = Buffer.from(request.token), b = Buffer.from(token); return a.length === b.length && timingSafeEqual(a, b);
}
async function serve(dataDirectory, origin) {
  const { privateDirectory, writePrivate, readPrivate } = await privateStorage();
  const startup = await privateDirectory(join(dataDirectory, 'startup'));
  const token = randomBytes(32).toString('base64url');
  await import(pathToFileURL(join(root, 'dist-server/main.js')).href);
  await writePrivate(join(startup, 'setup-host.json'), JSON.stringify({ pid: process.pid, origin, token, startedAt: new Date().toISOString() }));
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return; checking = true;
    try {
      const request = JSON.parse(await readPrivate(join(startup, 'stop-request.json')));
      if (validStopRequest(request, token)) { clearInterval(timer); await unlink(join(startup, 'stop-request.json')); await unlink(join(startup, 'setup-host.json')); process.emit('SIGTERM'); }
    } catch { /* No valid private shutdown request. */ } finally { checking = false; }
  }, 500);
  timer.unref();
}
async function stopOwned(dataDirectory, origin) {
  const { readPrivate, writePrivate } = await privateStorage(); const startup = join(dataDirectory, 'startup');
  let metadata; try { metadata = JSON.parse(await readPrivate(join(startup, 'setup-host.json'))); } catch { throw new Error('This host was not started by setup. Stop it in its original terminal or service manager; setup will not terminate unrelated processes.'); }
  if (metadata.origin !== origin || metadata.pid !== await alivePid(join(dataDirectory, 'service.lock')) || !/^[A-Za-z0-9_-]{43}$/.test(metadata.token)) throw new Error('The recorded setup host is no longer current; no process was stopped');
  await writePrivate(join(startup, 'stop-request.json'), JSON.stringify({ token: metadata.token, expiresAt: Date.now() + 30000 }));
  for (let count = 0; count < 60; count++) { if (!await alivePid(join(dataDirectory, 'service.lock'))) { console.log('Relay host stopped gracefully. Run setup again to restart.'); return; } await delay(500); }
  throw new Error('The host has not completed graceful shutdown. Inspect its private startup log; setup does not force-kill it.');
}
async function openApplications(origin, pairingFile) {
  if (process.platform === 'win32') {
    const command = "$ErrorActionPreference='Stop'; Start-Process -FilePath $env:RELAY_SETUP_ORIGIN; $pairingArgument='\"'+$env:RELAY_SETUP_PAIRING_FILE+'\"'; Start-Process -FilePath 'notepad.exe' -ArgumentList $pairingArgument";
    await run(join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, env: { ...process.env, RELAY_SETUP_ORIGIN: origin, RELAY_SETUP_PAIRING_FILE: pairingFile } });
  } else {
    const opener = process.platform === 'darwin' ? '/usr/bin/open' : 'xdg-open';
    await run(opener, [origin], { timeout: 15000 });
    await run(opener, process.platform === 'darwin' ? ['-t', pairingFile] : [pairingFile], { timeout: 15000 });
  }
}
async function pairAndOpen(dataDirectory, origin, noBrowser) {
  await run(process.execPath, ['dist-server/pair.js', '--data-dir', dataDirectory], { cwd: root, windowsHide: true, timeout: 15000, maxBuffer: 16000 });
  const pairingFile = join(dataDirectory, 'auth/owner-pairing.json');
  console.log(`Open ${origin}\nOne-use code file: ${pairingFile}\nEnter the token from this private file in the browser. It expires in five minutes.`);
  await optionalRuntime();
  if (!noBrowser) {
    try { await openApplications(origin, pairingFile); }
    catch { console.log('Automatic opening was unavailable. Open the local address and private code file shown above. The host remains available.'); }
  }
}
export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args); if (options.help) { console.log(help); return; }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required. Run the setup.cmd or setup.sh wrapper to bootstrap it locally.');
  process.chdir(root);
  const origin = localOrigin(process.env.RELAY_PORT ?? '4317');
  const dataDirectory = resolve(process.env.RELAY_DATA_DIR ?? '.data');
  process.env.RELAY_DATA_DIR = dataDirectory;
  if (options.serve) { await serve(dataDirectory, origin); return; }
  if (options.stop) { await stopOwned(dataDirectory, origin); return; }
  const service = await probeService(origin);
  const npm = await npmPath();
  const dependenciesReady = await installedDependencies(root, npm);
  const fingerprint = await sourceFingerprint(root);
  const statePath = join(root, '.tools/setup-state.json'); let state = {};
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch { /* First setup or removed generated state. */ }
  const outputs = ['dist/index.html', 'dist-server/main.js', 'dist-server/pair.js'];
  let buildReady = outputs.every(path => existsSync(join(root, path))) && state.fingerprint === fingerprint;
  if (!buildReady && outputs.every(path => existsSync(join(root, path)))) {
    const oldestOutput = Math.min(...await Promise.all(outputs.map(path => stat(join(root, path)).then(info => info.mtimeMs))));
    const newestInput = Math.max(...await Promise.all((await sourceFiles(root)).map(path => stat(join(root, path)).then(info => info.mtimeMs))));
    buildReady = oldestOutput >= newestInput;
  }
  console.log(`Node ${process.version}; dependencies ${dependenciesReady ? 'ready' : 'need installation'}; production build ${buildReady ? 'ready' : 'needs build'}; host ${service.kind}.`);
  if (options.check) { await optionalRuntime(); console.log(`Local address: ${origin}\nData: ${dataDirectory}`); if (service.kind === 'occupied' || service.kind === 'unresponsive') process.exitCode = 1; return; }
  if (service.kind === 'occupied' || service.kind === 'unresponsive') throw new Error(`Port ${new URL(origin).port} is occupied by an unrecognized or unresponsive service. No process was stopped. Choose RELAY_PORT or inspect the listener.`);
  if (service.kind === 'relay') {
    if (!await alivePid(join(dataDirectory, 'service.lock'))) throw new Error('Relay is already listening but does not match this data directory. Set RELAY_DATA_DIR to the running host directory; no pairing code was issued.');
    console.log('Reusing the running Relay host. Its tasks, process, dependencies and build are preserved.');
    if (!buildReady || !dependenciesReady) console.log('Source or dependency updates are pending. Stop the host after its current work finishes, then run setup again to apply them.');
    await pairAndOpen(dataDirectory, origin, options.noBrowser); return;
  }
  if (!dependenciesReady) {
    console.log('Installing exact locked dependencies...'); await runForeground([npm, 'ci']);
    buildReady = false;
  }
  if (!buildReady) { console.log('Building browser and host...'); await runForeground([npm, 'run', 'build']); }
  await mkdir(join(root, '.tools'), { recursive: true });
  await writeFile(statePath, JSON.stringify({ fingerprint, builtAt: new Date().toISOString() }, null, 2) + '\n');
  const { privateDirectory } = await privateStorage();
  await privateDirectory(dataDirectory); const startup = await privateDirectory(join(dataDirectory, 'startup'));
  if (service.kind === 'absent') {
    const logPath = join(startup, `host-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    const log = await open(logPath, 'wx', 0o600);
    try {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, RELAY_DATA_DIR: dataDirectory, RELAY_DEV: '0' } });
      await new Promise((accept, reject) => { child.once('spawn', accept); child.once('error', reject); }); child.unref();
    } finally { await log.close(); }
    let ready = false;
    for (let count = 0; count < 120; count++) { if ((await probeService(origin)).kind === 'relay') { ready = true; break; } await delay(500); }
    if (!ready) throw new Error(`Relay did not become ready. Inspect the private log: ${logPath}`);
    console.log(`Relay started. Private log: ${logPath}`);
  }
  await pairAndOpen(dataDirectory, origin, options.noBrowser);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Relay setup: ${error.message}`); process.exitCode = 1; });
}
