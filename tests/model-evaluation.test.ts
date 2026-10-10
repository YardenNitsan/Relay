import {describe,expect,it} from 'vitest';
import {evaluationProtocol,evaluationCases,gradeEvaluationSample,compatibleEvaluationIdentity,runEvaluation,evaluationEvidence,localEvaluationIdentity,type EvaluationIdentity,type EvaluationExecutor} from '../server/models/evaluation.js';
import {profile} from '../server/providers/registry.js';
import type {HardwareSnapshot} from '../shared/types.js';

const identity:EvaluationIdentity={modelId:'ollama/synthetic',provider:'ollama',digest:'sha256:abc',runtime:'ollama',runtimeVersion:'1.2.3',quantization:'Q4_K_M',contextTokens:8192,gpuOffload:24,executionSettings:{temperature:0,seed:17,reasoning:'none',maxOutputTokens:512},hardwareFingerprint:'a'.repeat(64)};
const output=(text:string)=>({text,toolCalls:[]});
describe('versioned synthetic evaluation grading',()=>{
  it.each([
    ['loop-boundary','{"line":3,"condition":"i < values.length","empty":0,"sample":6}'],
    ['schema-contract','{"id":"INV-204","paid":true,"discount":null,"tags":["urgent","export"]}'],
    ['document-extraction','{"ids":["R2","R4"],"totalCents":1850}'],
    ['instruction-boundaries','READY\nSAFE'],
    ['context-revisions','{"asset":"Q17","revision":3,"location":"north","active":true}'],
    ['multilingual-extraction','{"apples":3,"pears":5,"oranges":2,"total":10}'],
  ])('grades the complete expected outcome for %s and fails unrelated answers',(id,text)=>{
    expect(gradeEvaluationSample(id,output(text)).passed).toBe(true);
    expect(gradeEvaluationSample(id,output('{}')).passed).toBe(false);
  });
  it('handles excessive JSON nesting as a failed sample rather than crashing the suite',()=>{
    expect(gradeEvaluationSample('schema-contract',output('['.repeat(5000)+'0'+']'.repeat(5000))).passed).toBe(false);
  });
  it('grades a bounded recovery proposal and rejects repeating the failed arguments',()=>{
    const call={id:'retry',name:'list_items',arguments:{cursor:null,limit:20}};
    expect(gradeEvaluationSample('failed-tool-recovery',{text:'',toolCalls:[call]}).passed).toBe(true);
    expect(gradeEvaluationSample('failed-tool-recovery',{text:'',toolCalls:[{...call,arguments:{cursor:null,limit:100}}]}).passed).toBe(false);
  });
  it('grades structured multistep reasoning independent of object key order',()=>{
    expect(gradeEvaluationSample('dependency-schedule',output('{"criticalPath":["A","B","D"],"completion":{"D":11,"C":5,"B":7,"A":3}}'))).toMatchObject({passed:true});
    expect(gradeEvaluationSample('dependency-schedule',output('{"criticalPath":["A","C","D"],"completion":{"A":3,"B":7,"C":5,"D":9}}'))).toMatchObject({passed:false});
  });
  it('rejects malformed, oversized and extra-field outputs without executing model text',()=>{
    for(const text of ['```json\n{}\n```','throw new Error("execute me")','x'.repeat(32769),'{"ids":["R2","R4"],"totalCents":1850,"extra":true}'])expect(gradeEvaluationSample('document-extraction',output(text)).passed).toBe(false);
    expect(()=>gradeEvaluationSample('not-a-case',output('{}'))).toThrow(/unknown/i);
  });
  it('requires one exact tool call and denies extra arguments or extra calls',()=>{
    const call={id:'call',name:'lookup_inventory',arguments:{sku:'AX-17',warehouse:'north'}};
    expect(gradeEvaluationSample('tool-arguments',{text:'',toolCalls:[call]}).passed).toBe(true);
    expect(gradeEvaluationSample('tool-arguments',{text:'',toolCalls:[{...call,arguments:{...call.arguments,admin:true}}]}).passed).toBe(false);
    expect(gradeEvaluationSample('tool-arguments',{text:'',toolCalls:[call,call]}).passed).toBe(false);
  });
  it('isolates case inputs and excludes grader answers from runner prompts',()=>{
    const first=evaluationCases();first[0].messages[0].content='mutated';first[0].tools.push({name:'unsafe',description:'x',parameters:{}});
    expect(evaluationCases()[0].messages[0].content).not.toBe('mutated');
    expect(evaluationCases()[0].tools).toEqual([]);
    expect(evaluationCases().every(sample=>!('expected' in sample))).toBe(true);
    expect(new Set(evaluationCases().map(sample=>sample.id)).size).toBe(evaluationCases().length);
  });
});

