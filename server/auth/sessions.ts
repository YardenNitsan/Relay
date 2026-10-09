import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../core/errors.js';
import { row, Store } from '../db/store.js';
import type { Principal, User } from './policy.js';

interface SessionRow {id:string;userId:string;csrfToken:string;remote:boolean;version:number;expiresAt:string;}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class Sessions {
  constructor(private store:Store,private remote=false) {}
  private get name() {return this.remote?'__Host-relay_remote':'relay_local';}
  async initialize():Promise<void> {
    await this.store.db.transaction(async tx=>{
      await tx.query('SELECT value FROM settings WHERE key=$1 FOR UPDATE',['control']);
      if((await tx.query('SELECT key FROM settings WHERE key=$1',['local_pairing_v1'])).length)return;
      await tx.query('DELETE FROM sessions WHERE remote=false');
      await tx.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");
      await tx.query('INSERT INTO settings(key,value) VALUES ($1,$2)',['local_pairing_v1','true']);
    });
  }
  async user(id:string):Promise<User> {
    const found=(await this.store.db.query('SELECT * FROM users WHERE id=$1',[id]))[0];
    if(!found)throw new AppError('AUTH_REQUIRED','Authentication required',401);return row<User>(found);
  }
  async principal(request:FastifyRequest,externalUserId?:string):Promise<Principal> {
    const token=request.cookies[this.name];
    if(!token)throw new AppError('AUTH_REQUIRED','Open a new session to continue',401);
    const found=(await this.store.db.query('SELECT * FROM sessions WHERE id=$1 AND expires_at>now()',[hash(token)]))[0];
    if(!found)throw new AppError('SESSION_EXPIRED','Session expired. Reload to reconnect.',401);
    const session=row<SessionRow>(found);const user=await this.user(session.userId);
    if(!user.enabled||user.registrationStatus!==undefined&&user.registrationStatus!=='approved'||session.version!==user.sessionVersion||session.remote!==this.remote||externalUserId&&externalUserId!==user.id)throw new AppError('SESSION_REVOKED','This session is no longer authorized',401);
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers['x-relay-csrf']!==session.csrfToken)throw new AppError('CSRF','The request has no valid session CSRF token',403);
    return {user,remote:this.remote,sessionId:session.id};
  }
  async open(request:FastifyRequest,reply:FastifyReply,userId='owner',authenticated=false,expectedSessionVersion?:number) {
    const observed=await this.user(userId);
    if(!observed.enabled||observed.registrationStatus!==undefined&&observed.registrationStatus!=='approved')throw new AppError('USER_DISABLED','This account is disabled',403);
    const opened=await this.store.db.transaction(async tx=>{
      // The user row is also updated by revocation. Counting and insertion under
      // its lock bound admission across listeners and native PostgreSQL clients.
      const found=(await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]))[0];
      if(!found)throw new AppError('AUTH_REQUIRED','Authentication required',401);
      const user=row<User>(found);
      if(!user.enabled||user.registrationStatus!==undefined&&user.registrationStatus!=='approved')throw new AppError('USER_DISABLED','This account is disabled',403);
      if(user.sessionVersion!==observed.sessionVersion)throw new AppError('SESSION_REVOKED','Account sessions changed during sign-in. Reload to authenticate again.',401);
      if(expectedSessionVersion!==undefined&&user.sessionVersion!==expectedSessionVersion)throw new AppError('SESSION_REVOKED','The invitation was revoked before session admission. Ask the owner for a new invitation.',401);
      const cookie=request.cookies[this.name];
      if(cookie) {
        const record=(await tx.query('SELECT csrf_token FROM sessions WHERE id=$1 AND user_id=$2 AND remote=$3 AND version=$4 AND expires_at>now()',[hash(cookie),userId,this.remote,user.sessionVersion]))[0];
        if(record&&(['GET','HEAD','OPTIONS'].includes(request.method)||request.headers['x-relay-csrf']===record.csrf_token)) {
          return {csrfToken:String(record.csrf_token),user,token:null,expires:null};
        }
      }
      if(!authenticated)throw new AppError('PAIRING_REQUIRED','Pair this browser with the local host to continue.',401);
      await tx.query('DELETE FROM sessions WHERE user_id=$1 AND (expires_at<=now() OR version<>$2)',[userId,user.sessionVersion]);
      const active=(await tx.query('SELECT count(*) AS count FROM sessions WHERE user_id=$1 AND expires_at>now() AND version=$2',[userId,user.sessionVersion]))[0];
      if(Number(active.count)>=20)throw new AppError('SESSION_LIMIT','This account already has 20 active browser sessions. Sign out an existing browser or ask the owner to revoke a session, then try again.',429);
      const token=randomBytes(32).toString('base64url');const csrfToken=randomBytes(32).toString('base64url');
      const expires=new Date(Date.now()+(this.remote?60*60:12*60*60)*1000);
      await tx.query('INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[hash(token),userId,csrfToken,this.remote,(request.headers['user-agent']??'Unknown client').slice(0,240),user.sessionVersion,expires.toISOString()]);
      await tx.query('UPDATE users SET last_active_at=now() WHERE id=$1',[userId]);
      return {csrfToken,user,token,expires};
    });
    // Never emit an authentication cookie until durable admission commits.
    if(opened.token&&opened.expires)reply.setCookie(this.name,opened.token,{httpOnly:true,sameSite:'strict',secure:this.remote,path:'/',expires:opened.expires});
    return {csrfToken:opened.csrfToken,user:opened.user,remote:this.remote};
  }
  async close(request:FastifyRequest,reply:FastifyReply,principal:Principal):Promise<void> {
    const token=request.cookies[this.name];
    if(principal.remote!==this.remote||!token||hash(token)!==principal.sessionId)throw new AppError('SESSION_REVOKED','This session is no longer authorized',401);
    // The API obtains principal through principal(request), including its CSRF
    // check. No user-supplied session ID or logout target is accepted here.
    await this.store.db.transaction(async tx=>{
      const removed=await tx.query('DELETE FROM sessions WHERE id=$1 AND user_id=$2 AND remote=$3 RETURNING id',[principal.sessionId,principal.user.id,this.remote]);
      if(removed.length)await tx.query('INSERT INTO audit_events(task_id,operation,metadata) VALUES (NULL,$1,$2)',['BROWSER_SIGNED_OUT',JSON.stringify({userId:principal.user.id,remote:this.remote})]);
    });
    reply.clearCookie(this.name,{httpOnly:true,sameSite:'strict',secure:this.remote,path:'/'});
  }
  async live(principal:Principal):Promise<boolean> {
    const found=(await this.store.db.query('SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND s.version=u.session_version AND u.enabled=true AND u.registration_status=\'approved\'',[principal.sessionId]))[0];return !!found;
  }
}
