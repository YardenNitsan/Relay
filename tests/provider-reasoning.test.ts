import {describe,it,expect} from 'vitest';
import {cloudModels,profile} from '../server/providers/registry.js';
import {cloudBody,geminiStream} from '../server/providers/cloud.js';
import {googleGenerateBody} from '../server/providers/google-generate.js';
import {validateReasoning,preflightReasoning} from '../server/providers/reasoning.js';
import {Providers} from '../server/providers/index.js';
import {SecretManager} from '../server/providers/secrets.js';
import type {GoogleOAuth} from '../server/providers/google-oauth.js';
import type {ModelRequest,ModelChunk} from '../shared/types.js';

function request(provider:'openai'|'anthropic'|'gemini'|'xai'|'deepseek',id:string,metadata:Record<string,unknown>={},transport:'interactions'|'generateContent'='interactions'):ModelRequest {
  const model=cloudModels(provider,provider==='gemini'?{models:[{name:id,...metadata}]}:{data:[{id,...metadata}]},transport)[0]!;
  return {model,messages:[{role:'user',content:'Hello'}],tools:[],contextTokens:4096,maxOutputTokens:1024,signal:new AbortController().signal};
}
describe('provider reasoning contracts',()=>{
  it.each(['openai','anthropic','gemini','deepseek'] as const)('retains the discovered %s output ceiling through profile enrichment',provider=>{
    const id={openai:'gpt-6-astra',anthropic:'claude-sonnet-4-6',gemini:'gemini-3.8-flash',deepseek:'deepseek-flash'}[provider];
    expect(request(provider,id,{max_output_tokens:4096}).model.details.maxOutputTokens).toBe(4096);
  });
  it.each(['xai','deepseek'] as const)('does not assert all %s prices are unknown before price enrichment',provider=>{
    const model=request(provider,provider==='xai'?'grok-4.7':'deepseek-flash').model;expect(model.details.limitation).not.toMatch(/Pricing is unknown/);
  });
  it.each([
    ['openai','gpt-6-astra','low',{reasoning:{effort:'low'}}],
    ['openai','gpt-5.4','none',{reasoning:{effort:'none'}}],
    ['xai','grok-4.7','xhigh',{reasoning:{effort:'xhigh'}}],
    ['anthropic','claude-sonnet-4-6','medium',{thinking:{type:'adaptive'},output_config:{effort:'medium'}}],
    ['deepseek','deepseek-flash','low',{thinking:{type:'enabled'},reasoning_effort:'low'}],
    ['deepseek','deepseek-flash','none',{thinking:{type:'disabled'}}],
    ['gemini','gemini-3.8-flash','low',{generation_config:{max_output_tokens:1024,thinking_level:'low'}}],
  ] as const)('serializes %s %s %s without raising output cap',(provider,id,effort,body)=>{
    const input=request(provider,id);input.reasoning=effort;expect(cloudBody(input)).toMatchObject(body);
  });
  it.each([['openai','gpt-6-astra','none'],['openai','gpt-6-future','high'],['xai','grok-4.5','xhigh'],['gemini','gemini-3.8-flash','minimal'],['anthropic','claude-sonnet-4-6','xhigh']] as const)('rejects unsupported %s %s %s',(provider,id,effort)=>{
    const input=request(provider,id);input.reasoning=effort;expect(()=>cloudBody(input)).toThrow(/reasoning/i);
  });
  it('preserves provider defaults when no effort is selected',()=>{
    for(const [provider,id] of [['openai','gpt-6-astra'],['anthropic','claude-sonnet-4-6'],['deepseek','deepseek-flash']] as const){const body=cloudBody(request(provider,id));expect(body).not.toHaveProperty('reasoning');expect(body).not.toHaveProperty('thinking');expect(body).not.toHaveProperty('output_config');}
  });
  it('validates the effective cap and rejects legacy numeric controls without expanding it',()=>{
    const input=request('anthropic','claude-sonnet-4-6');input.reasoning='high';input.maxOutputTokens=256;
    expect(cloudBody(input).max_tokens).toBe(256);expect(()=>validateReasoning(input.model,'high',0)).toThrow(/allowance/);
    input.model.reasoning={levels:['high'],source:'legacy test',mode:'anthropic-budget'};expect(()=>validateReasoning(input.model,'high',8192)).toThrow(/Numeric/);
  });
  it.each(['gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'])('supports documented none and max on %s only',id=>{
    const input=request('openai',id);expect(input.model.reasoning?.levels).toEqual(['none','low','medium','high','xhigh','max']);
    input.reasoning='none';expect(cloudBody(input)).toMatchObject({reasoning:{effort:'none'}});
  });
  it('does not turn default-only or explicit negative provider metadata into guessed support',()=>{
    expect(request('xai','grok-4.7',{capabilities:{reasoning_effort:[]}}).model.reasoning?.levels).toEqual([]);
    expect(request('anthropic','claude-sonnet-4-6',{capabilities:{effort:{supported:false}}}).model.reasoning?.levels).toEqual([]);
    expect(request('openai','gpt-6-astra-unknown').model.reasoning).toBeUndefined();
    const gemini=request('gemini','gemini-3.8-flash',{thinking:false});expect(gemini.model.reasoning?.levels).toEqual([]);expect(gemini.model.capabilities.reasoning).toBe(false);
  });
  it('preflights DeepSeek history before dispatch without choosing an automatic fallback',()=>{
    const input=request('deepseek','deepseek-flash');const tools=[{name:'read',description:'Read',parameters:{}}];input.messages.push({role:'assistant',content:'Earlier answer'});
    expect(()=>preflightReasoning(input.model,'low',input.messages,tools)).toThrow(/continuation/);
    expect(preflightReasoning(input.model,'none',input.messages,tools)).toBe('none');
    expect(preflightReasoning(input.model,undefined,input.messages,tools)).toBeUndefined();
    expect(preflightReasoning(input.model,'low',input.messages,[])).toBe('low');
    input.messages[1].providerData={provider:'deepseek',data:{role:'assistant',content:'Earlier answer',reasoning_content:''}};
    expect(preflightReasoning(input.model,'high',input.messages,tools)).toBe('high');
  });
  it('preflight rejects unsupported effort before provider serialization',()=>{
    const input=request('openai','gpt-6-astra');expect(()=>preflightReasoning(input.model,'none',input.messages,[])).toThrow(/not supported/);
  });
  it('uses model metadata as authority, filtering unknown levels',()=>{
    const input=request('xai','grok-future',{context_length:123456,capabilities:{reasoning_effort:['low','future'],default_reasoning_effort:'low'}});
    expect(input.model.reasoning?.levels).toEqual(['low']);expect(input.model.contextWindow).toBe(123456);
    input.reasoning='high';expect(()=>cloudBody(input)).toThrow();input.reasoning='low';expect(cloudBody(input)).toMatchObject({reasoning:{effort:'low'}});
    const deep=request('deepseek','deepseek-future',{context_window:12345,max_output_tokens:4096,effort:{supported_levels:['low','max'],default_level:'low'}});
    expect(deep.model.reasoning?.levels).toEqual(['none','low','max']);expect(deep.model.details.maxOutputTokens).toBe(4096);expect(deep.model.contextWindow).toBe(12345);
  });
  it('honors Anthropic metadata including a model without adaptive thinking',()=>{
    const input=request('anthropic','claude-future',{capabilities:{effort:{supported:true,low:{supported:true},high:{supported:false}},thinking:{types:{adaptive:{supported:false}}}}});
    expect(input.model.reasoning?.levels).toEqual(['low']);input.reasoning='low';expect(cloudBody(input)).toMatchObject({output_config:{effort:'low'}});expect(cloudBody(input)).not.toHaveProperty('thinking');
  });
  it('keeps numeric-only legacy thinking at provider default',()=>{
    const input=request('gemini','gemini-2.5-pro',{},'generateContent');expect(input.model.reasoning?.levels).toEqual([]);
    input.reasoning='low';expect(()=>googleGenerateBody(input)).toThrow(/reasoning/i);
    const legacy=request('anthropic','claude-sonnet-4-5');expect(legacy.model.reasoning?.levels??[]).toEqual([]);
  });
  it('uses the actual Gemini transport and refuses stale incompatible controls',()=>{
    const input=request('gemini','gemini-3.8-flash',{},'generateContent');input.reasoning='medium';
    expect(googleGenerateBody(input)).toMatchObject({generationConfig:{maxOutputTokens:1024,thinkingConfig:{thinkingLevel:'medium'}}});
    const legacy=request('gemini','gemini-2.5-pro');legacy.reasoning='low';expect(cloudBody(legacy)).toMatchObject({generation_config:{thinking_level:'low'}});expect(()=>googleGenerateBody(legacy)).toThrow(/reasoning/i);
  });
  it('rejects explicit DeepSeek thinking when native history is missing',()=>{
    const input=request('deepseek','deepseek-flash');input.tools=[{name:'read',description:'Read',parameters:{type:'object'}}];input.messages.push({role:'assistant',content:'Previous answer'});
    input.reasoning='low';expect(()=>cloudBody(input)).toThrow(/continuation/i);
    input.reasoning='none';expect(cloudBody(input)).toMatchObject({thinking:{type:'disabled'}});
    input.reasoning=undefined;expect(cloudBody(input)).toMatchObject({thinking:{type:'disabled'}});
    input.messages[1].providerData={provider:'deepseek',data:{role:'assistant',content:'Previous answer',reasoning_content:'private-state'}};input.reasoning='high';
    expect(cloudBody(input)).toMatchObject({thinking:{type:'enabled'},reasoning_effort:'high'});expect(JSON.stringify(cloudBody(input))).toContain('private-state');
  });
  it.each([true,false])('discovers Gemini controls for the selected account transport (OAuth=%s)',async oauth=>{
    const gateway=new Providers({secrets:new SecretManager({env:{GEMINI_API_KEY:'test-only'},keyring:null}),fetch:async()=>new Response(JSON.stringify({models:[{name:'models/gemini-2.5-pro'},{name:'models/gemini-3.8-flash'}]}))});
    if(oauth)gateway.setGoogleOAuth({status:async()=>({connected:true,storage:'os-keyring'}),headers:async()=>({authorization:'Bearer test-only'})} as unknown as GoogleOAuth);
    gateway.setEnabled('ollama',false);gateway.setEnabled('lmstudio',false);
    const models=(await gateway.listModels()).filter(model=>model.provider==='gemini');expect(models).toHaveLength(2);
    expect(models[0].details.transport).toBe(oauth?'generateContent':'interactions');expect(models[0].reasoning?.levels).toEqual(oauth?[]:['low','medium','high']);
    expect(models[1].reasoning?.levels).toEqual(['low','medium','high']);
  });
  it.each(['completed','incomplete'] as const)('accounts Gemini thoughts on %s and never dispatches incomplete tools',async status=>{
    const input=request('gemini','gemini-3.8-flash');const values:ModelChunk[]=[];
    const response=new Response(`data: ${JSON.stringify({event_type:status==='incomplete'?'interaction.incomplete':'interaction.completed',interaction:{status,incomplete_details:{reason:'max_output_tokens'},usage:{total_input_tokens:10,total_output_tokens:0,total_thought_tokens:100}}})}\n\n`);
    const run=async()=>{for await(const chunk of geminiStream(response,input))values.push(chunk);};
    if(status==='incomplete')await expect(run()).rejects.toMatchObject({code:'output_limit'});else await run();
    expect(values).toContainEqual({type:'usage',inputTokens:10,outputTokens:100});if(status==='incomplete')expect(values).toHaveLength(1);
  });
  it('does not add cloud reasoning controls to local discovery',()=>{expect(profile('ollama','test').reasoning).toBeUndefined();});
});
