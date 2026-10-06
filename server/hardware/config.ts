import { event, type Store } from '../db/store.js';
import { resourcePolicySchema, type ResourcePolicyConfig } from './policy.js';

/** Host-wide owner policy. Read at each admission; never accept a remote task override. */
export async function getResourcePolicy(store: Store): Promise<ResourcePolicyConfig> {
  const setting = (await store.db.query('SELECT value FROM settings WHERE key=$1', ['resource_policy']))[0];
  return resourcePolicySchema.parse(setting ? setting.value : { profile: 'safe' });
}

/** Trusted server entry point: the API must authorize the local owner before calling. */
export async function saveResourcePolicy(store: Store, value: unknown): Promise<ResourcePolicyConfig> {
  const policy = resourcePolicySchema.parse(value);
  await store.db.transaction(async tx => {
    await tx.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value', ['resource_policy', JSON.stringify(policy)]);
    await event(tx, null, 'RESOURCE_POLICY_CHANGED', { policy });
  });
  return policy;
}