describe('evaluation provenance and bounded execution',()=>{
  it('fingerprints hardware configuration without treating temporary pressure as a new device',()=>{
    const model={...profile('ollama','sample'),quantization:'Q4',details:{digest:'known',runtimeVersion:'1'}};
    const hardware:HardwareSnapshot={sampledAt:new Date().toISOString(),platform:'linux',architecture:'x64',memoryArchitecture:'cpu',cpu:{name:'Known CPU',physicalCores:4,logicalCores:8,utilization:10},memory:{totalBytes:32e9,availableBytes:20e9,swapTotalBytes:0,swapUsedBytes:0},gpus:[],storage:null,warnings:[]};
    const first=localEvaluationIdentity(model,hardware,8192,512);
    expect(first).toMatchObject({gpuOffload:'runtime-auto',executionSettings:{temperature:null,seed:null,reasoning:'runtime-default'}});
    expect(localEvaluationIdentity(model,{...hardware,memory:{...hardware.memory,availableBytes:15e9}},8192,512).hardwareFingerprint).toBe(first.hardwareFingerprint);
    expect(localEvaluationIdentity(model,{...hardware,memory:{...hardware.memory,totalBytes:64e9}},8192,512).hardwareFingerprint).not.toBe(first.hardwareFingerprint);
    expect(()=>localEvaluationIdentity(model,{...hardware,sampledAt:'2000-01-01T00:00:00Z'},8192,512)).toThrow(/stale/i);
  });
  it('requires every execution dimension to match and rejects missing identity',()=>{
    expect(compatibleEvaluationIdentity(identity,{...identity,executionSettings:{seed:17,maxOutputTokens:512,reasoning:'none',temperature:0}})).toBe(true);
    for(const delta of [{digest:'other'},{runtimeVersion:'2'},{quantization:'Q8'},{contextTokens:4096},{gpuOffload:12},{hardwareFingerprint:'b'.repeat(64)},{executionSettings:{...identity.executionSettings,reasoning:'high'}},{modelId:'ollama/other'}])expect(compatibleEvaluationIdentity(identity,{...identity,...delta})).toBe(false);
    expect(compatibleEvaluationIdentity(identity,{...identity,digest:null})).toBe(false);
    expect(compatibleEvaluationIdentity(identity,{...identity,runtimeVersion:'unknown'})).toBe(false);
    expect(compatibleEvaluationIdentity({...identity,gpuOffload:'runtime-auto'},{...identity,gpuOffload:'runtime-auto'})).toBe(true);
    expect(compatibleEvaluationIdentity({...identity,gpuOffload:'runtime-auto'},identity)).toBe(false);
  });
  it('runs cases sequentially and keeps fixture scores ineligible for live routing',async()=>{
    let running=0,peak=0;const ids:string[]=[];
    const executor:EvaluationExecutor=async(sample)=>{running++;peak=Math.max(peak,running);ids.push(sample.id);await Promise.resolve();running--;return {...output('{}'),identity,completed:true,measurement:{inputTokens:100,outputTokens:10}};};
    const evidence=await runEvaluation(identity,executor,{signal:new AbortController().signal,source:'fixture',maxCalls:20,timeoutMs:1000});
    expect(peak).toBe(1);expect(ids).toEqual(evaluationCases().map(sample=>sample.id));
    expect(evidence.protocol).toBe(evaluationProtocol);expect(evidence.samples).toHaveLength(evaluationCases().length);
    expect(evaluationEvidence(evidence,identity)).toBeNull();
  });
  it('rejects evidence with missing cases, altered protocol, future time or changed identity',async()=>{
    const executor:EvaluationExecutor=async()=>({...output('{}'),identity,completed:true});
    const evidence=await runEvaluation(identity,executor,{signal:new AbortController().signal,source:'provider',maxCalls:20,timeoutMs:1000});
    expect(evaluationEvidence(evidence,identity)).not.toBeNull();
    for(const changed of [{...evidence,samples:evidence.samples.slice(1)},{...evidence,protocol:'invented'},{...evidence,measuredAt:'2099-01-01T00:00:00.000Z'},{...evidence,identity:{...identity,digest:'other'}},{...evidence,samples:[...evidence.samples.slice(1),evidence.samples[1]]}])expect(evaluationEvidence(changed,identity)).toBeNull();
    const incomplete=structuredClone(evidence);incomplete.samples[0].checks=[{name:'json-contract',passed:true}];incomplete.samples[0].passed=true;
    expect(evaluationEvidence(incomplete,identity)).toBeNull();
  });
  it('fails closed on insufficient call budget, cancellation, and a mismatched actual runtime',async()=>{
    let calls=0;const executor:EvaluationExecutor=async()=>{calls++;return {...output('{}'),identity:{...identity,gpuOffload:0},completed:true};};
    await expect(runEvaluation(identity,executor,{signal:new AbortController().signal,source:'fixture',maxCalls:1,timeoutMs:1000})).rejects.toThrow(/budget/i);
    expect(calls).toBe(0);
    const stopped=new AbortController();stopped.abort(new Error('stop'));
    await expect(runEvaluation(identity,executor,{signal:stopped.signal,source:'fixture',maxCalls:20,timeoutMs:1000})).rejects.toThrow('stop');
    expect(calls).toBe(0);
    await expect(runEvaluation(identity,executor,{signal:new AbortController().signal,source:'fixture',maxCalls:20,timeoutMs:1000})).rejects.toThrow(/identity/i);
    expect(calls).toBe(1);
  });
  it('stops the suite after a timed-out executor without dispatching another case',async()=>{
    let calls=0;let aborted=false;let released=false;
    const executor:EvaluationExecutor=async(_sample,options)=>{calls++;return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>{aborted=true;setTimeout(()=>{released=true;reject(options.signal.reason);},25);},{once:true});});};
    await expect(runEvaluation(identity,executor,{signal:new AbortController().signal,source:'fixture',maxCalls:20,timeoutMs:20})).rejects.toThrow(/time/i);
    expect(calls).toBe(1);expect(aborted).toBe(true);expect(released).toBe(true);
  });
});
