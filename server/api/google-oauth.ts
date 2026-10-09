import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Principal} from '../auth/policy.js';
import {AppError} from '../core/errors.js';
import type {Providers} from '../providers/index.js';
import type {GoogleOAuth} from '../providers/google-oauth.js';
import type {Store} from '../db/store.js';

export function registerGoogleOAuthRoutes(app:FastifyInstance,service:GoogleOAuth,providers:Providers,store:Store,principal:(request:FastifyRequest)=>Principal,owner:(request:FastifyRequest)=>Principal,live:(principal:Principal)=>Promise<boolean>,serialize:<T>(userId:string,work:()=>Promise<T>)=>Promise<T>) {
  const allowed=async(request:FastifyRequest)=>{const p=principal(request);if(!p.user.permissions.providers.includes('gemini'))throw new AppError('PROVIDER_DENIED','Gemini is not granted to your account.',403);if(!await live(p))throw new AppError('REVOKED','Your account session was revoked.',401);return p;};
  app.get('/api/admin/google-oauth',async request=>{owner(request);return service.configuration();});
  app.put('/api/admin/google-oauth',async request=>{const p=owner(request);if(!await live(p))throw new AppError('REVOKED','Your session was revoked.',401);await service.configure(request.body);providers.googleConfigurationChanged();await store.audit(null,'GOOGLE_APPLICATION_CONFIGURED',{userId:p.user.id});return service.configuration();});
  app.get('/api/providers/gemini/google',async request=>service.status((await allowed(request)).user.id));
  app.post('/api/providers/gemini/google/start',async request=>{const p=await allowed(request);const body=z.object({origin:z.string().max(300)}).strict().parse(request.body);if(request.headers.origin!==body.origin)throw new AppError('GOOGLE_ORIGIN','Sign-in must return to this browser origin.',400);return service.start(p,body.origin);});
  app.post('/api/providers/gemini/google/complete',async request=>{
    const p=await allowed(request),body=z.object({state:z.string().min(1).max(128),code:z.string().min(1).max(4096).optional(),error:z.string().max(128).optional()}).strict().parse(request.body);
    return serialize(p.user.id,async()=>{
    const gateway=await providers.forUser(p.user.id);gateway.credentialsChanged('gemini');
    try{await service.complete(p,body,()=>live(p));}
    catch(error){
      // HTTP 401 belongs to Relay authentication. An upstream Google rejection
      // must not make the browser discard its valid Relay session.
      if(error instanceof AppError&&error.status===401&&['GOOGLE_AUTH','GOOGLE_IDENTITY'].includes(error.code))throw new AppError(error.code,error.message,502);
      throw error;
    }
    // Google becomes the chosen Gemini credential; an old API key must not silently resume after disconnect.
    await gateway.secrets.remove('gemini');gateway.credentialsChanged('gemini');await store.audit(null,'GOOGLE_ACCOUNT_CONNECTED',{userId:p.user.id});return service.status(p.user.id);
    });
  });
  app.delete('/api/providers/gemini/google',async request=>{const p=await allowed(request);return serialize(p.user.id,async()=>{if(!await live(p))throw new AppError('REVOKED','Your account session was revoked.',401);const gateway=await providers.forUser(p.user.id);gateway.credentialsChanged('gemini');const result=await service.disconnect(p.user.id);gateway.credentialsChanged('gemini');await store.audit(null,'GOOGLE_ACCOUNT_DISCONNECTED',{userId:p.user.id,revocationConfirmed:result.revoked});return result;});});
}
