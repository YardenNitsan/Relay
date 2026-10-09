import type {HardwareSnapshot} from '../../shared/types.js';
import {AppError} from '../core/errors.js';
import {reserveBytes,resolveResourcePolicy,type ResourcePolicyConfig} from './policy.js';

export interface MemoryWatch {signal:AbortSignal;stop():void;error():AppError|undefined;}
export type MemoryWatchFactory=(signal:AbortSignal,execution?:{numGpu:number})=>MemoryWatch;
export interface MemorySample {hardware:HardwareSnapshot;policy:ResourcePolicyConfig;}

/** Observe remaining memory; model weights/KV are already in the OS usage. */
export function unsafeMemory(sample:MemorySample,cpuOnly=false):string|null {
  const {hardware}=sample,policy=resolveResourcePolicy(sample.policy),age=Date.now()-Date.parse(hardware.sampledAt);
  if(!Number.isFinite(age)||age>15000||age< -5000)return 'Live memory telemetry is stale.';
  const {totalBytes,availableBytes,swapUsedBytes}=hardware.memory;
  if(!Number.isFinite(totalBytes)||totalBytes<=0||!Number.isFinite(availableBytes)||availableBytes<0||availableBytes>totalBytes)return 'Live physical memory telemetry is unavailable.';
  if(availableBytes<reserveBytes(totalBytes,policy.ramReserveGiB,policy.ramReservePercent))return 'Available physical RAM fell below the configured safety reserve.';
  if(swapUsedBytes!==null&&swapUsedBytes>totalBytes*.25)return 'Swap/pagefile pressure became unsafe.';
  if(cpuOnly||hardware.memoryArchitecture==='unified')return null;
  if(hardware.memoryArchitecture==='unknown')return 'Live GPU memory telemetry is unavailable.';
  for(const gpu of hardware.gpus.filter(item=>!item.memoryShared)){
    const total=gpu.totalBytes,used=gpu.usedBytes;
    if(total===null||used===null||!Number.isFinite(total)||!Number.isFinite(used)||total<=0||used<0||used>total)return 'Live dedicated GPU memory telemetry is unavailable.';
    if(total-used<reserveBytes(total,policy.vramReserveGiB,policy.vramReservePercent))return 'Available dedicated GPU memory fell below the configured safety reserve.';
  }
  return null;
}

/** A single non-overlapping sample. Stop never waits for a stuck telemetry API. */
export function watchLocalMemory(parent:AbortSignal,sample:()=>Promise<MemorySample>,execution?:{numGpu:number},timing={intervalMs:5000,timeoutMs:4000}):MemoryWatch {
  const controller=new AbortController(),signal=AbortSignal.any([parent,controller.signal]);
  let timer:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined,closed=false,failure:AppError|undefined;
  const stop=()=>{closed=true;clearTimeout(timer);clearTimeout(deadline);parent.removeEventListener('abort',stop);};
  const fail=(reason:string)=>{if(closed||parent.aborted)return;failure=new AppError('RESOURCE_PRESSURE',`${reason} Local generation was stopped to protect host responsiveness. Free resources before resuming; automatic model retry is disabled.`,409);controller.abort(failure);stop();};
  const poll=async()=>{
    try{
      const result=await Promise.race([sample(),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Telemetry timeout')),timing.timeoutMs);deadline.unref();})]);
      if(!closed){const reason=unsafeMemory(result,execution?.numGpu===0);if(reason)fail(reason);}
    }catch{fail('Live memory pressure could not be checked within its deadline.');}
    finally{clearTimeout(deadline);if(!closed){timer=setTimeout(()=>{void poll();},timing.intervalMs);timer.unref();}}
  };
  parent.addEventListener('abort',stop,{once:true});
  if(parent.aborted)stop();else{timer=setTimeout(()=>{void poll();},timing.intervalMs);timer.unref();}
  return {signal,stop,error:()=>failure};
}
