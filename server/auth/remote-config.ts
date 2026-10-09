import { z } from 'zod';
import { remoteConfig, type RemoteConfig } from './remote.js';
import type { Store } from '../db/store.js';

export const remoteSetupSchema=z.object({
  publicOrigin:z.string().trim().max(253),issuer:z.string().trim().max(253),audience:z.string().trim().min(1).max(512),registration:z.enum(['invited','approval']),
}).strict();

/** Persist only deployment identifiers. Tunnel tokens and OAuth secrets stay outside Relay. */
export function validateRemoteSetup(input:unknown):RemoteConfig {
  const setup=remoteSetupSchema.parse(input);
  return remoteConfig({RELAY_REMOTE_ENABLED:'1',RELAY_REMOTE_ORIGIN:setup.publicOrigin,RELAY_ACCESS_ISSUER:setup.issuer,RELAY_ACCESS_AUDIENCE:setup.audience,RELAY_REMOTE_REGISTRATION:setup.registration})!;
}
export async function savedRemoteSetup(store:Store):Promise<RemoteConfig|null>{
  const saved=(await store.db.query('SELECT value FROM settings WHERE key=$1',['remote_config']))[0]?.value;
  if(!saved)return null;
  return validateRemoteSetup(saved);
}
export async function resolveRemoteSetup(store:Store,env:NodeJS.ProcessEnv):Promise<RemoteConfig|null>{
  // An explicit environment setting, including 0, has precedence over UI configuration.
  return env.RELAY_REMOTE_ENABLED!==undefined?remoteConfig(env):savedRemoteSetup(store);
}
