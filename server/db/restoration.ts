import type {Store} from './store.js';
import type {Principal} from '../auth/policy.js';
import {authorizeOwner} from '../auth/policy.js';
import {AppError} from '../core/errors.js';

export async function restorationPending(store:Store):Promise<boolean>{return (await store.db.query("SELECT value FROM settings WHERE key='restoration_pending'"))[0]?.value===true;}
export async function assertRestorationReviewed(store:Store):Promise<void>{
  if(await restorationPending(store))throw new AppError('RESTORATION_REVIEW','Review restored data in Machine before enabling task execution.',409);
}
export async function reviewRestoration(store:Store,principal:Principal):Promise<void>{
  authorizeOwner(principal);
  await store.db.transaction(async tx=>{
    const user=(await tx.query('SELECT enabled,role,session_version FROM users WHERE id=$1 FOR UPDATE',[principal.user.id]))[0];
    if(!user||user.enabled!==true||user.role!=='owner'||Number(user.session_version)!==principal.user.sessionVersion)throw new AppError('SESSION_REVOKED','Owner authorization changed.',401);
    await tx.query("UPDATE settings SET value='false' WHERE key='restoration_pending'");
    await tx.query("INSERT INTO audit_events(operation,metadata) VALUES ('RESTORATION_REVIEWED',$1)",[JSON.stringify({userId:principal.user.id,remoteListenersRequireRestart:true})]);
  });
}
