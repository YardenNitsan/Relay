import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {readPrivate} from './private-storage.js';
import {AppError} from '../core/errors.js';

/** Records only the storage kind, never a PostgreSQL URL or credential. */
export async function recordBackend(dataDir:string,external:boolean):Promise<void>{
  const expected={format:1,backend:external?'postgresql':'embedded'},path=join(dataDir,'backend.json');
  try{
    const file=await open(path,'wx',0o600);
    try{await file.writeFile(JSON.stringify(expected));await file.sync();}finally{await file.close();}
  }catch(error){
    if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    const saved=JSON.parse(await readPrivate(path)) as Record<string,unknown>;
    if(saved.format!==1||saved.backend!==expected.backend)throw new AppError('BACKEND_MISMATCH','This data directory belongs to a different database backend. Use its original configuration or restore into a new directory.');
  }
}
