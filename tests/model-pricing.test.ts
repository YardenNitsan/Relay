import {describe,expect,it} from 'vitest';
import {profile} from '../server/providers/registry.js';
import {enrichPricing} from '../server/providers/pricing.js';

const now=Date.parse('2026-10-10T12:00:00Z');
describe('published cloud pricing enrichment',()=>{
  it.each([
    ['openai','gpt-6-luna',0.125,0.5],
    ['anthropic','claude-sonnet-5-5',2,10],
    ['gemini','gemini-2.5-flash',0.3,2.5],
    ['xai','grok-4.7',2,6],
    ['deepseek','deepseek-flash',0.3,1.2],
  ] as const)('adds exact %s prices without changing model eligibility', (provider,id,input,output)=>{
    const model=profile(provider,id);model.state='offline';
    const priced=enrichPricing(model,now);
    expect(priced).toMatchObject({id:model.id,state:'offline',inputPricePerMillion:input,outputPricePerMillion:output});
    expect(priced.details.pricing).toMatchObject({source:'published',checkedAt:'2026-10-10T00:00:00.000Z',expiresAt:'2026-11-09T00:00:00.000Z',currency:'USD',scope:'standard-text',maxContextTokens:131072});
    expect(model.inputPricePerMillion).toBeNull();
  });
  it('preserves finite provider metadata, including zero, and its provenance',()=>{
    const model=profile('openai','gpt-6-luna');model.inputPricePerMillion=0;model.outputPricePerMillion=7;model.details.pricing={source:'provider',custom:true};
    expect(enrichPricing(model,now)).toEqual(model);
  });
  it('fills only the missing rate and retains a provider-supplied rate after expiry',()=>{
    const model=profile('openai','gpt-6-luna');model.inputPricePerMillion=4;
    const priced=enrichPricing(model,now);
    expect(priced).toMatchObject({inputPricePerMillion:4,outputPricePerMillion:0.5});
    expect(enrichPricing(priced,Date.parse('2026-11-09T00:00:00Z'))).toMatchObject({inputPricePerMillion:4,outputPricePerMillion:null});
  });
  it('rejects unknown names, inferred snapshots, wrong provider prefixes and local forwarding',()=>{
    for(const id of ['gpt-6-luna-2026-10-01','gpt-6-luna-pro','Gpt-6-luna','unknown'])expect(enrichPricing(profile('openai',id),now).inputPricePerMillion).toBeNull();
    const mismatch=profile('openai','gpt-6-luna');mismatch.provider='anthropic';
    expect(enrichPricing(mismatch,now).inputPricePerMillion).toBeNull();
    expect(enrichPricing(profile('ollama','gpt-6-luna'),now).inputPricePerMillion).toBeNull();
  });
  it('makes expired, future-dated and invalid-clock published estimates unknown',()=>{
    const model=profile('gemini','gemini-2.5-flash');
    for(const date of ['2026-11-09T00:00:00Z','2026-10-09T23:59:59Z','invalid'])expect(enrichPricing(model,Date.parse(date)).inputPricePerMillion).toBeNull();
    const priced=enrichPricing(model,now);
    const expired=enrichPricing(priced,Date.parse('2026-11-10T00:00:00Z'));
    expect(expired).toMatchObject({inputPricePerMillion:null,outputPricePerMillion:null});
    expect(expired.details.pricing).toMatchObject({status:'expired'});
  });
  it('clears invalid rates without interpreting unknown prices as free',()=>{
    const model=profile('openai','unknown');model.inputPricePerMillion=NaN;model.outputPricePerMillion=-1;
    expect(enrichPricing(model,now)).toMatchObject({inputPricePerMillion:null,outputPricePerMillion:null});
    model.inputPricePerMillion=Infinity;
    expect(enrichPricing(model,now).inputPricePerMillion).toBeNull();
  });
  it('uses conservative long-prompt and peak rates where billing has multiple tiers',()=>{
    expect(enrichPricing(profile('anthropic','claude-haiku-5-5'),now)).toMatchObject({inputPricePerMillion:0.5,outputPricePerMillion:2.5});
    expect(enrichPricing(profile('deepseek','deepseek-v4-pro'),now)).toMatchObject({inputPricePerMillion:1.32,outputPricePerMillion:3.96});
  });
});
