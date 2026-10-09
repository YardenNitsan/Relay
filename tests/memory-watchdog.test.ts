import {afterEach,describe,it,expect,vi} from 'vitest';
import {unsafeMemory,watchLocalMemory,type MemorySample} from '../server/hardware/watchdog.js';
const GiB=1024**3;
const sample=():MemorySample=>({policy:{profile:'safe'},hardware:{sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'fixture',physicalCores:4,logicalCores:8,utilization:50},memory:{totalBytes:32*GiB,availableBytes:7*GiB,swapTotalBytes:4*GiB,swapUsedBytes:0},gpus:[{vendor:'NVIDIA',name:'fixture',totalBytes:12*GiB,usedBytes:9*GiB,utilization:80,temperature:60,driver:'fixture'}],storage:null,warnings:[]}});
afterEach(()=>vi.useRealTimers());
describe('live memory safety',()=>{
 it('checks remaining headroom without adding already-loaded model allocations',()=>{expect(unsafeMemory(sample())).toBeNull();const data=sample();data.hardware.memory.availableBytes=5*GiB;expect(unsafeMemory(data)).toMatch(/RAM/);});
 it('enforces discrete GPU reserves but ignores unrelated VRAM for enforced CPU execution',()=>{const data=sample();data.hardware.gpus[0].usedBytes=11.8*GiB;expect(unsafeMemory(data)).toMatch(/GPU/);expect(unsafeMemory(data,true)).toBeNull();data.hardware.gpus[0].usedBytes=null;expect(unsafeMemory(data,true)).toBeNull();});
 it('counts unified RAM once and rejects stale or invalid telemetry',()=>{const data=sample();data.hardware.memoryArchitecture='unified';data.hardware.gpus[0].usedBytes=null;expect(unsafeMemory(data)).toBeNull();data.hardware.sampledAt=new Date(Date.now()-20000).toISOString();expect(unsafeMemory(data)).toMatch(/stale/);});
 it('aborts only the current request and leaves no timers after a stuck sample',async()=>{
  vi.useFakeTimers();const parent=new AbortController();let calls=0;
  const watch=watchLocalMemory(parent.signal,()=>{calls++;return new Promise(()=>{});},undefined,{intervalMs:10,timeoutMs:20});
  await vi.advanceTimersByTimeAsync(31);expect(watch.signal.aborted).toBe(true);expect(parent.signal.aborted).toBe(false);expect(watch.error()?.code).toBe('RESOURCE_PRESSURE');expect(calls).toBe(1);expect(vi.getTimerCount()).toBe(0);watch.stop();
 });
 it('cancels sampling promptly with the task and never overlaps probes',async()=>{
  vi.useFakeTimers();const parent=new AbortController();let calls=0,complete!:(value:MemorySample)=>void;
  const watch=watchLocalMemory(parent.signal,()=>{calls++;return new Promise(resolve=>{complete=resolve;});},undefined,{intervalMs:10,timeoutMs:100});
  await vi.advanceTimersByTimeAsync(90);expect(calls).toBe(1);parent.abort();expect(vi.getTimerCount()).toBe(0);complete(sample());await Promise.resolve();expect(watch.error()).toBeUndefined();
 });
});
