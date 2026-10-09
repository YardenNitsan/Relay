import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError } from '../core/errors.js';
import { installBoundary, RateLimiter } from '../api/boundary.js';
import { encodeInferenceError, encodeInferenceResponse, encodeInferenceStream, parseInferenceRequest } from './protocols.js';
import type { InferenceService } from './service.js';
import type { InferenceIdentity } from './tokens.js';

export function registerInferenceRoutes(app:FastifyInstance,service:InferenceService,gatewayContext?:(request:FastifyRequest)=>{expiresAt:number;enabled:()=>boolean}|undefined){
  const limiter=new RateLimiter();
  const authenticate=async(request:FastifyRequest):Promise<InferenceIdentity>=>{
    limiter.check('gateway',600);
    if(request.headers.origin||request.headers['sec-fetch-site'])throw new AppError('INFERENCE_CLIENT_ONLY','This endpoint accepts native API clients, not browser scripts.',403);
    if(request.url.includes('?')&&request.url!=='/v1/messages?beta=true')throw new AppError('INFERENCE_QUERY','Only the Anthropic beta=true flag is accepted in query strings.',400);
    const authorization=request.headers.authorization,key=request.headers['x-api-key'];
    const token=authorization?.startsWith('Bearer ')?authorization.slice(7):typeof key==='string'?key:undefined;
    const identity=await service.tokens.authenticate(token);limiter.check(identity.user.id,60);return identity;
  };
  app.get('/v1/models',async(request,reply)=>{reply.header('Cache-Control','no-store');const identity=await authenticate(request);return {object:'list',data:(await service.models(identity)).map(model=>({id:model.id,object:'model',created:0,owned_by:'relay-host'}))};});
  for(const [path,protocol] of [['responses','responses'],['chat/completions','chat-completions'],['messages','anthropic-messages']] as const){
    app.post(`/v1/${path}`,async(request,reply)=>{
      const id=randomUUID();let controller:AbortController|undefined;let cleanup=()=>{};
      try {
        const user=await authenticate(request),parsed=parseInferenceRequest(protocol,request.body);
        controller=new AbortController();const cancel=()=>controller!.abort('client_disconnected');request.raw.once('aborted',cancel);reply.raw.once('close',cancel);
        let cancelDeadline:ReturnType<typeof setTimeout>|undefined;
        cleanup=()=>{clearTimeout(cancelDeadline);request.raw.off('aborted',cancel);reply.raw.off('close',cancel);};
        const cancelConsumer=()=>{
          // Permit a readable client to receive the normal error envelope, but
          // never wait indefinitely for a stopped reader to drain its socket.
          cancelDeadline=setTimeout(()=>controller!.abort('service_cancelled'),100);cancelDeadline.unref();
        };
        const identity={id,model:parsed.modelId,createdAt:Math.floor(Date.now()/1000)};
        const source=service.stream(user,parsed,controller.signal,id,gatewayContext?.(request),cancelConsumer);
        const initial=await source.next();
        const chunks=(async function*(){try{if(!initial.done)yield initial.value;for await(const chunk of source)yield chunk;}finally{await source.return(undefined);}})();
        reply.header('Cache-Control','no-store').header('X-Accel-Buffering','no');
        if(!parsed.stream){try{return await encodeInferenceResponse(parsed,identity,chunks);}finally{cleanup();}}
        const encoded=encodeInferenceStream(parsed,identity,chunks);
        // Start validation before committing a successful HTTP status.
        const first=await encoded.next();
        const stream=async function*(){
          try{if(!first.done)yield first.value;for await(const frame of encoded)yield frame;}
          catch(error){await service.failed(id);const envelope=encodeInferenceError(protocol,error);yield `${protocol==='chat-completions'?'':'event: error\n'}data: ${JSON.stringify(protocol==='responses'?{...(envelope.error as object),type:'error'}:envelope)}\n\n`;}
          finally{await encoded.return(undefined);cleanup();}
        };
        return reply.type('text/event-stream; charset=utf-8').send(Readable.from(stream(),{signal:controller.signal}));
      } catch(error){
        controller?.abort('request_failed');cleanup();await service.failed(id);
        const status=error instanceof AppError?error.status:502;
        return reply.code(status).send(encodeInferenceError(protocol,error));
      }
    });
  }
}

/** Inference-only listener: never mount the owner/browser APIs here. */
export async function createInferenceApp(service:InferenceService,options:{origin?:string;port?:number;verifyGateway?:(request:FastifyRequest)=>Promise<{expiresAt:number}>;gatewayEnabled?:()=>boolean}={}){
  const port=options.port??4315;
  const app=Fastify({logger:false,bodyLimit:1024*1024,requestTimeout:15000,connectionTimeout:10000});
  installBoundary(app,options.origin?[options.origin]:[`http://127.0.0.1:${port}`,`http://localhost:${port}`],!!options.origin);
  const identities=new WeakMap<FastifyRequest,{expiresAt:number;enabled:()=>boolean}>();const admission=new RateLimiter();
  if(options.verifyGateway)app.addHook('onRequest',async request=>{admission.check('remote',600);if(options.gatewayEnabled&&!options.gatewayEnabled())throw new AppError('REMOTE_DISABLED','Remote access is disabled.',403);identities.set(request,{...await options.verifyGateway!(request),enabled:options.gatewayEnabled??(()=>true)});});
  app.setErrorHandler((error,_request,reply)=>{reply.code(error instanceof AppError?error.status:400).send(encodeInferenceError('responses',error));});
  registerInferenceRoutes(app,service,request=>identities.get(request));return app;
}
