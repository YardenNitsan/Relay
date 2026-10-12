import {createHmac,randomBytes} from 'node:crypto';
import type {Principal} from '../auth/policy.js';
import {AppError} from '../core/errors.js';

const epochs=new WeakMap<object,Buffer>();
/** A replay namespace, never an authorization token. Both listeners sharing a
 * Store share its epoch; restarting/replacing the Store changes that epoch. */
export function activityReplayScope(store:object,principal:Principal):string {
  let epoch=epochs.get(store);if(!epoch){epoch=randomBytes(32);epochs.set(store,epoch);}
  return createHmac('sha256',epoch).update(JSON.stringify([principal.user.id,principal.sessionId,principal.user.sessionVersion,principal.remote])).digest('hex');
}
export function activityReplayCursor(expectedScope:string,scope:string|undefined,after:number,lastEventId:unknown,head:number):number {
  if(!Number.isSafeInteger(head)||head<0)throw new AppError('ACTIVITY_CURSOR','Activity history cursor is invalid.',503);
  const header=typeof lastEventId==='string'&&/^\d+$/.test(lastEventId)?Number(lastEventId):0;
  const cursor=Math.max(Number.isSafeInteger(after)&&after>=0?after:0,Number.isSafeInteger(header)?header:0);
  return scope===expectedScope&&cursor<=head?cursor:0;
}
