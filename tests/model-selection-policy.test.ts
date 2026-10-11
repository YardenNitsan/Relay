import {describe,expect,it} from 'vitest';
import {selectModel,type Admit} from '../server/orchestration/router.js';
import {chatPermissions,type User} from '../server/auth/policy.js';
import type {ModelProfile,ProviderGateway,TaskRecord} from '../shared/types.js';
import type {EvaluationLookup} from '../server/models/evaluation-routing.js';
import {rankCandidates} from '../server/models/selection-policy.js';

const user:User={id:'owner',name:'Owner',email:null,role:'owner',enabled:true,permissions:{...chatPermissions,providers:['ollama','openai']},sessionVersion:0,createdAt:'',lastActiveAt:null};
const profile=(id:string,changes:Partial<ModelProfile>={}):ModelProfile=>({id:`ollama/${id}`,name:id,provider:'ollama',runtime:'fixture',local:true,capabilities:{tools:true,vision:false,reasoning:false,structured:true},contextWindow:32768,quantization:null,sizeBytes:null,state:'available',details:{},tokensPerSecond:null,inputPricePerMillion:null,outputPricePerMillion:null,...changes});
const task=():TaskRecord=>({id:'task',conversationId:'conversation',objective:'Say hello.',status:'executing',options:{depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,cloudPolicy:'allow',budget:{maxCalls:4,maxSeconds:60,maxIterations:2,maxCostUsd:1,localOnly:false}},createdAt:'',updatedAt:'',result:null,error:null,callsUsed:0,stopGeneration:0});
const admit:Admit=async()=>({allowed:true,decision:'run',reasons:['Fixture admission'],contextTokens:8192,estimatedRamBytes:null,estimatedVramBytes:null,confidence:'unknown'});
const gateway=(models:ModelProfile[]):ProviderGateway=>({listModels:async()=>models,statuses:async()=>[],stream:async function*(){throw new Error('Selection cannot execute inference');}});
const evidence:EvaluationLookup=async model=>({categories:{instructions:{passed:model.name==='strong'?2:1,total:2}},measuredAt:'2026-10-11T00:00:00Z'});

describe('Auto preferences preserve eligibility and exact manual selection',()=>{
  it('Quality prioritizes relevant measured quality over a ready fast candidate',async()=>{
    const models=gateway([profile('fast',{state:'ready',tokensPerSecond:20}),profile('strong')]);
    const request=task();
    expect((await selectModel(models,request,user,'worker',admit,new Set(),evidence)).model.name).toBe('fast');
    request.options.autoPolicy='quality';
    const selected=await selectModel(models,request,user,'worker',admit,new Set(),evidence);
    expect(selected.model.name).toBe('strong');expect(selected.reasons.join(' ')).toContain('Auto Quality');
    expect((await selectModel(models,request,user,'security_reviewer',admit,new Set(),evidence)).model.name).toBe('strong');
  });
  it('Economy prefers known lower cost among equally evidenced specific cloud models',async()=>{
    const cheap=profile('cheap',{id:'openai/cheap',provider:'openai',local:false,inputPricePerMillion:1,outputPricePerMillion:1});
    const fast=profile('fast',{id:'openai/fast',provider:'openai',local:false,inputPricePerMillion:2,outputPricePerMillion:2,state:'ready',tokensPerSecond:20});
    const models=gateway([fast,cheap]),request=task();
    expect((await selectModel(models,request,user,'worker',admit,new Set(),evidence)).model.id).toBe(fast.id);
    request.options.autoPolicy='economy';
    expect((await selectModel(models,request,user,'worker',admit,new Set(),evidence)).model.id).toBe(cheap.id);
    request.options.modelId=fast.id;request.options.modelSelection='required';
    expect((await selectModel(models,request,user,'worker',admit,new Set(),evidence)).model.id).toBe(fast.id);
  });
  it('Economy never interprets unpriced cloud inference as free even with an uncapped account',async()=>{
    const request=task();request.options.autoPolicy='economy';request.options.budget.maxCostUsd=null;
    const models=gateway([profile('unpriced',{id:'openai/unpriced',provider:'openai',local:false})]);
    await expect(selectModel(models,request,user,'worker',admit,new Set())).rejects.toMatchObject({code:'NO_MODEL',message:expect.stringContaining('Economy')});
  });
  it('Quality cannot override local-only privacy or deterministic hardware refusal',async()=>{
    const cloud=profile('strong',{id:'openai/strong',provider:'openai',local:false,inputPricePerMillion:1,outputPricePerMillion:1});
    const local=profile('local'),request=task();request.options.autoPolicy='quality';request.options.cloudPolicy='local_only';
    expect((await selectModel(gateway([cloud,local]),request,user,'worker',admit,new Set(),evidence)).model.id).toBe(local.id);
    const refuse:Admit=async model=>({...await admit(model,8192),allowed:false,decision:'alternative',reasons:['Safety headroom unavailable']});
    await expect(selectModel(gateway([cloud,local]),request,user,'worker',refuse,new Set(),evidence)).rejects.toMatchObject({code:'NO_MODEL'});
  });
  it('never replaces a missing manual model under any Auto preference',async()=>{
    for(const autoPolicy of ['balanced','quality','economy'] as const){
      const request=task();request.options={...request.options,autoPolicy,modelId:'ollama/missing',modelSelection:'required'};
      await expect(selectModel(gateway([profile('strong')]),request,user,'worker',admit,new Set(),evidence)).rejects.toMatchObject({code:'NO_MODEL',message:expect.stringContaining('required model ollama/missing')});
    }
  });
  it('Economy retains the documented quality boundary and excludes cheaper weak evidence',()=>{
    const strongest={id:'strongest',score:30,qualityScore:20,cost:.2};
    const boundary={id:'boundary',score:20,qualityScore:10,cost:.1};
    const below={id:'below',score:50,qualityScore:9.9,cost:0};
    expect(rankCandidates([below,strongest,boundary],'economy').map(model=>model.id)).toEqual(['boundary','strongest']);
  });
  it('Quality discloses its fallback when no candidate has measured task evidence',async()=>{
    const request=task();request.options.autoPolicy='quality';
    const selected=await selectModel(gateway([profile('ordinary'),profile('ready',{state:'ready'})]),request,user,'worker',admit,new Set());
    expect(selected.model.name).toBe('ready');
    expect(selected.reasons.join(' ')).toContain('task quality is unmeasured');
  });
});
