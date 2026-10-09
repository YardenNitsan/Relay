import {copyFile,mkdir} from 'node:fs/promises';
await mkdir(new URL('../dist-server/',import.meta.url),{recursive:true});
await copyFile(new URL('../server/documents/parser.mjs',import.meta.url),new URL('../dist-server/parser.mjs',import.meta.url));
