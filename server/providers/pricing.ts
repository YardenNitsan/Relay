import type {ModelProfile} from '../../shared/types.js';

const checkedAt='2026-10-10T00:00:00.000Z';
const expiresAt='2026-11-09T00:00:00.000Z';
const googleSource='https://ai.google.dev/gemini-api/docs/pricing';
const claudeSource='https://platform.claude.com/docs/en/about-claude/pricing';
const deepseekSource='https://api-docs.deepseek.com/quick_start/pricing/';
interface PublishedPrice {input:number;output:number;url:string;basis?:string;}
const openai=(id:string,input:number,output:number):PublishedPrice=>({input,output,url:`https://developers.openai.com/api/docs/models/${id}`});
const openaiCached=(id:string,input:number,output:number):PublishedPrice=>({...openai(id,input,output),basis:'Conservative input rate includes the documented 1.25x prompt cache-write rate; ordinary input may cost less.'});

// This is pricing evidence, not model discovery. Never export it as an available
// model catalog or infer a snapshot/family's price from any of these exact IDs.
const published:Readonly<Record<string,PublishedPrice>>=Object.freeze({
  'openai/gpt-6-astra':openaiCached('gpt-6-astra',12.5,50),
  'openai/gpt-6.1-sol':openaiCached('gpt-6.1-sol',2.5,10),
  'openai/gpt-6-sol':openaiCached('gpt-6-sol',2.5,10),
  'openai/gpt-6-luna':openaiCached('gpt-6-luna',0.125,0.5),
  'openai/gpt-5.4':openai('gpt-5.4',2.5,15),
  'openai/gpt-5-mini':openai('gpt-5-mini',0.25,2),
  'openai/gpt-4.1-mini':openai('gpt-4.1-mini',0.4,1.6),
  'anthropic/claude-sonnet-5-5':{input:2,output:10,url:claudeSource},
  'anthropic/claude-haiku-5-5':{input:0.5,output:2.5,url:claudeSource,basis:'Conservative upper standard rate: includes prompts over 100,000 tokens.'},
  'gemini/gemini-3.6-flash':{input:0.75,output:3.75,url:googleSource,basis:'Standard introductory rates through 2026-12-31; this evidence expires earlier.'},
  'gemini/gemini-3.5-flash-lite':{input:0.3,output:2.5,url:googleSource},
  'gemini/gemini-3.1-flash-lite':{input:0.25,output:1.5,url:googleSource},
  'gemini/gemini-2.5-flash':{input:0.3,output:2.5,url:googleSource},
  'gemini/gemini-2.5-flash-lite':{input:0.1,output:0.4,url:googleSource},
  'xai/grok-4.7':{input:2,output:6,url:'https://docs.x.ai/developers/models'},
  'deepseek/deepseek-flash':{input:0.3,output:1.2,url:deepseekSource,basis:'Conservative peak-hour, cache-miss rates; off-peak discounts are not assumed.'},
  'deepseek/deepseek-v4-pro':{input:1.32,output:3.96,url:deepseekSource,basis:'Conservative peak-hour, cache-miss rates; off-peak discounts are not assumed.'},
});

function valid(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>=0;}
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}

/** Conservative USD estimates for Relay's standard text-only transport, not an
 * invoice or a discovery mechanism. Apply on every catalog read so a cached
 * profile cannot retain expired published rates. Provider metadata takes priority.
 * Changes to caching, tiers, modalities, hosted tools or the context ceiling must
 * revisit this pricing scope before relying on it for a spending reservation. */
export function enrichPricing(model:ModelProfile,now:number=Date.now()):ModelProfile{
  if(model.local||model.provider==='ollama'||model.provider==='lmstudio')return model;
  const previous=record(model.details.pricing);
  const owned=previous.source==='published'?record(previous.fields):{};
  const input=owned.input===true?null:valid(model.inputPricePerMillion)?model.inputPricePerMillion:null;
  const output=owned.output===true?null:valid(model.outputPricePerMillion)?model.outputPricePerMillion:null;
  const price=model.id.startsWith(`${model.provider}/`)?published[model.id]:undefined;
  const fresh=Number.isFinite(now)&&now>=Date.parse(checkedAt)&&now<Date.parse(expiresAt);
  if(input!==null&&output!==null)return {...model,inputPricePerMillion:input,outputPricePerMillion:output};
  if(!price)return {...model,inputPricePerMillion:input,outputPricePerMillion:output};
  const fields={input:input===null,output:output===null};
  return {
    ...model,inputPricePerMillion:input??(fresh?price.input:null),outputPricePerMillion:output??(fresh?price.output:null),
    details:{...model.details,pricing:{
      source:'published',status:fresh?'current':'expired',estimate:true,currency:'USD',unit:'per-million-tokens',
      url:price.url,checkedAt,expiresAt,fields,scope:'standard-text',maxContextTokens:131072,
      basis:price.basis??'Standard uncached text rates; cache discounts are not assumed.',
      limitations:'Estimated token cost, not a provider invoice. No explicit cache writes, premium service tiers, regional surcharges, hosted tools or non-text modalities. Provider billing and tokenization may differ.',
    }},
  };
}
