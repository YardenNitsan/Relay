import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../core/errors.js';
import { row, type Store } from '../db/store.js';
import type { User } from '../auth/policy.js';

const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
export interface InferenceIdentity {tokenId:string;user:User;expiresAt:number;}
export const tokenOptions=z.object({label:z.string().trim().min(1).max(80),expiresInDays:z.number().int().min(1).max(90)}).strict();
export function canUseInference(user:User):boolean {return user.enabled&&user.registrationStatus!=='pending'&&user.registrationStatus!=='denied'&&(user.role==='owner'||user.permissions.externalModelAccess===true);}
export class InferenceTokens {
  constructor(private store:Store){}
  async list(userId:string){return (await this.store.db.query('SELECT id,label,created_at,expires_at,last_used_at FROM inference_tokens WHERE user_id=$1 AND expires_at>now() AND session_version=(SELECT session_version FROM users WHERE id=$1) ORDER BY created_at DESC',[userId])).map(item=>row(item));}
  async issue(userId:string,options:unknown,expectedVersion:number){
    const {label,expiresInDays}=tokenOptions.parse(options);
    return this.store.db.transaction(async tx=>{
      const record=(await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[userId]))[0];
      const user=record?row<User>(record):null;
      if(!user||!canUseInference(user)||user.sessionVersion!==expectedVersion)throw new AppError('INFERENCE_DENIED','External model access is not granted to this account.',403);
      await tx.query('DELETE FROM inference_tokens WHERE user_id=$1 AND (expires_at<=now() OR session_version<>$2)',[userId,user.sessionVersion]);
      if((await tx.query('SELECT id FROM inference_tokens WHERE user_id=$1',[userId])).length>=8)throw new AppError('TOKEN_LIMIT','Revoke an existing token before creating another.',429);
      const id=randomUUID(),token=`relay_${randomBytes(32).toString('base64url')}`,expiresAt=new Date(Date.now()+expiresInDays*86400000).toISOString();
      await tx.query('INSERT INTO inference_tokens(id,user_id,token_hash,label,session_version,expires_at) VALUES ($1,$2,$3,$4,$5,$6)',[id,userId,digest(token),label,user.sessionVersion,expiresAt]);
      await tx.query('INSERT INTO audit_events(operation,metadata) VALUES ($1,$2)',['INFERENCE_TOKEN_CREATED',JSON.stringify({userId,tokenId:id,expiresAt})]);
      return {id,token,expiresAt};
    });
  }
  async authenticate(token:string|undefined):Promise<InferenceIdentity>{
    if(!token||!/^relay_[A-Za-z0-9_-]{43}$/.test(token))throw new AppError('INFERENCE_AUTH','A valid Relay inference token is required.',401);
    const record=(await this.store.db.query('SELECT t.id AS token_id,t.session_version AS token_version,t.expires_at AS token_expiry,u.* FROM inference_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.expires_at>now()',[digest(token)]))[0];
    if(!record)throw new AppError('INFERENCE_AUTH','The inference token is invalid, expired or revoked.',401);
    const user=row<User>(record);
    if(!canUseInference(user)||record.token_version!==user.sessionVersion)throw new AppError('INFERENCE_DENIED','External model access was revoked.',403);
    return {tokenId:String(record.token_id),user,expiresAt:new Date(String(record.token_expiry)).getTime()};
  }
  async live(identity:InferenceIdentity):Promise<boolean>{
    const record=(await this.store.db.query('SELECT u.* FROM inference_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=$1 AND t.user_id=$2 AND t.expires_at>now() AND t.session_version=u.session_version',[identity.tokenId,identity.user.id]))[0];
    return !!record&&canUseInference(row<User>(record))&&Number(record.session_version)===identity.user.sessionVersion;
  }
  async revoke(userId:string,id:string){
    await this.store.db.query('DELETE FROM inference_tokens WHERE id=$1 AND user_id=$2',[id,userId]);
    await this.store.audit(null,'INFERENCE_TOKEN_REVOKED',{userId,tokenId:id});
  }
}
