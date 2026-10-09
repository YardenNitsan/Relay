// Build an unsigned native package on its destination OS. No installation occurs.
// A complete official Node distribution is required so its license accompanies it.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile, readdir, chmod, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = process.argv[2] ? resolve(process.argv[2]) : null;
assert.ok(runtime, 'Usage: node packaging/native/build.mjs <official-node-distribution-directory>');
const target = { win32: 'windows', linux: 'linux', darwin: 'macos' }[process.platform];
assert.ok(target && ['x64', 'arm64'].includes(process.arch), 'Supported native package targets are Windows, Linux and macOS x64/arm64');
const node = join(runtime, process.platform === 'win32' ? 'node.exe' : 'bin/node');
assert.ok(existsSync(node) && existsSync(join(runtime, 'LICENSE')), 'Node executable and upstream LICENSE are both required');
const runtimeInfo = JSON.parse(execFileSync(node, ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'], { encoding: 'utf8', windowsHide: true }));
assert.equal(runtimeInfo.platform, process.platform); assert.equal(runtimeInfo.arch, process.arch);
assert.ok(Number(runtimeInfo.version.split('.')[0]) >= 24);
for (const file of ['dist/index.html', 'dist-server/main.js', 'dist-server/pair.js', 'THIRD_PARTY_NOTICES.md']) assert.ok(existsSync(join(source, file)), `Build and generate notices first: ${file}`);
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = join(source, 'release', `native-${target}-${process.arch}-${stamp}`);
const payload = join(output, 'payload'); await mkdir(payload, { recursive: true });
for (const file of ['dist', 'dist-server', 'package.json', 'package-lock.json', 'launch.mjs', 'README.md', 'THIRD_PARTY_NOTICES.md', 'docs']) await cp(join(source, file), join(payload, file), { recursive: true });
await mkdir(join(payload, 'runtime', 'bin'), { recursive: true });
await cp(node, join(payload, 'runtime', process.platform === 'win32' ? 'node.exe' : 'bin/node'));
await cp(join(runtime, 'LICENSE'), join(payload, 'runtime', 'LICENSE'));
if (process.platform !== 'win32') await chmod(join(payload, 'runtime/bin/node'), 0o755);
const npmCli = process.platform === 'win32' ? join(runtime, 'node_modules/npm/bin/npm-cli.js') : join(runtime, 'lib/node_modules/npm/bin/npm-cli.js');
assert.ok(existsSync(npmCli), 'Use a complete official Node distribution including npm');
execFileSync(node, [npmCli, 'ci', '--omit=dev', '--no-fund', '--audit=false'], { cwd: payload, stdio: 'inherit', windowsHide: true });

// Original geometric Relay package icon, generated without an image dependency.
function png(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = y * (size * 4 + 1) + 1 + x * 4;
    const a = x / size, b = y / size;
    const mark = (a > .25 && a < .37 && b > .2 && b < .8) || (a >= .37 && a < .68 && b > .2 && b < .32) || (a > .59 && a < .71 && b >= .3 && b < .51) || (a >= .37 && a < .67 && b > .44 && b < .56) || (b > .5 && b < .8 && Math.abs(a - (.36 + b * .39)) < .065);
    pixels.set(mark ? [224, 236, 251, 255] : [18, 31, 51, 255], index);
  }
  function crc(buffer) { let value = 0xffffffff; for (const byte of buffer) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
  function chunk(name, bytes) { const type = Buffer.from(name), length = Buffer.alloc(4), check = Buffer.alloc(4); length.writeUInt32BE(bytes.length); check.writeUInt32BE(crc(Buffer.concat([type, bytes]))); return Buffer.concat([length, type, bytes, check]); }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
let artifact;
if (target === 'windows') {
  const sdkRoot = join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Windows Kits/10/bin');
  const versions = (await readdir(sdkRoot)).filter(value => /^10\./.test(value)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const makeappx = versions.map(version => join(sdkRoot, version, process.arch === 'arm64' ? 'arm64' : 'x64', 'makeappx.exe')).find(existsSync);
  assert.ok(makeappx, 'Windows SDK MakeAppx is required');
  const csc = join(process.env.SystemRoot ?? 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  execFileSync(csc, ['/nologo', '/target:exe', '/platform:anycpu', `/out:${join(payload, 'Relay.exe')}`, join(source, 'packaging/windows/Launcher.cs')], { stdio: 'inherit', windowsHide: true });
  await mkdir(join(payload, 'Assets'));
  for (const size of [44, 50, 150]) await writeFile(join(payload, 'Assets', `Relay${size}.png`), png(size));
  const publisher = process.env.RELAY_PACKAGE_PUBLISHER ?? 'CN=Relay Development';
  assert.ok(!/[<>"&\r\n]/.test(publisher), 'Publisher must be a safe certificate subject string');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
 <Identity Name="Relay.Local" Publisher="${publisher}" Version="${manifest.version}.0" ProcessorArchitecture="${process.arch}" />
 <Properties><DisplayName>Relay</DisplayName><PublisherDisplayName>Relay</PublisherDisplayName><Logo>Assets\\Relay50.png</Logo></Properties>
 <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" /></Dependencies>
 <Resources><Resource Language="en-us" /></Resources>
 <Applications><Application Id="Relay" Executable="Relay.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="Relay" Description="Local-first AI execution host" Square150x150Logo="Assets\\Relay150.png" Square44x44Logo="Assets\\Relay44.png" BackgroundColor="#121f33" /></Application></Applications>
 <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>`;
  await writeFile(join(payload, 'AppxManifest.xml'), xml);
  artifact = join(output, `relay-${manifest.version}-${process.arch}-unsigned.msix`);
  execFileSync(makeappx, ['pack', '/d', payload, '/p', artifact, '/h', 'SHA256', '/no'], { stdio: 'inherit', windowsHide: true });
  const unpacked = join(output, 'verified-unpack');
  execFileSync(makeappx, ['unpack', '/p', artifact, '/d', unpacked, '/no'], { stdio: 'inherit', windowsHide: true });
  assert.ok(existsSync(join(unpacked, 'dist-server/main.js')) && existsSync(join(unpacked, 'runtime/node.exe')));
} else if (target === 'linux') {
  const root = join(output, 'deb-root'); const install = join(root, 'opt/relay');
  await mkdir(install, { recursive: true }); await cp(payload, install, { recursive: true });
  await mkdir(join(root, 'DEBIAN')); await mkdir(join(root, 'usr/bin'), { recursive: true }); await mkdir(join(root, 'usr/share/applications'), { recursive: true });
  const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
  await writeFile(join(root, 'DEBIAN/control'), `Package: relay-local\nVersion: ${manifest.version}\nArchitecture: ${architecture}\nMaintainer: Relay maintainers\nSection: utils\nPriority: optional\nDepends: libc6 (>= 2.28), libstdc++6, libsecret-1-0\nDescription: Local-first AI execution platform\n Bundled Node host and browser client. Runs as the invoking desktop user.\n`);
  await writeFile(join(root, 'usr/bin/relay'), '#!/bin/sh\nset -eu\nexec /opt/relay/runtime/bin/node /opt/relay/launch.mjs "$@"\n', { mode: 0o755 });
  await writeFile(join(root, 'usr/share/applications/relay.desktop'), '[Desktop Entry]\nType=Application\nName=Relay host\nComment=Start the local AI host, then open http://127.0.0.1:4317\nExec=/usr/bin/relay\nTerminal=true\nCategories=Development;Utility;\n');
  artifact = join(output, `relay-local_${manifest.version}_${architecture}.deb`);
  execFileSync('dpkg-deb', ['--root-owner-group', '--build', root, artifact], { stdio: 'inherit' });
  execFileSync('dpkg-deb', ['--info', artifact], { stdio: 'inherit' });
  const listing = execFileSync('dpkg-deb', ['--contents', artifact], { encoding: 'utf8', maxBuffer: 10_000_000 });
  assert.ok(listing.includes('./opt/relay/runtime/bin/node') && listing.includes('./usr/bin/relay'));
} else {
  const root = join(output, 'pkg-root'); const install = join(root, 'usr/local/lib/relay');
  await mkdir(install, { recursive: true }); await cp(payload, install, { recursive: true });
  await mkdir(join(root, 'usr/local/bin'), { recursive: true });
  await writeFile(join(root, 'usr/local/bin/relay'), '#!/bin/sh\nset -eu\nexec /usr/local/lib/relay/runtime/bin/node /usr/local/lib/relay/launch.mjs "$@"\n', { mode: 0o755 });
  artifact = join(output, `relay-${manifest.version}-${process.arch}-unsigned.pkg`);
  execFileSync('/usr/bin/pkgbuild', ['--root', root, '--identifier', 'local.relay.host', '--version', manifest.version, '--install-location', '/', artifact], { stdio: 'inherit' });
  execFileSync('/usr/sbin/pkgutil', ['--expand', artifact, join(output, 'verified-pkg')], { stdio: 'inherit' });
}
// Audit all payload members: generated directories contain no source state or secrets.
let payloadFiles = 0;
async function inspect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name; const path = join(directory, entry.name);
    assert.ok(!/(^|\/)(?:\.data|\.env|\.git|owner-pairing\.json|service\.lock)(\/|$)/.test(name), `Private artifact in package: ${name}`);
    if (entry.isSymbolicLink()) {
      // npm's .bin symlinks are relative links into the same dependency tree.
      assert.ok(name.startsWith('node_modules/'), 'Unexpected payload symlink');
    } else if (entry.isDirectory()) await inspect(path, `${name}/`);
    else { assert.ok((await lstat(path)).isFile()); payloadFiles++; }
  }
}
await inspect(payload);
const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
await writeFile(join(output, 'SHA256SUMS'), `${digest}  ${artifact.split(/[\\/]/).at(-1)}\n`);
await writeFile(join(output, 'native-package.json'), JSON.stringify({ platform: process.platform, architecture: process.arch, node: runtimeInfo.version, artifact, sha256: digest, payloadFiles, signed: false, installed: false, createdAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Unsigned native package created and inspected: ${artifact}`);
console.log('Production signing, installation and OS integration acceptance are separate checks.');
