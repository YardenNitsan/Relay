import {z} from 'zod';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Principal} from '../auth/policy.js';
import type {Store} from '../db/store.js';
import {MemoryRepository,memoryCreateSchema,memoryUpdateSchema} from '../memory/repository.js';

/** Registered behind the host's normal session, origin, CSRF and rate boundaries. */
export function registerMemoryRoutes(app:FastifyInstance,store:Store,principal:(request:FastifyRequest)=>Principal):void{
  const memory=new MemoryRepository(store.db);
  const id=(request:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(request.params).id;
  app.get('/api/memory',async request=>memory.list(principal(request)));
  app.get('/api/memory/export',async request=>memory.export(principal(request)));
  app.get('/api/memory/:id',async request=>memory.get(principal(request),id(request)));
  app.post('/api/memory',async request=>{
    const {confirm:_,...input}=memoryCreateSchema.extend({confirm:z.literal(true)}).strict().parse(request.body);
    return memory.create(principal(request),input);
  });
  app.put('/api/memory/:id',async request=>{
    const {confirm:_,...input}=memoryUpdateSchema.extend({confirm:z.literal(true)}).strict().parse(request.body);
    return memory.update(principal(request),id(request),input);
  });
  app.delete('/api/memory/:id',async request=>{
    const input=z.object({revision:z.number().int().positive()}).strict().parse(request.body);
    await memory.delete(principal(request),id(request),input.revision);return {deleted:true};
  });
}
