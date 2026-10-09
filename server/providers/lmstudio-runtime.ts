import {randomUUID} from 'node:crypto';
import type {EstimatedResourcesUsage,LLMLoadModelConfig,LMStudioClient} from '@lmstudio/sdk';
import type {Admission,HardwareSnapshot,ModelProfile,ModelRequest} from '../../shared/types.js';
import {getHardware} from '../hardware/index.js';
import {unsafeMemory} from '../hardware/watchdog.js';
import {reserveBytes,resolveResourcePolicy,resourcePolicyReason,type ResourcePolicyConfig} from '../hardware/policy.js';
import {ProviderError} from './transport.js';

const GiB=1024**3;
/** The same explicit configuration is used for estimation and loading. No remote LM Link fallback. */
export function lmStudioLoadConfig(contextLength:number,gpuOffload:number):LLMLoadModelConfig {
  return {contextLength,gpu:{ratio:gpuOffload},maxParallelPredictions:1,evalBatchSize:128,flashAttention:true,offloadKVCacheToGpu:gpuOffload>0,gpuStrictVramCap:true,useFp16ForKVCache:true,tryMmap:true,keepModelInMemory:false,speculativeDraftMtp:false,speculativeDraftSimple:false};
}

export function assessLmStudioEstimate(model:ModelProfile,hardware:HardwareSnapshot,contextTokens:number,gpuOffload:number,estimate:EstimatedResourcesUsage,config?:ResourcePolicyConfig):Admission {
  const policy=resolveResourcePolicy(config);
  const result:Admission={allowed:false,decision:'queue',reasons:[resourcePolicyReason(policy)],estimatedRamBytes:null,estimatedVramBytes:null,contextTokens,confidence:'unknown'};
  const deny=(reason:string):Admission=>({...result,reasons:[...result.reasons,reason]});
  if(!Number.isSafeInteger(contextTokens)||contextTokens<1||model.contextWindow!==null&&contextTokens>model.contextWindow)return deny('Requested context is outside the discovered model limit.');
  const age=Date.now()-Date.parse(hardware.sampledAt);
  if(!Number.isFinite(age)||age>15000||age< -5000)return deny('Fresh hardware telemetry is required.');
  const memory=estimate.memory;
  if(!estimate.passesGuardrails||memory.confidence!=='high')return deny('LM Studio cannot confidently admit this configuration under its runtime guardrails.');
  if(![memory.modelBytes,memory.contextBytes,memory.totalBytes,memory.modelVramBytes,memory.contextVramBytes,memory.totalVramBytes].every(n=>Number.isFinite(n)&&n>=0)||memory.totalBytes<=0||memory.totalBytes<memory.modelBytes+memory.contextBytes-1||memory.totalVramBytes<memory.modelVramBytes+memory.contextVramBytes-1||memory.totalVramBytes>memory.totalBytes)return deny('LM Studio returned an invalid memory estimate.');
  const {totalBytes,availableBytes,swapUsedBytes}=hardware.memory;
  if(!Number.isFinite(totalBytes)||totalBytes<=0||!Number.isFinite(availableBytes)||availableBytes<0||availableBytes>totalBytes)return deny('Physical memory availability is unknown.');
  // Native total includes GPU allocations. Count shared memory once; on discrete
  // hosts subtract GPU allocation from RAM, then add explicit staging/compute buffers.
  // mmap is enabled and mlock disabled so mapped weights remain reclaimable.
  const total=Math.max(memory.totalBytes,model.sizeBytes??0);
  const shared=hardware.memoryArchitecture==='unified';
  const ram=Math.ceil((shared?total:Math.max(0,total-memory.totalVramBytes))+Math.max(GiB,total*.15)+GiB/2),vram=memory.totalVramBytes>0?Math.ceil(memory.totalVramBytes*1.15+GiB/2):0;
  result.estimatedRamBytes=ram;result.estimatedVramBytes=vram;result.confidence='estimated';
  if(availableBytes-reserveBytes(totalBytes,policy.ramReserveGiB,policy.ramReservePercent)<ram)return deny('Insufficient physical RAM for runtime estimate, load buffers and safety headroom.');
  if(swapUsedBytes!==null&&swapUsedBytes>totalBytes*.25)return deny('Swap/pagefile pressure is unsafe.');
  if(hardware.memoryArchitecture==='unknown')return deny('GPU inventory is unavailable.');
  if(gpuOffload===0&&vram!==0)return deny('Runtime did not estimate CPU-only execution.');
  if(hardware.memoryArchitecture==='unified')result.estimatedVramBytes=null;
  else if(gpuOffload>0){
    const dedicated=hardware.gpus.filter(g=>!g.memoryShared);
    if(!dedicated.length)return deny('No measured dedicated GPU is available for this configuration.');
    if(!dedicated.every(g=>g.totalBytes!==null&&g.usedBytes!==null&&Number.isFinite(g.totalBytes)&&Number.isFinite(g.usedBytes)&&g.usedBytes>=0&&g.totalBytes>0&&g.usedBytes<=g.totalBytes&&g.totalBytes-g.usedBytes-reserveBytes(g.totalBytes,policy.vramReserveGiB,policy.vramReservePercent)>=vram))return deny('Insufficient measured GPU memory after runtime buffers and safety reserve.');
  }
  return {...result,allowed:true,decision:'run',execution:{numGpu:gpuOffload===0?0:-1,lmstudio:{gpuOffload}},reasons:[...result.reasons,`LM Studio native estimate includes model and context memory. RAM adds at least 1.5 GiB staging/buffers; VRAM adds 15% plus 512 MiB. GPU offload: ${Math.round(gpuOffload*100)}%. One private instance, one prediction, exact ${contextTokens}-token context. Estimates are not a crash guarantee.`]};
}

