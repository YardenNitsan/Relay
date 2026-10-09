import {randomUUID} from 'node:crypto';
import type {ModelChunk,ModelRequest,ToolRequest} from '../../shared/types.js';
import {rawModelId} from './cloud.js';
import {array,object,string,number,sse,toolArguments,ProviderError,outputLimitError,type JsonObject} from './transport.js';

/** Documented GenerateContent API for OAuth; API-key Interactions remains separate. */
export function googleGeneratePath(request:ModelRequest):string {return `/models/${encodeURIComponent(rawModelId(request))}:streamGenerateContent?alt=sse`;}
export function googleGenerateBody(request:ModelRequest):JsonObject {
  const contents=request.messages.filter(message=>message.role!=='system').map(message=>{
    if(message.role==='assistant'&&message.providerData?.provider==='gemini'){
      const native=object(message.providerData.data);if(native.transport==='generateContent'&&Array.isArray(native.parts))return {role:'model',parts:native.parts};
    }
    if(message.role==='tool'){
      const call=request.messages.flatMap(item=>item.toolCalls??[]).find(item=>item.id===message.toolCallId);
      if(!call)throw new ProviderError('invalid_tool','Gemini tool result has no matching request');
      return {role:'user',parts:[{functionResponse:{name:call.name,id:call.id,response:{result:message.content}}}]};
    }
    return {role:message.role==='assistant'?'model':'user',parts:[...(message.content?[{text:message.content}]:[]),...(message.toolCalls??[]).map(call=>({functionCall:{id:call.id,name:call.name,args:call.arguments}}))]};
  });
  return {contents,systemInstruction:{parts:[{text:request.messages.filter(message=>message.role==='system').map(message=>message.content).join('\n\n')}]},generationConfig:{maxOutputTokens:request.maxOutputTokens},...(request.tools.length?{tools:[{functionDeclarations:request.tools.map(tool=>({name:tool.name,description:tool.description,parametersJsonSchema:tool.parameters}))}]}:{})};
}
export async function* googleGenerateStream(response:Response,request:ModelRequest):AsyncGenerator<ModelChunk> {
  const parts:JsonObject[]=[];let terminal=false;let finishReason='';let stats:JsonObject={};
  for await(const data of sse(response)){
    request.signal.throwIfAborted();if(data.error)throw new ProviderError('provider_failed','Gemini generation failed');
    if(data.usageMetadata)stats=object(data.usageMetadata);
    const candidates=array(data.candidates);if(candidates.length!==1)throw new ProviderError('invalid_stream','Gemini did not return a single candidate');
    const candidate=object(candidates[0]);if(candidate.index!==undefined&&candidate.index!==0)throw new ProviderError('invalid_stream','Unexpected Gemini candidate');
    for(const value of array(object(candidate.content).parts)){
      const part=object(value);parts.push(part);
      if(parts.length>4096)throw new ProviderError('response_limit','Gemini response exceeded part limit');
      if(typeof part.text==='string'&&part.thought!==true)yield {type:'text',text:part.text};
    }
    if(candidate.finishReason){finishReason=string(candidate.finishReason);terminal=true;break;}
  }
  const input=number(stats.promptTokenCount),output=number(stats.candidatesTokenCount),thoughts=number(stats.thoughtsTokenCount)??0;
  if(input!==null&&output!==null)yield {type:'usage',inputTokens:input,outputTokens:output+thoughts};
  if(!terminal)throw new ProviderError('incomplete_stream','Gemini stream ended incomplete; no tools were dispatched');
  if(finishReason==='MAX_TOKENS')throw outputLimitError();
  if(finishReason!=='STOP')throw new ProviderError('incomplete_stream','Gemini generation did not complete; no tools were dispatched');
  const calls:ToolRequest[]=[];const ids=new Set<string>();
  for(const part of parts)if(part.functionCall){const call=object(part.functionCall),name=string(call.name),id=string(call.id)||randomUUID();
    if(!request.tools.some(tool=>tool.name===name)||ids.has(id)||calls.length>=32)throw new ProviderError('invalid_tool','Gemini returned an invalid tool request');ids.add(id);
    calls.push({id,name,arguments:toolArguments(call.args)});part.functionCall={...call,id};
  }
  yield {type:'continuation',providerData:{provider:'gemini',data:{transport:'generateContent',parts}}};
  for(const call of calls)yield {type:'tool_call',call};yield {type:'done',finishReason:calls.length?'tool_calls':'stop'};
}
