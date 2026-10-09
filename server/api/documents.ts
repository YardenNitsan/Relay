import {randomUUID} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import type {Principal} from '../auth/policy.js';
import type {Store} from '../db/store.js';
import type {Engine} from '../orchestration/engine.js';
import type {ToolBroker} from '../tools/index.js';
import {AppError} from '../core/errors.js';
import {parseDocument,documentLimits} from '../documents/ingest.js';
import {RateLimiter,routeId} from './boundary.js';

// Bound buffered upload memory across local, LAN and public listeners, before parsing JSON.
const uploads=new WeakMap<Store,FastifyRequest>();
const limits=new WeakMap<Store,RateLimiter>();
export function documentRoutes(app:FastifyInstance,store:Store,engine:Engine,broker:ToolBroker,principal:(request:FastifyRequest)=>Principal,access:(p:Principal,id:string,write:boolean)=>Promise<unknown>) {
  const release=(request:FastifyRequest)=>{if(uploads.get(store)===request)uploads.delete(store);};
  app.post('/api/workspaces/:id/documents',{
    bodyLimit:12*1024*1024,
    onRequest:async(request)=>{
      const p=principal(request);await access(p,routeId(request),true);
      let limiter=limits.get(store);if(!limiter){limiter=new RateLimiter();limits.set(store,limiter);}limiter.check(p.user.id,12);
      if(uploads.has(store))throw new AppError('DOCUMENT_BUSY','Another document is being imported. Wait and retry.',409);
      uploads.set(store,request);request.raw.once('aborted',()=>release(request));
    },
    onResponse:async request=>release(request),
    onError:async request=>release(request),
  },async(request,reply)=>{
    const p=principal(request),id=routeId(request);
    const body=z.object({name:z.string().trim().min(1).max(180).regex(/^[^\\/\x00-\x1f\x7f]+$/),contentBase64:z.string().min(1).max(Math.ceil(documentLimits.inputBytes/3)*4)}).strict().parse(request.body);
    const bytes=Buffer.from(body.contentBase64,'base64');
    if(bytes.toString('base64')!==body.contentBase64)throw new AppError('DOCUMENT_INVALID','Document encoding is invalid.',400);
    const controller=new AbortController(),cancel=()=>{if(!reply.raw.writableEnded)controller.abort();};
    request.raw.once('aborted',cancel);reply.raw.once('close',cancel);
    try{
      const parsed=await parseDocument(body.name,bytes,controller.signal);controller.signal.throwIfAborted();
      const path=`attachments/${randomUUID()}/${body.name}.txt`;
      await engine.mutateWorkspace(id,()=>broker.upload(id,path,parsed.text,async()=>{controller.signal.throwIfAborted();await access(p,id,true);}));
      await store.audit(null,'DOCUMENT_IMPORTED',{workspaceId:id,path,format:parsed.format,userId:p.user.id});
      return {uploaded:true,path,format:parsed.format,originalStored:false};
    }finally{request.raw.removeListener('aborted',cancel);reply.raw.removeListener('close',cancel);release(request);}
  });
}
