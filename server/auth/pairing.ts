import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstat, open, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AppError } from '../core/errors.js';
import { privateDirectory, readPrivate, writePrivate } from '../host/private-storage.js';

const digest=(token:string)=>createHash('sha256').update(token).digest();
const invalid=()=>new AppError('PAIRING_INVALID','This pairing code is invalid, expired, or already used. Generate a new code on the host.',401);
export class LocalPairing {
  readonly directory:string;
  readonly deliveryFile:string;
  private ready:Promise<void>|undefined;
  constructor(dataDir:string){this.directory=join(resolve(dataDir),'auth');this.deliveryFile=join(this.directory,'owner-pairing.json');}
  async initialize():Promise<void> {this.ready??=privateDirectory(this.directory).then(()=>{});return this.ready;}
  async issue():Promise<{token:string;expiresAt:string;deliveryFile:string}> {
    await this.initialize();
    let pending=0;
    for(const name of await readdir(this.directory)) {
      if(/^redeemed-[a-f0-9]{64}\.json$/.test(name)) {
        const path=join(this.directory,name);
        // A claim can only be created while a five-minute challenge is valid.
        // Retain even a crash-created empty claim for its entire maximum life.
        if(Date.now()-(await lstat(path)).mtimeMs>5*60*1000)await unlink(path).catch(()=>{});
        continue;
      }
      if(!/^challenge-[a-f0-9]{64}\.json$/.test(name))continue;
      const path=join(this.directory,name);
      const record=JSON.parse(await readPrivate(path)) as {expiresAt:number};
      if(!Number.isFinite(record.expiresAt)||record.expiresAt<=Date.now())await unlink(path).catch(()=>{});else pending++;
    }
    if(pending>=8)throw new AppError('PAIRING_LIMIT','Too many pending pairing codes. Wait five minutes before issuing another.',429);
    const token=randomBytes(32).toString('base64url');const hash=digest(token).toString('hex');const expiry=Date.now()+5*60*1000;
    await writePrivate(join(this.directory,`challenge-${hash}.json`),JSON.stringify({hash,expiresAt:expiry}));
    const expiresAt=new Date(expiry).toISOString();await writePrivate(this.deliveryFile,JSON.stringify({token,expiresAt},null,2)+'\n');
    return {token,expiresAt,deliveryFile:this.deliveryFile};
  }
  async redeem(token:string):Promise<void> {
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid();
    await this.initialize();
    const hash=digest(token);const pending=join(this.directory,`challenge-${hash.toString('hex')}.json`);
    const claimed=join(this.directory,`redeemed-${hash.toString('hex')}.json`);
    try {
      const record=JSON.parse(await readPrivate(pending)) as {hash:string;expiresAt:number};
      const expected=Buffer.from(record.hash,'hex');
      if(expected.length!==hash.length||!timingSafeEqual(expected,hash)||!Number.isFinite(record.expiresAt)||record.expiresAt<=Date.now())throw invalid();
      // CREATE_NEW/O_EXCL is the single-use claim across processes and Windows
      // rename handles. Never release the claim if later session creation fails.
      const claim=await open(claimed,'wx',0o600);
      try{await claim.writeFile(JSON.stringify({expiresAt:record.expiresAt}));await claim.sync();}
      finally{await claim.close();}
      await unlink(pending).catch(()=>{});
      if(record.expiresAt<=Date.now())throw invalid();
    } catch {throw invalid();}
  }
}
