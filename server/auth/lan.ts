import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../core/errors.js';
import type { Store } from '../db/store.js';

export interface LanInvitation { token:string;expiresAt:string; }
export interface RedeemedLanInvitation { userId:string;sessionVersion:number; }
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const invalid=()=>new AppError('LAN_INVITATION_INVALID','This invitation is invalid, expired, revoked or already used. Ask the host owner for a new invitation.',401);
const allowed=(user:Record<string,unknown>|undefined):boolean=>!!user&&user.enabled===true&&(user.role==='chat'||user.role==='trusted')&&user.registration_status==='approved';

/** Account authentication only. Owner authorization for issuance, HTTPS, exact
 * origin validation and rate limits belong to the API boundary. Invitation codes
 * must never appear in URLs, logs, agent context, or durable plaintext storage.
 */
export class LanInvitations {
  constructor(private readonly store:Store) {}

  async issue(userId:string):Promise<LanInvitation> {
    if(!userId||userId.length>160||/[\x00-\x1f\x7f]/.test(userId))throw new AppError('LAN_INVITATION_DENIED','Choose an approved, enabled non-owner account for this invitation.',403);
    return this.store.db.transaction(async tx=>{
      // Match control-plane lock order: global admission first, then the user.
      // The shared lock bounds issuance even with multiple database clients.
      await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);
      const user=(await tx.query('SELECT id,role,enabled,registration_status,session_version FROM users WHERE id=$1 FOR UPDATE',[userId]))[0];
      if(!allowed(user))throw new AppError('LAN_INVITATION_DENIED','Choose an approved, enabled non-owner account for this invitation.',403);
      await tx.query('DELETE FROM lan_invitations WHERE expires_at<=clock_timestamp()');
      await tx.query('DELETE FROM lan_invitations WHERE user_id=$1 AND session_version<>$2',[userId,user.session_version]);
      const count=(await tx.query('SELECT count(*) AS total,count(*) FILTER (WHERE user_id=$1) AS account FROM lan_invitations',[userId]))[0];
      if(Number(count.total)>=1000||Number(count.account)>=8)throw new AppError('LAN_INVITATION_LIMIT','Too many pending LAN invitations. Use an existing invitation or wait five minutes before issuing another.',429);
      const token=randomBytes(32).toString('base64url');
      const record=(await tx.query("INSERT INTO lan_invitations(token_hash,user_id,session_version,expires_at) VALUES ($1,$2,$3,clock_timestamp()+interval '5 minutes') RETURNING expires_at",[digest(token),userId,user.session_version]))[0];
      const expiresAt=new Date(record.expires_at as string|Date).toISOString();
      await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES (NULL,$1,$2)',['LAN_INVITATION_CREATED',JSON.stringify({userId,expiresAt})]);
      return {token,expiresAt};
    });
  }

  async redeem(token:string):Promise<RedeemedLanInvitation> {
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw invalid();
    const tokenHash=digest(token);
    const result=await this.store.db.transaction(async tx=>{
      // Read the bound account before locking it, then consume the code under
      // that same user lock used by session admission/revocation. Two redeemers
      // cannot both receive a receipt. clock_timestamp checks real expiry even
      // when a transaction waited for a lock.
      const invitation=(await tx.query('SELECT user_id FROM lan_invitations WHERE token_hash=$1',[tokenHash]))[0];
      if(!invitation)return null;
      const userId=String(invitation.user_id);
      const user=(await tx.query('SELECT id,role,enabled,registration_status,session_version FROM users WHERE id=$1 FOR UPDATE',[userId]))[0];
      const consumed=(await tx.query('DELETE FROM lan_invitations WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp() RETURNING session_version',[tokenHash,userId]))[0];
      if(!consumed)return null;
      if(!allowed(user)||user.session_version!==consumed.session_version) {
        await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES (NULL,$1,$2)',['LAN_INVITATION_REJECTED',JSON.stringify({userId,reason:'account_no_longer_authorized'})]);
        return null;
      }
      await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES (NULL,$1,$2)',['LAN_INVITATION_REDEEMED',JSON.stringify({userId})]);
      return {userId,sessionVersion:Number(user.session_version)};
    });
    // Keep consumption committed even when the account is no longer eligible.
    // Session issuance is a separate operation: callers must pass sessionVersion
    // into Sessions.open so a revoke between these transactions cannot be bypassed.
    if(!result)throw invalid();
    return result;
  }
}
