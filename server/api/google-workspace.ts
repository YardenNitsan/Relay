import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Principal} from '../auth/policy.js';
import type {GoogleWorkspace,WorkspaceActor} from '../integrations/google-workspace.js';
import {AppError} from '../core/errors.js';
import {RateLimiter} from './boundary.js';

const limits=new WeakMap<GoogleWorkspace,RateLimiter>();
/** Register only inside createApp's authenticated Host/origin/CSRF boundary. */
export function registerGoogleWorkspaceRoutes(app:FastifyInstance,service:GoogleWorkspace,principal:(request:FastifyRequest)=>Principal,owner:(request:FastifyRequest)=>Principal,live:(principal:Principal)=>Promise<boolean>){
  let limiter=limits.get(service);if(!limiter){limiter=new RateLimiter();limits.set(service,limiter);}const rate=limiter;
  const actor=(request:FastifyRequest,limited=true):WorkspaceActor=>{const p=principal(request);if(limited)rate.check(p.user.id,20);return {principal:p,live:()=>live(p)};};
  app.get('/api/admin/google-workspace',async request=>{const p=owner(request);if(!await live(p))throw new AppError('WORKSPACE_REVOKED','Your Relay session is no longer authorized.',401);return service.configuration();});
  app.put('/api/admin/google-workspace',async request=>{owner(request);await service.configure(actor(request),request.body);return service.configuration();});
  app.get('/api/integrations/google-workspace',async request=>service.status(actor(request,false)));
  app.post('/api/integrations/google-workspace/start',async request=>{
    const body=request.body as {origin?:unknown}|undefined;
    if(!request.headers.origin||request.headers.origin!==body?.origin)throw new AppError('WORKSPACE_ORIGIN','Google sign-in must return to this browser origin.',400);
    return service.start(actor(request),request.body);
  });
  app.post('/api/integrations/google-workspace/complete',async request=>{const access=actor(request);await service.complete(access,request.body);return service.status(access);});
  app.delete('/api/integrations/google-workspace',async request=>service.disconnect(actor(request)));
  // POST keeps private queries, message IDs and calendar IDs out of request URLs.
  app.post('/api/integrations/google-workspace/mail/search',async request=>service.searchMail(actor(request),request.body));
  app.post('/api/integrations/google-workspace/mail/read',async request=>service.readMail(actor(request),request.body));
  app.post('/api/integrations/google-workspace/calendar/events',async request=>service.listEvents(actor(request),request.body));
  app.post('/api/integrations/google-workspace/calendar/freebusy',async request=>service.freeBusy(actor(request),request.body));
}
