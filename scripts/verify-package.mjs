import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

if (!process.argv[2]) throw new Error('Pass the release directory to verify');
const directory = resolve(process.argv[2]);
const records = (await readFile(join(directory, 'SHA256SUMS'), 'utf8')).trim().split('\n');
if (records.length !== 3) throw new Error('Expected three OS distributions');
for (const record of records) {
  const [, expected, name] = /^([a-f0-9]{64})  (relay-[a-zA-Z0-9.-]+)$/.exec(record) ?? [];
  if (!expected || !name) throw new Error('Invalid checksum record');
  const archive = join(directory, name);
  const actual = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch: ${name}`);
  const files = execFileSync('tar', ['-t', '-f', archive], { encoding: 'utf8' }).trim().split(/\r?\n/);
  const prefix = name.replace(/\.zip$|\.tar\.gz$/, '') + '/';
  for (const path of files) {
    if (!path.startsWith(prefix) || path.split('/').includes('..') || /\/(?:\.data|\.env|\.git|node_modules)(?:\/|$|\.)/.test(path)) throw new Error(`Unexpected archive member: ${path}`);
  }
  for (const required of ['dist/index.html', 'dist-server/main.js', 'dist-server/pair.js', 'dist-server/backup.js', 'package.json', 'package-lock.json', 'README.md', 'THIRD_PARTY_NOTICES.md', 'launch.mjs', 'start.cmd', 'start.ps1', 'start.sh']) {
    if (!files.includes(prefix + required)) throw new Error(`Missing ${required}: ${name}`);
  }
  console.log(`${name}: checksum and ${files.length} archive entries verified`);
}