export interface ManagedLmInstance {identifier:string;unload():Promise<void>;}
function bounded<T>(promise:Promise<T>,ms:number,signal?:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new ProviderError('runtime_timeout','LM Studio operation exceeded its deadline')),ms);timer.unref();
    const abort=()=>finish(signal?.reason);
    function finish(error?:unknown,value?:T){clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(value as T);}
    promise.then(value=>finish(undefined,value),error=>finish(error));signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

/** Called within Relay's global local lease for loading/generation. Estimation itself never loads. */
export class LmStudioRuntime {
  private cache=new Map<string,{at:number;value:Promise<EstimatedResourcesUsage>}>();
  private cleanupFailed=false;
  get allocationUncertain():boolean{return this.cleanupFailed;}
  constructor(private client:()=>Promise<LMStudioClient>,private hardware:()=>Promise<HardwareSnapshot>=getHardware,private policy:()=>Promise<ResourcePolicyConfig>=async()=>({profile:'safe'})){}
  private async estimate(model:ModelProfile,context:number,ratio:number,fresh=false):Promise<EstimatedResourcesUsage>{
    const key=JSON.stringify([model.id,model.sizeBytes,model.quantization,context,ratio]);
    const previous=this.cache.get(key);if(!fresh&&previous&&Date.now()-previous.at<30000)return previous.value;
    const value=bounded(this.client().then(client=>client.llm.estimateResourcesUsage(model.id.slice('lmstudio/'.length),lmStudioLoadConfig(context,ratio),{deviceIdentifier:null})),10000);
    if(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key,{at:Date.now(),value});void value.catch(()=>this.cache.delete(key));return value;
  }
  async admit(model:ModelProfile,context:number):Promise<Admission>{
    let last:Admission={allowed:false,decision:'queue',reasons:['LM Studio memory estimation is unavailable; no model was loaded.'],estimatedRamBytes:null,estimatedVramBytes:null,contextTokens:context,confidence:'unknown'};
    if(this.cleanupFailed)return {...last,reasons:['A previous LM Studio allocation has an uncertain outcome. Check/restart LM Studio, then Relay, before new local inference.']};
    try{
      let initial=await this.hardware();
      const pressure=unsafeMemory({hardware:initial,policy:await this.policy()},true);
      if(pressure)return {...last,reasons:[pressure]};
      const ratios=initial.memoryArchitecture==='cpu'?[0]:[1,.75,.5,.25,0];
      for(const ratio of ratios){
        const estimate=await this.estimate(model,context,ratio);
        if(Date.now()-Date.parse(initial.sampledAt)>10000)initial=await this.hardware();
        last=assessLmStudioEstimate(model,initial,context,ratio,estimate,await this.policy());
        if(last.allowed)return last;
      }
    }catch{/* Runtime errors must not expose SDK payloads, credentials or model paths. */}
    return last;
  }
  async load(model:ModelProfile,context:number,execution:ModelRequest['execution'],signal:AbortSignal):Promise<ManagedLmInstance>{
    signal.throwIfAborted();
    const ratio=execution?.lmstudio?.gpuOffload;
    if(this.cleanupFailed||ratio===undefined||![0,.25,.5,.75,1].includes(ratio))throw new ProviderError('RESOURCE_PRESSURE','LM Studio requires a valid resource admission plan.');
    const estimate=await bounded(this.estimate(model,context,ratio,true),10000,signal);
    const admission=assessLmStudioEstimate(model,await this.hardware(),context,ratio,estimate,await this.policy());
    if(!admission.allowed)throw new ProviderError('RESOURCE_PRESSURE',`LM Studio resource admission: ${admission.reasons.join(' ')}`);
    signal.throwIfAborted();const client=await this.client();signal.throwIfAborted();
    const config=lmStudioLoadConfig(context,ratio);
    const identifier=`relay-${randomUUID()}`;
    let instance:Awaited<ReturnType<LMStudioClient['llm']['load']>>;
    try{instance=await client.llm.load(model.id.slice('lmstudio/'.length),{identifier,deviceIdentifier:null,config,ttl:60,signal,verbose:false});}
    catch{
      // SDK cancellation sends a request but does not acknowledge server-side
      // allocation teardown. Do not release the scheduler into another load.
      this.cleanupFailed=true;
      throw new ProviderError('RESOURCE_PRESSURE',`LM Studio load ${identifier} has an uncertain allocation outcome. Check/restart LM Studio, then Relay, before new local inference.`);
    }
    const release=async()=>{try{await bounded(instance.unload(),10000);}catch{this.cleanupFailed=true;throw new ProviderError('RESOURCE_PRESSURE','Relay could not release its LM Studio instance. Check/restart LM Studio, then Relay, before new local inference.');}};
    try{
      signal.throwIfAborted();const actual=await bounded(instance.getLoadConfig(),10000,signal);
      if(actual.contextLength!==context||actual.maxParallelPredictions!==1||actual.gpu?.ratio!==ratio||actual.offloadKVCacheToGpu!==(ratio>0))throw new ProviderError('RESOURCE_PRESSURE','LM Studio did not apply the admitted load configuration. Generation was refused.');
      signal.throwIfAborted();return {identifier:instance.identifier,unload:release};
    }catch(error){await release();throw error;}
  }
}
