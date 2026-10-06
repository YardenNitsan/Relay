import { resolve } from 'node:path';
import { LocalPairing } from './pairing.js';
import { hostPlatform } from '../host/platform.js';

const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--data-dir'))throw new Error('Usage: node dist-server/pair.js [--data-dir <host data directory>]');
const dataDir=resolve(args[1]??process.env.RELAY_DATA_DIR??(process.env.RELAY_PACKAGED==='1'?hostPlatform().dataDirectory():'.data'));
const issued=await new LocalPairing(dataDir).issue();
// Never print the credential, including when output is redirected or collected.
process.stdout.write(`Open this private file on the host and enter its code in Relay:\n${issued.deliveryFile}\nExpires: ${issued.expiresAt}\n`);
