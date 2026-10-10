import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Admission,HardwareSnapshot,ModelProfile,TaskRecord} from '../shared/types.js';
import type {User} from '../server/auth/policy.js';
import type {Store} from '../server/db/store.js';
import {getHardware} from '../server/hardware/index.js';
import {profile} from '../server/providers/registry.js';
import {EvaluationStore} from '../server/models/evaluation-store.js';
import {compatibleEvaluationIdentity,localEvaluationIdentity} from '../server/models/evaluation.js';
import {evaluationLookup,relevantEvaluation} from '../server/models/evaluation-routing.js';

vi.mock('../server/hardware/index.js',()=>({getHardware:vi.fn()}));
const user={id:'account-a',sessionVersion:7} as User;
const store={} as Store;
let model:ModelProfile,task:TaskRecord,hardware:HardwareSnapshot;
const admission:Admission={allowed:true,decision:'run',reasons:[],estimatedRamBytes:1e9,estimatedVramBytes:0,contextTokens:8192,confidence:'estimated'};
const result={passed:9,total:9,successRate:1,categories:{instructions:{passed:1,total:1},debugging:{passed:1,total:1}},measuredAt:'2026-10-10T12:00:00.000Z'};
beforeEach(()=>{
  model={...profile('ollama','fixture'),quantization:'Q4',details:{digest:'fixture-digest',runtimeVersion:'1'}};
  task={options:{depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxIterations:4,maxSeconds:120,maxOutputTokens:512,maxCostUsd:0,localOnly:true}}} as TaskRecord;
  hardware={sampledAt:new Date().toISOString(),platform:'win32',architecture:'x64',memoryArchitecture:'discrete',cpu:{name:'Fixture CPU',physicalCores:8,logicalCores:16,utilization:0},memory:{totalBytes:32e9,availableBytes:20e9,swapTotalBytes:0,swapUsedBytes:0},gpus:[{vendor:'nvidia',name:'Fixture GPU',totalBytes:12e9,usedBytes:1e9,utilization:0,temperature:40,driver:'1'}],storage:null,warnings:[]};
  vi.mocked(getHardware).mockResolvedValue(hardware);
});
afterEach(()=>{vi.restoreAllMocks();vi.clearAllMocks();});
function saved(execution?:Admission['execution']){
  const identity=localEvaluationIdentity(model,hardware,8192,512,execution);
  const history=vi.spyOn(EvaluationStore.prototype,'history').mockResolvedValue([{id:'fixture-report',taskId:'fixture-task',status:'completed',protocol:'relay-capability-eval-v2',identity,createdAt:result.measuredAt,finishedAt:result.measuredAt,result}]);
  return {history,identity};
}

describe('configuration-bound evaluation routing',()=>{
  it('excludes runtime-auto evidence even when every requested identity field matches',async()=>{
    const {identity}=saved();
    expect(identity.gpuOffload).toBe('runtime-auto');expect(compatibleEvaluationIdentity(identity,localEvaluationIdentity(model,hardware,8192,512))).toBe(true);
    const evidence=await evaluationLookup(store,user,task)(model,admission);
    expect(evidence).toBeNull();expect(relevantEvaluation(evidence,['coding'])).toBeNull();
  });
  it('accepts explicit matching offload and scopes its history request to the current account',async()=>{
    const {history}=saved({numGpu:0});
    const lookup=evaluationLookup(store,user,task);
    expect(await lookup(model,{...admission,execution:{numGpu:0}})).toEqual(result);
    expect(history).toHaveBeenCalledWith({userId:'account-a',sessionVersion:7},40);
    expect(await lookup(model,{...admission,execution:{numGpu:20}})).toBeNull();
    expect(history).toHaveBeenCalledTimes(1);
  });
  it('does not transfer explicit placement evidence to a new automatic load',async()=>{
    saved({numGpu:20});expect(await evaluationLookup(store,user,task)(model,admission)).toBeNull();
  });
  it.each(['digest','runtimeVersion'] as const)('rejects a changed %s despite matching model ID and offload',async field=>{
    saved({numGpu:0});model.details[field]='changed';expect(await evaluationLookup(store,user,task)(model,{...admission,execution:{numGpu:0}})).toBeNull();
  });
  it('refuses default-reasoning evidence for an explicit task effort',async()=>{
    saved({numGpu:0});task.options.reasoning='high';expect(await evaluationLookup(store,user,task)(model,{...admission,execution:{numGpu:0}})).toBeNull();
  });
  it.each(['auto','default'] as const)('permits %s reasoning when local execution retains the evaluated runtime default',async reasoning=>{
    saved({numGpu:0});task.options.reasoning=reasoning;expect(await evaluationLookup(store,user,task)(model,{...admission,execution:{numGpu:0}})).toEqual(result);
  });
  it('rejects stale telemetry instead of assigning an unverified hardware identity',async()=>{
    saved({numGpu:0});hardware.sampledAt=new Date(Date.now()-60_000).toISOString();expect(await evaluationLookup(store,user,task)(model,{...admission,execution:{numGpu:0}})).toBeNull();
  });
  it('does not read local evaluation history for cloud candidates',async()=>{
    const {history}=saved({numGpu:0});expect(await evaluationLookup(store,user,task)({...model,local:false,provider:'openai'},admission)).toBeNull();expect(history).not.toHaveBeenCalled();
  });
});
