import type {MemoryWatch,MemoryWatchFactory} from '../hardware/watchdog.js';
import { randomUUID } from 'node:crypto';
import type { ModelChunk, ModelProfile, ProviderGateway } from '../../shared/types.js';
import { AppError, checkSignal } from '../core/errors.js';
import type { Store } from '../db/store.js';
import { LocalLease } from '../orchestration/lease.js';
import { hardwareAdmission, type Admit } from '../orchestration/router.js';
import { InferenceTokens, type InferenceIdentity } from './tokens.js';
import type { ParsedInferenceRequest } from './protocols.js';

/** This service deliberately has no tool broker, conversation repository or prompt logger. */
export class InferenceService {
  readonly tokens:InferenceTokens;
  private active=new Map<string,{identity:InferenceIdentity;controller:AbortController;settled:Promise<void>}>();
  private closed=false;
  constructor(private store:Store,private gateway:ProviderGateway,private lease:LocalLease,private stopped:()=>boolean,private admit:Admit=hardwareAdmission,private watchMemory?:MemoryWatchFactory){this.tokens=new InferenceTokens(store);}
  async models(identity:InferenceIdentity):Promise<ModelProfile[]>{
    if(!await this.tokens.live(identity))throw new AppError('INFERENCE_DENIED','External model access was revoked.',403);
    const gateway=this.gateway.forUser?await this.gateway.forUser(identity.user.id):this.gateway;
    return (await gateway.listModels()).filter(model=>model.local&&identity.user.permissions.providers.includes(model.provider)&&!['offline','error'].includes(model.state));
  }
  cancelUser(userId:string){for(const active of this.active.values())if(active.identity.user.id===userId)active.controller.abort('revoked');}
  cancelToken(tokenId:string){for(const active of this.active.values())if(active.identity.tokenId===tokenId)active.controller.abort('revoked');}
  stopAll(){for(const active of this.active.values())active.controller.abort('emergency_stop');}
  async shutdown(){this.closed=true;this.stopAll();await Promise.all([...this.active.values()].map(active=>active.settled));}
  async failed(id:string){await this.store.db.query("UPDATE inference_requests SET status='failed',finished_at=now() WHERE id=$1 AND status<>'cancelled'",[id]);}
  stream(identity:InferenceIdentity,request:ParsedInferenceRequest,clientSignal:AbortSignal,id=randomUUID(),boundary?:{expiresAt:number;enabled:()=>boolean},cancelConsumer?:()=>void):AsyncGenerator<ModelChunk>{
    const source=this.run(identity,request,clientSignal,id,boundary,()=>{
      // A consumer may be paused at yield indefinitely. Closing the iterator
      // releases its lease even when that consumer never asks for another chunk.
      void source.return(undefined).catch(()=>undefined);
      cancelConsumer?.();
    });
    return source;
  }
  private async *run(identity:InferenceIdentity,request:ParsedInferenceRequest,clientSignal:AbortSignal,id:string,boundary:{expiresAt:number;enabled:()=>boolean}|undefined,cancel:()=>void):AsyncGenerator<ModelChunk>{
    if(this.closed||this.stopped())throw new AppError('STOPPED','The host owner stopped model execution.',409);
    if(this.active.size>=4||[...this.active.values()].some(item=>item.identity.user.id===identity.user.id))throw new AppError('INFERENCE_BUSY','One external request per account and four total may be queued or running.',429);
    const controller=new AbortController();
    const remaining=Math.min(Math.min(300,identity.user.permissions.maxSecondsPerTask)*1000,identity.expiresAt-Date.now(),boundary?boundary.expiresAt-Date.now():Infinity);
    const signal=AbortSignal.any([controller.signal,clientSignal,AbortSignal.timeout(Math.max(0,Math.floor(remaining)))]);
    let settle!:()=>void;const settled=new Promise<void>(resolve=>{settle=resolve;});
    this.active.set(id,{identity,controller,settled});
    let release:(()=>void)|undefined,recorded=false,completed=false,drained=false,inputTokens:number|null=null,outputTokens:number|null=null;
    let memoryWatch:MemoryWatch|undefined;
    let checking=false;
    const watchdog=setInterval(()=>{if(checking)return;checking=true;void this.tokens.live(identity).then(live=>{if(!live||this.stopped()||boundary&&!boundary.enabled())controller.abort('revoked');},()=>controller.abort('authorization_unavailable')).finally(()=>{checking=false;});},1000);watchdog.unref();
    signal.addEventListener('abort',cancel,{once:true});
    try {
      checkSignal(signal);
      if(boundary&&!boundary.enabled())throw new AppError('REMOTE_DISABLED','Remote access is disabled.',403);
      const model=(await this.models(identity)).find(item=>item.id===request.modelId);
      if(!model)throw new AppError('MODEL_NOT_FOUND','Choose a currently available local model from /v1/models.',404);
      if(request.tools.length&&!model.capabilities.tools)throw new AppError('TOOLS_UNSUPPORTED','This model does not advertise function tool support.',400);
      // UTF-8 bytes conservatively bound text tokens. No silent context truncation.
      const contextTokens=Math.max(2048,Buffer.byteLength(JSON.stringify({messages:request.messages,tools:request.tools}))+request.maxOutputTokens+1024);
      if(contextTokens>32768||model.contextWindow!==null&&contextTokens>model.contextWindow)throw new AppError('CONTEXT_LIMIT','The full request exceeds this gateway or model context limit. Reduce client history.',413);
      await this.store.db.transaction(async tx=>{
        const user=(await tx.query('SELECT enabled,session_version FROM users WHERE id=$1 FOR UPDATE',[identity.user.id]))[0];
        if(!user?.enabled||user.session_version!==identity.user.sessionVersion)throw new AppError('INFERENCE_DENIED','Account access was revoked.',403);
        const count=(await tx.query("SELECT count(*) AS count FROM inference_requests WHERE user_id=$1 AND created_at>now()-interval '1 day'",[identity.user.id]))[0];
        if(Number(count.count)>=500)throw new AppError('INFERENCE_DAILY_LIMIT','The daily external inference limit of 500 requests was reached.',429);
        await tx.query('INSERT INTO inference_requests(id,user_id,token_id,model_id,status) VALUES ($1,$2,$3,$4,$5)',[id,identity.user.id,identity.tokenId,model.id,'queued']);
      });recorded=true;
      release=await this.lease.acquire(signal);
      checkSignal(signal);
      if(this.stopped()||boundary&&!boundary.enabled()||!await this.tokens.live(identity))throw new AppError('INFERENCE_DENIED','Execution permission was revoked while queued.',403);
      const admission=await this.admit(model,contextTokens);
      if(!admission.allowed)throw new AppError('RESOURCE_LIMIT',admission.reasons.join('; '),409);
      checkSignal(signal);
      await this.store.db.query("UPDATE inference_requests SET status='running' WHERE id=$1",[id]);
      await this.store.db.query('UPDATE inference_tokens SET last_used_at=now() WHERE id=$1',[identity.tokenId]);
      const gateway=this.gateway.forUser?await this.gateway.forUser(identity.user.id):this.gateway;
      memoryWatch=this.watchMemory?.(signal,admission.execution);
      memoryWatch?.signal.addEventListener('abort',cancel,{once:true});
      let bytes=0;
      for await(const chunk of gateway.stream({model,messages:request.messages,tools:request.tools,contextTokens,maxOutputTokens:request.maxOutputTokens,signal:memoryWatch?.signal??signal,execution:admission.execution})){
        checkSignal(memoryWatch?.signal??signal);
        bytes+=Buffer.byteLength(JSON.stringify(chunk));if(bytes>2*1024*1024)throw new AppError('OUTPUT_LIMIT','Model output exceeded the response limit.',413);
        if(chunk.type==='usage'){inputTokens=chunk.inputTokens;outputTokens=chunk.outputTokens;}
        if(chunk.type==='done')completed=true;
        yield chunk;
      }
      if(!completed)throw new AppError('INFERENCE_INTERRUPTED','The model stream ended without a completion receipt.',502);
      drained=true;
    } catch(error){throw memoryWatch?.error()??error;} finally {
      memoryWatch?.signal.removeEventListener('abort',cancel);memoryWatch?.stop();
      signal.removeEventListener('abort',cancel);clearInterval(watchdog);release?.();
      try{if(recorded)await this.store.db.query('UPDATE inference_requests SET status=$1,input_tokens=$2,output_tokens=$3,finished_at=now() WHERE id=$4',[signal.aborted?'cancelled':drained?'completed':'failed',inputTokens,outputTokens,id]);}
      finally{this.active.delete(id);settle();}
    }
  }
}
