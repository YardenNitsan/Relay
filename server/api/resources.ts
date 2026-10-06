import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Store } from '../db/store.js';
import { getResourcePolicy, saveResourcePolicy } from '../hardware/config.js';
import { resourcePolicyBounds, resourceProfiles } from '../hardware/policy.js';
import type { Providers } from '../providers/index.js';

export function resourceRoutes(app:FastifyInstance,store:Store,providers:Providers,owner:(request:FastifyRequest)=>unknown) {
  const state=async()=>({policy:await getResourcePolicy(store),profiles:resourceProfiles(),bounds:resourcePolicyBounds});
  app.get('/api/hardware/policy',async request=>{owner(request);return state();});
  app.post('/api/hardware/policy',async request=>{owner(request);await saveResourcePolicy(store,request.body);return state();});
  app.get('/api/models/resident',async request=>{owner(request);return providers.residentModels();});
}
