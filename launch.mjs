import { fileURLToPath } from 'node:url';
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Relay requires Node.js 24 or newer.');
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
process.env.RELAY_PACKAGED = '1';
await import('./dist-server/main.js');
