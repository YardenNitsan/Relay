import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Principal} from '../auth/policy';
import type {Store} from '../db/store';
import type {Engine} from '../orchestration/engine';
import {PublicationService} from '../tools/publication';

const services=new WeakMap<Store,PublicationService>();
export function registerPublicationRoutes(app:FastifyInstance,store:Store,dataDirectory:string,engine:Engine,owner:(request:FastifyRequest)=>Principal):void{
  let service=services.get(store);if(!service){service=new PublicationService(store,dataDirectory,(id,operation)=>engine.mutateOriginalProject(id,operation));services.set(store,service);}const publication=service;
  const id=(request:FastifyRequest)=>z.object({id:z.string().uuid()}).parse(request.params).id;
  app.get('/api/workspaces/:id/publications',async request=>publication.list(owner(request),id(request)));
  app.post('/api/workspaces/:id/publications/preview',async request=>{const actor=owner(request);z.object({}).strict().parse(request.body??{});return publication.preview(actor,id(request));});
  app.get('/api/publications/:id',async request=>publication.get(owner(request),id(request)));
  app.post('/api/publications/:id/apply',async(request,reply)=>{
    const actor=owner(request),publicationId=id(request),controller=new AbortController(),socket=request.raw.socket,previousTimeout=socket.timeout??0;
    // Only an authenticated publication receives this bounded socket allowance.
    socket.setTimeout?.(65_000);const timer=setTimeout(()=>controller.abort('publication_deadline'),60_000);timer.unref();
    const disconnected=()=>{if(!reply.raw.writableFinished)controller.abort('client_disconnected');};reply.raw.on('close',disconnected);
    try{return await publication.apply(actor,publicationId,request.body,controller.signal);}
    finally{clearTimeout(timer);reply.raw.off('close',disconnected);if(!socket.destroyed)socket.setTimeout?.(previousTimeout);}
  });
  app.post('/api/publications/:id/rollback-preview',async request=>{const actor=owner(request);z.object({}).strict().parse(request.body??{});return publication.rollbackPreview(actor,id(request));});
  app.post('/api/publications/:id/reconcile',async request=>publication.reconcile(owner(request),id(request),request.body));
}
