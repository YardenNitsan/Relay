import type {ModelProfile,ModelMessage,ProviderId,ToolDefinition} from '../../shared/types.js';
import {reasoningEfforts,type ReasoningControls,type ReasoningEffort} from '../../shared/model-controls.js';
import {array,object,ProviderError,string,type JsonObject} from './transport.js';

export type GeminiTransport='interactions'|'generateContent';
const sources={
  anthropic:'https://platform.claude.com/docs/en/build-with-claude/effort',
  gemini:'https://ai.google.dev/gemini-api/docs/thinking',
  generate:'https://ai.google.dev/gemini-api/docs/generate-content/thinking',
  xai:'https://docs.x.ai/developers/model-capabilities/text/reasoning',
  deepseek:'https://api-docs.deepseek.com/guides/thinking_mode/',
};
const levels=(value:unknown):ReasoningEffort[]=>reasoningEfforts.filter(level=>array(value).includes(level));
function controls(values:ReasoningEffort[],source:string,mode:ReasoningControls['mode']='effort',defaultLevel?:ReasoningEffort):ReasoningControls {
  return {levels:values,source,mode,...(defaultLevel&&values.includes(defaultLevel)?{defaultLevel}:{})};
}
const lowHigh:ReasoningEffort[]=['low','medium','high'];
const geminiModels:Record<string,{levels:ReasoningEffort[];defaultLevel?:ReasoningEffort}>={
  'gemini-3.8-flash':{levels:lowHigh,defaultLevel:'medium'},
  'gemini-3.6-flash':{levels:['minimal',...lowHigh],defaultLevel:'medium'},
  'gemini-3.5-flash-lite':{levels:['minimal',...lowHigh],defaultLevel:'minimal'},
  'gemini-3.1-pro-preview':{levels:lowHigh,defaultLevel:'high'},
  'gemini-3-flash-preview':{levels:['minimal',...lowHigh],defaultLevel:'high'},
  'gemini-3-pro-preview':{levels:['low','high'],defaultLevel:'high'},
  'gemini-2.5-pro':{levels:lowHigh},'gemini-2.5-flash':{levels:lowHigh},'gemini-2.5-flash-lite':{levels:lowHigh},
};

/** Exact documented models are fallbacks; returned capability metadata takes precedence.
 * Sources checked 2026-10-10. Unknown variants deliberately retain provider defaults. */
