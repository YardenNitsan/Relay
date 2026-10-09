import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../core/errors.js';
import type { Store } from '../db/store.js';
import type { Sql } from '../db/database.js';
import { chatPermissions } from './policy.js';

export interface RemoteConfig {publicOrigin:string;issuer:string;audience:string;port:number;registration?:'invited'|'approval';}
export interface VerifiedRemoteIdentity {userId:string;expiresAtMs:number;}
interface GatewayIdentity {email:string;sub:string;expiresAtMs:number;}
type IdentityResolution={state:'approved';userId:string}|{state:'pending'}|{state:'denied'}|{state:'uninvited'};
const pendingPermissions={...chatPermissions,providers:[],workspaceIds:[],maxCallsPerTask:1,maxSecondsPerTask:30,dailyCloudBudgetUsd:0,maxNetworkAccess:'deny',networkOrigins:[],mcpServerIds:[]};
const emailClaim=z.email().max(254);
export function remoteConfig(env:NodeJS.ProcessEnv):RemoteConfig|null {
  if(env.RELAY_REMOTE_ENABLED!=='1')return null;
  const publicOrigin=new URL(env.RELAY_REMOTE_ORIGIN??'');
  const issuer=new URL(env.RELAY_ACCESS_ISSUER??'');
  if(publicOrigin.protocol!=='https:'||publicOrigin.pathname!=='/'||publicOrigin.username||publicOrigin.password||publicOrigin.search||publicOrigin.hash)throw new Error('Remote origin must be an HTTPS origin');
  if(issuer.protocol!=='https:'||!issuer.hostname.endsWith('.cloudflareaccess.com')||issuer.port||issuer.pathname!=='/'||issuer.username||issuer.password||issuer.search||issuer.hash)throw new Error('Access issuer must be your HTTPS Cloudflare Access team origin');
  if(!env.RELAY_ACCESS_AUDIENCE||env.RELAY_ACCESS_AUDIENCE.length>512||/\s/.test(env.RELAY_ACCESS_AUDIENCE))throw new Error('Remote mode requires an Access application audience');
  const port=Number(env.RELAY_REMOTE_PORT??4318);
  if(!Number.isInteger(port)||port<1024||port>65535||port===4317)throw new Error('Remote gateway needs a separate loopback port');
  const registration=env.RELAY_REMOTE_REGISTRATION??'invited';
  if(registration!=='invited'&&registration!=='approval')throw new Error('Remote registration must be invited or approval');
  return {publicOrigin:publicOrigin.origin,issuer:issuer.origin,audience:env.RELAY_ACCESS_AUDIENCE,port,registration};
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
    let identity:GatewayIdentity;
    try {
      const {payload}=await jwtVerify(token,this.keys,{issuer:this.config.issuer,audience:this.config.audience,algorithms:['RS256'],clockTolerance:5,requiredClaims:['exp','iat','sub','email']});
      if(typeof payload.email!=='string'||typeof payload.sub!=='string'||!payload.sub.length||payload.sub.length>512||/[\x00-\x1f\x7f]/.test(payload.sub)||payload.type!=='app'||typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp*1000))throw new Error('Not an authenticated application user');
      identity={email:emailClaim.parse(payload.email).toLowerCase(),sub:payload.sub,expiresAtMs:payload.exp*1000};
    } catch {throw new AppError('REMOTE_AUTH','The gateway identity could not be verified',401);}
    const resolution=await this.resolveIdentity(identity);
    // Throw after transaction commit: pending accounts and their audit receipt must
    // persist even though authentication intentionally yields no application session.
    if(resolution.state==='pending')throw new AppError('REMOTE_PENDING','Your access request is waiting for the host owner to approve it. No model or computer access has been granted.',403);
    if(resolution.state==='denied')throw new AppError('REMOTE_DENIED','The host owner has not granted this account access or has disabled it. Contact the owner to request review.',403);
    if(resolution.state==='uninvited')throw new AppError('NOT_INVITED','The host owner has not granted this account access',403);
    return {userId:resolution.userId,expiresAtMs:identity.expiresAtMs};
  }
  private async resolveIdentity(identity:GatewayIdentity):Promise<IdentityResolution> {
    const subject=`${this.config.issuer}|${identity.sub}`;
    return this.store.db.transaction(async tx=>{
      let users=await tx.query('SELECT id,role,enabled,external_subject,registration_status FROM users WHERE lower(email)=$1 FOR UPDATE',[identity.email]);
      if(users.length>1)throw new AppError('IDENTITY_CHANGED','Multiple host records match this identity; owner review is required',403);
      if(users[0])return this.resolveExisting(tx,users[0],subject);
      if(this.config.registration!=='approval')return {state:'uninvited'};
      // New-account capacity and concurrent first logins share the durable control
      // row lock. Existing approved requests do not take this global lock.
      await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);
      users=await tx.query('SELECT id,role,enabled,external_subject,registration_status FROM users WHERE lower(email)=$1 FOR UPDATE',[identity.email]);
      if(users.length>1)throw new AppError('IDENTITY_CHANGED','Multiple host records match this identity; owner review is required',403);
      if(users[0])return this.resolveExisting(tx,users[0],subject);
      const capacity=(await tx.query("SELECT count(*) AS total,count(*) FILTER (WHERE registration_status='pending') AS pending FROM users WHERE role<>'owner'"))[0];
      if(Number(capacity.total)>=1000||Number(capacity.pending)>=100)throw new AppError('REMOTE_REGISTRATION_LIMIT','The host is not accepting additional access requests right now. Contact the owner.',429);
      const id=randomUUID();
      const inserted=await tx.query("INSERT INTO users(id,name,email,role,enabled,permissions,external_subject,registration_status,access_requested_at) VALUES ($1,$2,$3,'chat',false,$4,$5,'pending',now()) ON CONFLICT(email) DO NOTHING RETURNING id",[id,identity.email.slice(0,100),identity.email,JSON.stringify(pendingPermissions),subject]);
      if(!inserted.length) {
        const existing=(await tx.query('SELECT id,role,enabled,external_subject,registration_status FROM users WHERE lower(email)=$1 FOR UPDATE',[identity.email]))[0];
        if(!existing)return {state:'uninvited'};
        return this.resolveExisting(tx,existing,subject);
      }
      await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES (NULL,$1,$2)',['REMOTE_ACCESS_REQUESTED',JSON.stringify({userId:id,registration:'approval'})]);
      return {state:'pending'};
    });
  }
  private async resolveExisting(tx:Sql,user:Record<string,unknown>,subject:string):Promise<IdentityResolution> {
    if(user.role==='owner')return {state:'uninvited'};
    if(user.external_subject&&user.external_subject!==subject)throw new AppError('IDENTITY_CHANGED','The identity no longer matches this account',403);
    if(user.registration_status==='pending')return {state:'pending'};
    if(!user.enabled||user.registration_status!=='approved')return {state:'denied'};
    const updated=await tx.query("UPDATE users SET external_subject=$1,last_active_at=now() WHERE id=$2 AND role<>'owner' AND enabled=true AND registration_status='approved' AND (external_subject IS NULL OR external_subject=$1) RETURNING id",[subject,user.id]);
    if(!updated.length)throw new AppError('IDENTITY_CHANGED','Identity binding failed',403);
    return {state:'approved',userId:String(user.id)};
  }
}
