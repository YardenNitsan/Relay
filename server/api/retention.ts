import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Principal} from '../auth/policy.js';
import type {Store} from '../db/store.js';
import {RetentionService} from '../db/retention.js';
import {restorationPending,reviewRestoration} from '../db/restoration.js';

// A service belongs to the host Store so each listener shares one bounded set of
// previews; authorization still excludes LAN and remote owner sessions.
const services=new WeakMap<Store,RetentionService>();
export function retentionRoutes(app:FastifyInstance,store:Store,owner:(request:FastifyRequest)=>Principal){
  let service=services.get(store);
  if(!service){service=new RetentionService(store.db);services.set(store,service);}
  const retention=service;
  app.get('/api/admin/restoration',async request=>{owner(request);return {pending:await restorationPending(store)};});
  app.post('/api/admin/restoration/review',async request=>{
    const principal=owner(request);
    z.object({confirm:z.literal(true)}).strict().parse(request.body);
    await reviewRestoration(store,principal);
    return {pending:false,stopped:(await store.control()).stopped,remoteListenersRequireRestart:true};
  });
  app.post('/api/admin/retention/preview',async request=>{
    const {user}=owner(request);
    return retention.preview({id:user.id,sessionVersion:user.sessionVersion},request.body);
  });
  app.post('/api/admin/retention/apply',async request=>{
    const {user}=owner(request);
    const input=z.object({token:z.string().max(100),confirm:z.literal(true)}).strict().parse(request.body);
    return retention.apply({id:user.id,sessionVersion:user.sessionVersion},input.token);
  });
}
