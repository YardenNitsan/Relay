import type {ModelMessage,ToolRequest} from '../../shared/types.js';
import {boundedReceipt} from './receipts.js';

function structured(content:string):Record<string,unknown>|null {
  try{const value:unknown=JSON.parse(content);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return null;}
}

/** Eligible only when a later structured result supersedes exactly this read or
 * command. Exact tool proposals and all identity/outcome metadata stay intact. */
export function supersededReceiptIndexes(messages:ModelMessage[]):number[]{
  // Opaque vendor continuity may bind more than its adjacent call. Leave the
  // complete transcript unchanged rather than guessing that contract.
  if(messages.some(message=>message.providerData))return [];
  const actions=new Map<string,{request:ToolRequest;index:number;opaque:boolean}>(),ambiguous=new Set<string>(),results=new Set<string>();
  for(const [index,message] of messages.entries())for(const request of message.role==='assistant'?message.toolCalls??[]:[]){
    if(actions.has(request.id))ambiguous.add(request.id);
    actions.set(request.id,{request,index,opaque:!!message.providerData});
  }
  for(const message of messages)if(message.role==='tool'&&message.toolCallId){if(results.has(message.toolCallId))ambiguous.add(message.toolCallId);results.add(message.toolCallId);}
  const latest=new Map<string,number>(),superseded:number[]=[];
  for(const [index,message] of messages.entries()){
    if(message.role!=='tool'||!message.toolCallId||message.providerData||ambiguous.has(message.toolCallId))continue;
    const action=actions.get(message.toolCallId);if(!action||action.index>=index||action.opaque)continue;
    const {request}=action,value=structured(message.content);if(!value)continue;
    const read=request.name==='file_read'&&typeof request.arguments.path==='string'&&value.path===request.arguments.path&&typeof value.content==='string'&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256);
    const command=request.name==='terminal'&&Array.isArray(request.arguments.argv)&&Number.isInteger(value.exitCode)&&typeof value.stdout==='string'&&typeof value.stderr==='string';
    if(!read&&!command)continue;
    const key=`${request.name}:${JSON.stringify(request.arguments)}`,previous=latest.get(key);
    if(previous!==undefined)superseded.push(previous);latest.set(key,index);
  }
  return superseded.sort((a,b)=>a-b);
}

export function shortenSupersededReceipt(message:ModelMessage,maxBytes=512):ModelMessage {
  const before=structured(message.content);if(!before)return message;
  const content=boundedReceipt(message.content,maxBytes),after=structured(content);if(!after||Buffer.byteLength(content)>=Buffer.byteLength(message.content))return message;
  // boundedReceipt also supports listings. Do not allow its list shortening to
  // remove metadata from these execution receipts, including unknown fields.
  for(const [key,value] of Object.entries(before))if(!['content','stdout','stderr','truncated'].includes(key)&&JSON.stringify(value)!==JSON.stringify(after[key]))return message;
  return {...message,content};
}
