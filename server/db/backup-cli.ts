import {mkdir,open} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {createBackup,restoreBackup,verifyBackup} from './backup.js';
import {privateDirectory,readPrivate} from '../host/private-storage.js';
import {publicError} from '../core/errors.js';

const usage=`Relay offline backup
  node dist-server/backup.js keygen --key-dir <new private directory>
  node dist-server/backup.js create --data-dir <stopped data directory> --backup-dir <new directory> --key-file <private key file>
  node dist-server/backup.js verify --backup-dir <backup directory> --key-file <private key file>
  node dist-server/backup.js restore --backup-dir <backup directory> --restore-dir <new directory> --key-file <private key file>
Stop Relay before create. Restore publishes <restore-dir>/data and never starts Relay.
Keep the key separate from the encrypted backup. Losing it makes recovery impossible.
`;
async function main(){
  const [command,...args]=process.argv.slice(2);
  if(!command||command==='--help'){process.stdout.write(usage);return;}
  const allowed:Record<string,string[]>={keygen:['--key-dir'],create:['--data-dir','--backup-dir','--key-file'],verify:['--backup-dir','--key-file'],restore:['--backup-dir','--restore-dir','--key-file']};
  const keys=allowed[command];if(!keys||args.length!==keys.length*2)throw new Error('Invalid arguments. Run with --help for usage.');
  const values=new Map<string,string>();
  for(let i=0;i<args.length;i+=2){if(!keys.includes(args[i])||values.has(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Invalid or repeated argument.');values.set(args[i],resolve(args[i+1]));}
  if(command==='keygen'){
    const directory=values.get('--key-dir')!;await mkdir(directory,{mode:0o700});await privateDirectory(directory);
    const path=join(directory,'backup.key'),secret=randomBytes(48);
    try{const file=await open(path,'wx',0o600);try{await file.writeFile(secret.toString('base64url')+'\n');await file.sync();}finally{await file.close();}}finally{secret.fill(0);}
    process.stdout.write(`Backup key created in a private file: ${path}\nKeep this file separate from your backup. Its content is never printed.\n`);return;
  }
  const passphrase=Buffer.from((await readPrivate(values.get('--key-file')!)).trimEnd(),'utf8');
  try{
    const input={backupDir:values.get('--backup-dir')!,passphrase};
    const result=command==='create'?await createBackup({...input,sourceDir:values.get('--data-dir')!}):command==='restore'?await restoreBackup({...input,destinationDir:values.get('--restore-dir')!}):await verifyBackup(input);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }finally{passphrase.fill(0);}
}
try{await main();}catch(error){process.stderr.write(`Backup operation failed: ${publicError(error)}\n`);process.exitCode=1;}
