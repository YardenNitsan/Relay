import {describe,it,expect,vi} from 'vitest';
import {assessLmStudioEstimate,lmStudioLoadConfig,LmStudioRuntime} from '../server/providers/lmstudio-runtime.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import type {HardwareSnapshot,ModelProfile} from '../shared/types.js';
const G=1024**3;
const hardware=():HardwareSnapshot=>({sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'test',physicalCores:8,logicalCores:16,utilization:0},memory:{totalBytes:32*G,availableBytes:24*G,swapTotalBytes:0,swapUsedBytes:0},gpus:[{vendor:'NVIDIA',name:'test',totalBytes:12*G,usedBytes:G,utilization:0,temperature:null,driver:null}],storage:null,warnings:[]});
const model:ModelProfile={id:'lmstudio/test',name:'test',provider:'lmstudio',runtime:'lmstudio',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:false},contextWindow:32768,quantization:'Q4',sizeBytes:6*G,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null};
const estimate=()=>({memory:{confidence:'high' as const,modelBytes:6*G,contextBytes:G,totalBytes:7*G,modelVramBytes:6*G,contextVramBytes:G,totalVramBytes:7*G},passesGuardrails:true});
describe('native LM Studio resource admission',()=>{
  it('includes runtime context estimates, extra load buffers and system headroom',()=>{
    const result=assessLmStudioEstimate(model,hardware(),4096,1,estimate());
    expect(result.allowed).toBe(true);expect(result.estimatedRamBytes).toBeGreaterThan(1.5*G);expect(result.estimatedVramBytes).toBeGreaterThan(7*G);expect(result.execution?.lmstudio?.gpuOffload).toBe(1);
  });
  it.each(['low','nan','negative','guardrails','context','stale','ram','vram'])('fails closed for %s',kind=>{
    const h=hardware(),e=estimate();let context=4096;
    if(kind==='low')Object.assign(e.memory,{confidence:'low'});
    if(kind==='nan')e.memory.totalBytes=NaN;
    if(kind==='negative')e.memory.contextBytes=-1;
    if(kind==='guardrails')e.passesGuardrails=false;
    if(kind==='context')context=65536;
    if(kind==='stale')h.sampledAt='2000-01-01';
    if(kind==='ram')h.memory.availableBytes=5*G;
    if(kind==='vram')h.gpus[0]!.usedBytes=9*G;
    expect(assessLmStudioEstimate(model,h,context,1,e).allowed).toBe(false);
  });
  it('counts Apple unified memory once and admits CPU with no GPU telemetry',()=>{
    const h=hardware();h.memoryArchitecture='unified';h.gpus=[];
    expect(assessLmStudioEstimate(model,h,4096,1,estimate()).allowed).toBe(true);
    h.memoryArchitecture='cpu';const e=estimate();e.memory.totalVramBytes=0;e.memory.modelVramBytes=0;e.memory.contextVramBytes=0;
    expect(assessLmStudioEstimate(model,h,4096,0,e)).toMatchObject({allowed:true,execution:{numGpu:0}});
  });
  it('pins context, concurrency and offload instead of inheriting GUI defaults',()=>{
    expect(lmStudioLoadConfig(4096,0)).toMatchObject({contextLength:4096,maxParallelPredictions:1,gpu:{ratio:0},offloadKVCacheToGpu:false});
  });
  it('rechecks memory immediately before loading and never loads under pressure',async()=>{
    const load=vi.fn();const client={llm:{estimateResourcesUsage:vi.fn(async()=>estimate()),load}};
    const h=hardware();const runtime=new LmStudioRuntime(async()=>client as never,async()=>h);
    expect((await runtime.admit(model,4096)).allowed).toBe(true);
    h.memory.availableBytes=G;
    await expect(runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},new AbortController().signal)).rejects.toMatchObject({code:'RESOURCE_PRESSURE'});
    expect(load).not.toHaveBeenCalled();
  });
  it('loads a local-only private instance, checks actual context and releases only that instance',async()=>{
    const unload=vi.fn(async()=>{}),getLoadConfig=vi.fn(async()=>lmStudioLoadConfig(4096,1));
    const load=vi.fn(async(_key:string,opts:{identifier:string})=>({identifier:opts.identifier,getLoadConfig,unload}));
    const runtime=new LmStudioRuntime(async()=>({llm:{estimateResourcesUsage:async()=>estimate(),load}}) as never,async()=>hardware());
    const handle=await runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},new AbortController().signal);
    expect(load.mock.calls[0]?.[1]).toMatchObject({deviceIdentifier:null,config:{contextLength:4096,maxParallelPredictions:1},ttl:60});
    expect(handle.identifier).toMatch(/^relay-/);await handle.unload();expect(unload).toHaveBeenCalledOnce();
  });
  it('unloads and refuses a runtime that ignores the requested context',async()=>{
    const unload=vi.fn(async()=>{});
    const runtime=new LmStudioRuntime(async()=>({llm:{estimateResourcesUsage:async()=>estimate(),load:async()=>({identifier:'relay-test',getLoadConfig:async()=>lmStudioLoadConfig(32000,1),unload})}}) as never,async()=>hardware());
    await expect(runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},new AbortController().signal)).rejects.toThrow(/configuration/i);
    expect(unload).toHaveBeenCalledOnce();
  });
  it('does not begin estimating or loading an already cancelled request',async()=>{
    const client=vi.fn();const runtime=new LmStudioRuntime(client,async()=>hardware());
    const controller=new AbortController();controller.abort(new Error('stopped'));
    await expect(runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},controller.signal)).rejects.toThrow('stopped');expect(client).not.toHaveBeenCalled();
  });
  it('skips every native estimate when RAM is already below the reserve',async()=>{
    const client=vi.fn();const h=hardware();h.memory.availableBytes=G;
    const runtime=new LmStudioRuntime(client,async()=>h);expect((await runtime.admit(model,4096)).allowed).toBe(false);expect(client).not.toHaveBeenCalled();
  });
  it('blocks further loads after uncertain cleanup rather than accumulating allocations',async()=>{
    const load=vi.fn(async()=>({identifier:'relay-test',getLoadConfig:async()=>lmStudioLoadConfig(4096,1),unload:async()=>{throw new Error('unavailable');}}));
    const runtime=new LmStudioRuntime(async()=>({llm:{estimateResourcesUsage:async()=>estimate(),load}}) as never,async()=>hardware());
    const handle=await runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},new AbortController().signal);
    await expect(handle.unload()).rejects.toThrow(/release/);expect((await runtime.admit(model,4096)).allowed).toBe(false);
    await expect(runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},new AbortController().signal)).rejects.toThrow(/admission/);expect(load).toHaveBeenCalledOnce();
  });
  it.each(['cancelled','disconnected'])('quarantines an uncertain %s load before another admission',async kind=>{
    const controller=new AbortController();
    const load=vi.fn(async()=>{if(kind==='cancelled')controller.abort(new Error('stopped'));throw new Error('server outcome unknown');});
    const runtime=new LmStudioRuntime(async()=>({llm:{estimateResourcesUsage:async()=>estimate(),load}}) as never,async()=>hardware());
    await expect(runtime.load(model,4096,{numGpu:-1,lmstudio:{gpuOffload:1}},controller.signal)).rejects.toBeDefined();
    expect(runtime.allocationUncertain).toBe(true);expect((await runtime.admit(model,4096)).allowed).toBe(false);
    const fetcher=vi.fn();const gateway=new Providers({lmstudioRuntime:runtime,fetch:fetcher,secrets:new SecretManager({env:{},keyring:null})});
    const ollama={...model,id:'ollama/test',provider:'ollama' as const,runtime:'ollama'};
    expect((await gateway.admitModel(ollama,4096)).allowed).toBe(false);
    const stream=gateway.stream({model:ollama,messages:[],tools:[],contextTokens:4096,maxOutputTokens:100,signal:new AbortController().signal});
    await expect(stream.next()).rejects.toMatchObject({code:'RESOURCE_PRESSURE'});expect(fetcher).not.toHaveBeenCalled();
  });
});
