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
    if(!user.enabled||session.version!==user.sessionVersion||session.remote!==this.remote||externalUserId&&externalUserId!==user.id)throw new AppError('SESSION_REVOKED','This session is no longer authorized',401);
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers['x-relay-csrf']!==session.csrfToken)throw new AppError('CSRF','The request has no valid session CSRF token',403);
    return {user,remote:this.remote,sessionId:session.id};
  }
  async open(request:FastifyRequest,reply:FastifyReply,userId='owner',authenticated=false) {
    const user=await this.user(userId);
    if(!user.enabled)throw new AppError('USER_DISABLED','This account is disabled',403);
    // Reuse a valid cookie so opening another tab does not invalidate the first.
    let principal:Principal|undefined;
    try {principal=await this.principal(request,userId);}catch{/* rotate expired/invalid sessions */}
    if(principal) {
      const record=(await this.store.db.query('SELECT csrf_token FROM sessions WHERE id=$1',[principal.sessionId]))[0];
      return {csrfToken:record.csrf_token,user,remote:this.remote};
    }
    if(!authenticated)throw new AppError('PAIRING_REQUIRED','Pair this browser with the local host to continue.',401);
    await this.store.db.query('DELETE FROM sessions WHERE expires_at<now()');
    const token=randomBytes(32).toString('base64url');const csrf=randomBytes(32).toString('base64url');
    const expires=new Date(Date.now()+(this.remote?60*60:12*60*60)*1000);
    await this.store.db.query('INSERT INTO sessions(id,user_id,csrf_token,remote,user_agent,version,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[hash(token),userId,csrf,this.remote,(request.headers['user-agent']??'Unknown client').slice(0,240),user.sessionVersion,expires.toISOString()]);
    reply.setCookie(this.name,token,{httpOnly:true,sameSite:'strict',secure:this.remote,path:'/',expires});
    await this.store.db.query('UPDATE users SET last_active_at=now() WHERE id=$1',[userId]);
    return {csrfToken:csrf,user,remote:this.remote};
  }
  async live(principal:Principal):Promise<boolean> {
    const found=(await this.store.db.query('SELECT s.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now() AND s.version=u.session_version AND u.enabled=true',[principal.sessionId]))[0];return !!found;
  }
}
