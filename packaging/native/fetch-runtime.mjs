// Fetch one official runtime into generated output, verifying its published hash.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const version = 'v24.11.1';
const platform = { win32: 'win', linux: 'linux', darwin: 'darwin' }[process.platform];
assert.ok(platform && ['x64', 'arm64'].includes(process.arch), 'Unsupported native runtime');
const name = `node-${version}-${platform}-${process.arch}`;
const file = `${name}${process.platform === 'win32' ? '.zip' : '.tar.gz'}`;
const directory = resolve('output/native-runtime'); await mkdir(directory, { recursive: true });
const base = `https://nodejs.org/dist/${version}/`;
async function download(path) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Official runtime download failed: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
const manifest = (await download('SHASUMS256.txt')).toString('utf8');
const line = manifest.split('\n').find(value => value.endsWith(`  ${file}`));
assert.ok(line, 'Official checksum manifest has no matching archive');
const expected = line.slice(0, 64); assert.match(expected, /^[a-f0-9]{64}$/);
let archive;
try { archive = await readFile(join(directory, file)); } catch { archive = await download(file); }
assert.equal(createHash('sha256').update(archive).digest('hex'), expected, 'Official runtime archive checksum mismatch');
await writeFile(join(directory, file), archive);
await writeFile(join(directory, `${file}.sha256`), `${expected}  ${file}\n`);
execFileSync('tar', ['-xf', join(directory, file), '-C', directory], { stdio: 'inherit', windowsHide: true });
console.log(join(directory, name));