export function reasoningControls(provider:ProviderId,id:string,metadata:JsonObject={},transport:GeminiTransport='interactions'):ReasoningControls|undefined {
  const capabilities=object(metadata.capabilities);
  if(provider==='openai'){
    let supported:ReasoningEffort[]|undefined;
    if(['gpt-6-astra','gpt-6.1-sol'].includes(id))supported=[...lowHigh,'xhigh','max'];
    else if(['gpt-6-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna'].includes(id))supported=['none',...lowHigh,'xhigh','max'];
    else if(id==='gpt-5.4')supported=['none',...lowHigh,'xhigh'];
    else if(id==='gpt-5.1')supported=['none',...lowHigh];
    else if(id==='gpt-5')supported=['minimal',...lowHigh];
    return supported?controls(supported,`https://developers.openai.com/api/docs/models/${id}`):undefined;
  }
  if(provider==='gemini'){
    if(metadata.thinking===false)return controls([],'https://ai.google.dev/api/models — provider reports thinking unsupported','gemini-level');
    if(transport==='generateContent'&&/^gemini-2\.5-/.test(id))return controls([],`${sources.generate} — numeric thinking budgets only; Relay retains provider default`,'gemini-budget');
    const entry=geminiModels[id];return entry?controls([...entry.levels],transport==='generateContent'?sources.generate:sources.gemini,'gemini-level',entry.defaultLevel):undefined;
  }
  if(provider==='xai'){
    if(Array.isArray(capabilities.reasoning_effort))return controls(levels(capabilities.reasoning_effort).filter(level=>['low','medium','high','xhigh'].includes(level)),'https://docs.x.ai/developers/rest-api-reference/inference/models','effort',string(capabilities.default_reasoning_effort) as ReasoningEffort);
    if(['grok-4.6','grok-4.7'].includes(id))return controls([...lowHigh,'xhigh'],sources.xai,'effort','high');
    if(id==='grok-4.5')return controls([...lowHigh],sources.xai,'effort','high');
    return undefined;
  }
  if(provider==='deepseek'){
    const effort=object(metadata.effort);
    if(Array.isArray(effort.supported_levels))return controls(['none',...levels(effort.supported_levels).filter(level=>['low','high','max'].includes(level))],'https://api-docs.deepseek.com/api/list-models/','deepseek',string(effort.default_level) as ReasoningEffort);
    if(['deepseek-flash','deepseek-v4-pro','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(id))return controls(['none','low','high','max'],sources.deepseek,'deepseek','high');
    return undefined;
  }
  if(provider==='anthropic'){
    const effort=object(capabilities.effort),thinking=object(capabilities.thinking),types=object(thinking.types);
    if(Object.keys(effort).length){
      const supported=effort.supported===false?[]:reasoningEfforts.filter(level=>level!=='none'&&level!=='minimal'&&object(effort[level]).supported===true);
      if(object(types.disabled).supported===true)supported.unshift('none');
      return controls(supported,'https://platform.claude.com/docs/en/api/models/retrieve',object(types.adaptive).supported===true?'anthropic-adaptive':'effort');
    }
    if(id==='claude-opus-4-5')return controls([...lowHigh],sources.anthropic,'effort','high');
    if(['claude-opus-4-6','claude-sonnet-4-6'].includes(id))return controls(['none',...lowHigh,'max'],sources.anthropic,'anthropic-adaptive','high');
    if(['claude-opus-4-7','claude-opus-4-8','claude-opus-5','claude-opus-5-5','claude-sonnet-5','claude-sonnet-5-5','claude-haiku-5-5','claude-fable-5','claude-fable-5-1','claude-mythos-5','claude-mythos-5-1','claude-mythos-preview'].includes(id)){
      // Only explicitly documented off modes are offered. between_tools is not off.
      const off=['claude-opus-5','claude-haiku-5-5'].includes(id);
      return controls([...(off?['none' as const]:[]),...lowHigh,'xhigh','max'],sources.anthropic,'anthropic-adaptive',['claude-opus-5-5','claude-haiku-5-5'].includes(id)?'medium':'high');
    }
    if(/^claude-(?:sonnet|opus|haiku)-/.test(id))return controls([],`${sources.anthropic} — model-specific controls unknown; Relay retains provider default`);
  }
  return undefined;
}

export function validateReasoning(model:ModelProfile,effort:ReasoningEffort|undefined,maxOutputTokens:number):void {
  validateSupportedReasoning(model,effort);
  if(effort===undefined)return;
  if(!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1)throw new ProviderError('reasoning_budget','Reasoning requires a positive output-token allowance.');
}
function validateSupportedReasoning(model:ModelProfile,effort:ReasoningEffort|undefined):void {
  if(effort===undefined)return;
  if(model.local||!model.reasoning?.levels.includes(effort))throw new ProviderError('unsupported_reasoning',`Reasoning setting ${effort} is not supported for ${model.id}. Select provider default or a supported setting.`);
  if(model.reasoning.mode==='anthropic-budget'||model.reasoning.mode==='gemini-budget')throw new ProviderError('unsupported_reasoning','Numeric reasoning budgets are not exposed by this adapter. Select provider default.');
}

/** Pure pre-dispatch validation: call before approval, call-count or cost reservation.
 * This helper never silently changes a requested effort; Auto policy belongs to orchestration. */
export function preflightReasoning(model:ModelProfile,effort:ReasoningEffort|undefined,messages:ModelMessage[],tools:ToolDefinition[]):ReasoningEffort|undefined {
  validateSupportedReasoning(model,effort);
  if(model.provider==='deepseek'&&effort!==undefined&&effort!=='none'&&tools.length&&messages.some(message=>message.role==='assistant'&&(message.providerData?.provider!=='deepseek'||typeof object(message.providerData.data).reasoning_content!=='string'))){
    throw new ProviderError('reasoning_continuation','The selected DeepSeek reasoning setting requires original private continuation for every assistant turn. Start a new conversation or select reasoning off.');
  }
  return effort;
}

/** Adapter transport validation also catches a credential transport change after selection. */
export function validateGeminiReasoning(model:ModelProfile,effort:ReasoningEffort|undefined,maxOutputTokens:number,transport:GeminiTransport):void {
  validateReasoning(model,effort,maxOutputTokens);
  if(effort===undefined)return;
  const id=model.id.replace(/^gemini\//,'');const supported=reasoningControls('gemini',id,{},transport);
  if(!supported?.levels.includes(effort))throw new ProviderError('unsupported_reasoning','This Gemini transport does not support the selected reasoning setting. Select provider default.');
}
