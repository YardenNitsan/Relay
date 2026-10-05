import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';

const root = resolve('.');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const sections = ['# Third-party notices', 'Generated from the pinned production dependency tree. Upstream license and notice text is reproduced below where installed. Platform-specific optional packages retain their notices in their destination installation.'];
for (const [location, record] of Object.entries(lock.packages)) {
  if (!location.startsWith('node_modules/') || record.dev === true) continue;
  const directory = resolve(root, location);
  const scope = relative(root, directory);
  if (scope.startsWith('..') || isAbsolute(scope)) throw new Error('Dependency path escaped the project');
  let manifest;
  try { manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); } catch { continue; }
  sections.push(`## ${manifest.name} ${manifest.version}\n\nDeclared license: ${JSON.stringify(manifest.license ?? record.license ?? 'See upstream package')}`);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.filter(entry => entry.isFile() && /^(licen[cs]e|copying|notice|ofl)(\.|$)/i.test(entry.name))) {
    const path = join(directory, entry.name);
    if ((await stat(path)).size > 256000) throw new Error(`Unusually large notice: ${location}/${entry.name}`);
    sections.push(`### ${entry.name}\n\n${await readFile(path, 'utf8')}`);
  }
}
await writeFile('THIRD_PARTY_NOTICES.md', sections.join('\n\n') + '\n');
console.log('Generated third-party notices from installed production dependencies.');
