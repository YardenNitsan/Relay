import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../core/errors.js';
import type { Store } from '../db/store.js';

export interface RemoteConfig {publicOrigin:string;issuer:string;audience:string;port:number;}
export interface VerifiedRemoteIdentity {userId:string;expiresAtMs:number;}
export function remoteConfig(env:NodeJS.ProcessEnv):RemoteConfig|null {
  if(env.RELAY_REMOTE_ENABLED!=='1')return null;
  const publicOrigin=new URL(env.RELAY_REMOTE_ORIGIN??'');
  const issuer=new URL(env.RELAY_ACCESS_ISSUER??'');
  if(publicOrigin.protocol!=='https:'||publicOrigin.pathname!=='/'||publicOrigin.username||publicOrigin.search||publicOrigin.hash)throw new Error('Remote origin must be an HTTPS origin');
  if(issuer.protocol!=='https:'||!issuer.hostname.endsWith('.cloudflareaccess.com')||issuer.pathname!=='/'||issuer.username||issuer.search||issuer.hash)throw new Error('Access issuer must be your HTTPS Cloudflare Access team origin');
  if(!env.RELAY_ACCESS_AUDIENCE)throw new Error('Remote mode requires an Access application audience');
  const port=Number(env.RELAY_REMOTE_PORT??4318);
  if(!Number.isInteger(port)||port<1024||port>65535||port===4317)throw new Error('Remote gateway needs a separate loopback port');
  return {publicOrigin:publicOrigin.origin,issuer:issuer.origin,audience:env.RELAY_ACCESS_AUDIENCE,port};
}
export class RemoteIdentity {
  private keys:JWTVerifyGetKey;
  constructor(private store:Store,readonly config:RemoteConfig,keys?:JWTVerifyGetKey) {
    this.keys=keys??createRemoteJWKSet(new URL('/cdn-cgi/access/certs',config.issuer),{timeoutDuration:5000,cooldownDuration:30000});
  }
  async authenticate(token:string|undefined):Promise<string> {
    return (await this.authenticateContext(token)).userId;
  }
  async authenticateContext(token:string|undefined):Promise<VerifiedRemoteIdentity> {
    if(!token||token.length>16000)throw new AppError('REMOTE_AUTH','Remote authentication is required',401);
    let identity:{email:string;sub:string;expiresAtMs:number};
    try {
      const {payload}=await jwtVerify(token,this.keys,{issuer:this.config.issuer,audience:this.config.audience,algorithms:['RS256'],clockTolerance:5,requiredClaims:['exp','iat','sub','email']});
      if(typeof payload.email!=='string'||typeof payload.sub!=='string'||payload.type!=='app'||typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp*1000))throw new Error('Not an authenticated application user');
      identity={email:payload.email.toLowerCase(),sub:payload.sub,expiresAtMs:payload.exp*1000};
    } catch {throw new AppError('REMOTE_AUTH','The gateway identity could not be verified',401);}
    const user=(await this.store.db.query("SELECT id,enabled,external_subject FROM users WHERE lower(email)=$1 AND role<>'owner'",[identity.email]))[0];
    if(!user||!user.enabled)throw new AppError('NOT_INVITED','The host owner has not granted this account access',403);
    const subject=`${this.config.issuer}|${identity.sub}`;
    if(user.external_subject&&user.external_subject!==subject)throw new AppError('IDENTITY_CHANGED','The identity no longer matches this account',403);
    const updated=await this.store.db.query('UPDATE users SET external_subject=$1,last_active_at=now() WHERE id=$2 AND (external_subject IS NULL OR external_subject=$1) RETURNING id',[subject,user.id]);
    if(!updated.length)throw new AppError('IDENTITY_CHANGED','Identity binding failed',403);return {userId:String(user.id),expiresAtMs:identity.expiresAtMs};
  }
}
