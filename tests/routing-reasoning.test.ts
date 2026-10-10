import {describe,expect,it} from 'vitest';
import {selectModel} from '../server/orchestration/router.js';
import {taskDemand} from '../server/models/task-demand.js';
import {resolveTaskReasoning} from '../server/orchestration/reasoning.js';
import {chatPermissions,type User} from '../server/auth/policy.js';
import type {Admission,ModelProfile,ProviderGateway,TaskRecord} from '../shared/types.js';

const owner:User={id:'owner',name:'Owner',email:null,role:'owner',enabled:true,permissions:{...chatPermissions,providers:['ollama','openai']},sessionVersion:0,createdAt:'',lastActiveAt:null};
const task=(objective='Hello'):TaskRecord=>({id:'task',conversationId:'conversation',objective,status:'executing',createdAt:'',updatedAt:'',result:null,error:null,callsUsed:0,stopGeneration:0,options:{depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'allow',budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:1,localOnly:false}}});
const model=(id:string,input=.1,output=.5):ModelProfile=>({id:`openai/${id}`,name:id,provider:'openai',runtime:'openai',local:false,state:'available',contextWindow:32768,sizeBytes:null,quantization:null,details:{},tokensPerSecond:null,inputPricePerMillion:input,outputPricePerMillion:output,capabilities:{tools:true,reasoning:true,structured:true,vision:false},reasoning:{levels:['none','low','medium','high'],source:'test contract',mode:'effort'}});
const admission:Admission={allowed:true,decision:'run',reasons:['Fixture fit'],contextTokens:8192,estimatedRamBytes:0,estimatedVramBytes:0,confidence:'estimated'};
const gateway=(models:ModelProfile[]):ProviderGateway=>({listModels:async()=>models,statuses:async()=>[],stream:async function*(){throw new Error('Routing must not call a model');}});
describe('task-aware economical reasoning',()=>{
  it('recognizes overlapping real requirements without a classifier call',()=>{
    expect(taskDemand('Debug this repository, implement changes across multiple files, then review security and run tests.').categories).toEqual(expect.arrayContaining(['debugging','multi_file_implementation','review_verification']));
    expect(taskDemand('Extract the document fields into JSON matching this schema.').categories).toEqual(expect.arrayContaining(['structured_extraction','document_analysis']));
    expect(taskDemand('Hello').complexity).toBe('simple');
    expect(taskDemand('Prove this theorem and derive the equation.').complexity).toBe('complex');
  });
  it('chooses inexpensive supported effort and never raises the configured output ceiling',()=>{
    const profile=model('fixture');
    expect(resolveTaskReasoning(profile,task(),'worker',2048).effort).toBe('none');
    const complex=task('Debug the repository and verify the algorithm');
    expect(resolveTaskReasoning(profile,complex,'worker',2048).effort).toBe('low');
    expect(resolveTaskReasoning(profile,complex,'worker',4096).effort).toBe('medium');
    complex.options.reasoning='high';expect(resolveTaskReasoning(profile,complex,'worker',2048).effort).toBe('high');
    expect(complex.options.budget.maxOutputTokens).toBeUndefined();
  });
  it('does not invent unsupported levels or change local-runtime thinking controls',()=>{
    const profile=model('fixture');profile.reasoning!.levels=['low','high'];
    expect(resolveTaskReasoning(profile,task(),'worker',2048).effort).toBe('low');
    const explicit=task();explicit.options.reasoning='none';
    expect(()=>resolveTaskReasoning(profile,explicit,'worker',2048)).toThrow(/reasoning/i);
    expect(resolveTaskReasoning({...profile,local:true},task(),'worker',2048).effort).toBeUndefined();
  });
  it('honors provider default explicitly and treats unknown capability as unknown',()=>{
    const profile=model('fixture');delete profile.reasoning;
    expect(resolveTaskReasoning(profile,task(),'worker',2048).effort).toBeUndefined();
    const explicit=task();explicit.options.reasoning='default';expect(resolveTaskReasoning(model('fixture'),explicit,'worker',2048).effort).toBeUndefined();
  });
});
describe('cloud-inclusive routing within cost and privacy constraints',()=>{
  it('uses small versioned task evidence only after hard eligibility and retains uncertainty',async()=>{
    const profiles=['fast-weak','slower-verified','ineligible'].map(id=>({...model(id),id:`ollama/${id}`,provider:'ollama' as const,local:true,tokensPerSecond:id==='fast-weak'?20:10}));
    const visited:string[]=[];
    const selected=await selectModel(gateway(profiles),task('Debug the algorithm'),owner,'worker',async profile=>({...admission,allowed:!profile.id.endsWith('ineligible')}),new Set(),async profile=>{
      visited.push(profile.id);const passed=profile.id.endsWith('slower-verified')?1:0;
      return {measuredAt:'2026-10-10T00:00:00Z',categories:{instructions:{passed,total:1},debugging:{passed,total:1},reasoning:{passed,total:1}}};
    });
    expect(selected.model.id).toBe('ollama/slower-verified');expect(visited).not.toContain('ollama/ineligible');
    expect(selected.reasons.join(' ')).toMatch(/uncertainty remains high/);
  });
  it('prefers a less costly equally capable cloud candidate without choosing extra reasoning',async()=>{
    const selected=await selectModel(gateway([model('expensive',10,50),model('economical')]),task(),owner,'worker',async()=>admission,new Set());
    expect(selected.model.id).toBe('openai/economical');expect(selected.reasoning).toBe('none');expect(selected.reasons.join(' ')).toMatch(/cost|price/i);
  });
  it('does not interpret unknown prices as a bargain when uncapped',async()=>{
    const objective=task();objective.options.budget.maxCostUsd=null;
    const unknown={...model('unknown'),inputPricePerMillion:null,outputPricePerMillion:null};
    const selected=await selectModel(gateway([unknown,model('known',10,50)]),objective,owner,'worker',async()=>admission,new Set());
    expect(selected.model.id).toBe('openai/known');
  });
  it('rejects a required model whose reservation exceeds the cap, even with a high preference score',async()=>{
    const objective=task(),expensive=model('expensive',10,50);objective.options.modelId=expensive.id;objective.options.modelSelection='required';objective.options.budget.maxCostUsd=.01;
    await expect(selectModel(gateway([expensive]),objective,owner,'worker',async()=>admission,new Set())).rejects.toThrow(/cost|budget/i);
  });
  it('does not use unknown prices to satisfy a strict financial cap',async()=>{
    const unknown={...model('unknown'),inputPricePerMillion:null,outputPricePerMillion:null};
    await expect(selectModel(gateway([unknown]),task(),owner,'worker',async()=>admission,new Set())).rejects.toThrow(/pricing|price/i);
  });
  it('considers a permitted cloud reasoner for complex work and preserves local-only and provider grants',async()=>{
    const local={...model('local'),id:'ollama/local',name:'local',provider:'ollama' as const,runtime:'ollama',local:true,reasoning:undefined,capabilities:{...model('x').capabilities,reasoning:false}};
    const cloud=model('reasoner');const objective=task('Prove the theorem with a multi-step derivation and verify the result');
    expect((await selectModel(gateway([local,cloud]),objective,owner,'worker',async()=>admission,new Set())).model.id).toBe(cloud.id);
    objective.options.budget.localOnly=true;
    expect((await selectModel(gateway([local,cloud]),objective,owner,'worker',async()=>admission,new Set())).model.id).toBe(local.id);
    objective.options.budget.localOnly=false;
    expect((await selectModel(gateway([local,cloud]),objective,{...owner,permissions:{...owner.permissions,providers:['ollama']}},'worker',async()=>admission,new Set())).model.id).toBe(local.id);
  });
});
