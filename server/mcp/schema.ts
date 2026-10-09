import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/client/validators/ajv';
import type { JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/client';
import type { ToolRequest } from '../../shared/types';
import { validateNetworkUrl } from '../tools/network-policy';

export const MCP_PROTOCOL='2026-07-28';
export const mcpServerIdSchema=z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
const nameSchema=z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/);
export const mcpEndpointSchema=z.string().max(2048).transform((value,context)=>{
  try {const origin=new URL(value).origin;const url=validateNetworkUrl(value,{mode:'allow',allowedOrigins:[origin]});if(url.search)throw new Error('MCP endpoint cannot contain a query');return url.href;}
  catch {context.addIssue({code:'custom',message:'MCP requires a public HTTPS443 endpoint without credentials, query or fragment'});return z.NEVER;}
});
export const mcpToolPinSchema=z.object({name:nameSchema,description:z.string().max(2000),inputSchema:z.record(z.string(),z.unknown()),outputSchema:z.record(z.string(),z.unknown()).optional(),schemaHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().refine(value=>{try{return catalogTool(value).schemaHash===value.schemaHash;}catch{return false;}},'Tool catalog schema or fingerprint is invalid');
export const mcpServerSchema=z.object({id:mcpServerIdSchema,name:z.string().min(1).max(80),url:mcpEndpointSchema,enabled:z.boolean(),tools:z.array(mcpToolPinSchema).max(20)}).strict().refine(value=>new Set(value.tools.map(tool=>tool.name)).size===value.tools.length,'Tool pins must be unique');
export const mcpServersSchema=z.array(mcpServerSchema).max(8).refine(value=>new Set(value.map(server=>server.id)).size===value.length,'Server IDs must be unique');
export type McpServerConfig=z.infer<typeof mcpServerSchema>;
export interface McpDiscoveredTool {name:string;description:string;inputSchema:Record<string,unknown>;outputSchema?:Record<string,unknown>;schemaHash:string;}

export function boundedJson(value:unknown,limit=65536):string {
  let nodes=0;
  const walk=(item:unknown,depth:number)=>{
    if(++nodes>4096 || depth>16)throw new Error('MCP JSON structure exceeds limits');
    if(item===null || typeof item==='boolean' || typeof item==='string')return;
    if(typeof item==='number' && Number.isFinite(item))return;
    if(Array.isArray(item)){for(const child of item)walk(child,depth+1);return;}
    if(typeof item!=='object' || (Object.getPrototypeOf(item)!==Object.prototype && Object.getPrototypeOf(item)!==null))throw new Error('MCP requires ordinary JSON data');
    for(const [key,child] of Object.entries(item)){if(['__proto__','constructor','prototype'].includes(key))throw new Error('Unsafe MCP JSON key');walk(child,depth+1);}
  };
  walk(value,0);const json=JSON.stringify(value);if(Buffer.byteLength(json)>limit)throw new Error('MCP JSON exceeds size limit');return json;
}
function noCredentialArguments(value:unknown):void {
  if(typeof value==='string' && /(?:sk-[a-z0-9_-]{12,}|AKIA[A-Z0-9]{12,}|AIza[a-z0-9_-]{20,}|gh[pousr]_[a-z0-9]{12,}|Bearer\s|PRIVATE[ _-]KEY)/i.test(value))throw new Error('Potential credential in MCP arguments');
  if(value && typeof value==='object')for(const [key,child] of Object.entries(value)){if(/(?:token|secret|api.?key|password|passwd|authorization|cookie|credential|signature|session|access.?key)/i.test(key))throw new Error('Credential-shaped MCP arguments are not permitted');noCredentialArguments(child);}
}
export const mcpCallSchema=z.object({serverId:mcpServerIdSchema,tool:nameSchema,arguments:z.record(z.string(),z.unknown())}).strict().refine(value=>{try{boundedJson(value.arguments);noCredentialArguments(value.arguments);return true;}catch{return false;}},'MCP arguments exceed limits or may contain credentials');
export type McpCall=z.infer<typeof mcpCallSchema>;
export function safeMcpRequestForRecord(request:ToolRequest):ToolRequest {
  if(request.name!=='mcp_call' || mcpCallSchema.safeParse(request.arguments).success)return request;
  return {...request,arguments:{serverId:'[redacted]',tool:'blocked',arguments:{}}};
}

function inspectSchema(schema:unknown):void {
  boundedJson(schema,16384);let nodes=0;
  const inspect=(item:unknown,depth:number)=>{
    if(++nodes>256 || depth>10)throw new Error('MCP schema complexity exceeds limits');
    if(!item || typeof item!=='object')return;
    if(Array.isArray(item)){if(item.length>32)throw new Error('MCP schema array exceeds limits');for(const child of item)inspect(child,depth+1);return;}
    for(const [key,child] of Object.entries(item)){
      if(['$ref','$dynamicRef','$recursiveRef','pattern','patternProperties','format','x-mcp-header','contentSchema'].includes(key))throw new Error('MCP schema uses an unsupported reference, pattern or header extension');
      inspect(child,depth+1);
    }
  };inspect(schema,0);
}
// Each compiled validator owns its bounded schema cache; hostile catalog churn must not grow a process-global Ajv cache.
export const safeValidator={getValidator<T>(schema:JsonSchemaType):JsonSchemaValidator<T>{inspectSchema(schema);return new AjvJsonSchemaValidator().getValidator<T>(schema);}};
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function catalogTool(value:unknown):McpDiscoveredTool {
  const tool=z.object({name:nameSchema,description:z.string().max(2000).optional(),inputSchema:z.record(z.string(),z.unknown()),outputSchema:z.record(z.string(),z.unknown()).optional()}).parse(value);
  if(tool.inputSchema.type!=='object')throw new Error('MCP input schema must describe an object');
  safeValidator.getValidator(tool.inputSchema);if(tool.outputSchema)safeValidator.getValidator(tool.outputSchema);
  const pin={name:tool.name,description:tool.description??'',inputSchema:tool.inputSchema,...(tool.outputSchema?{outputSchema:tool.outputSchema}:{})};
  return {...pin,schemaHash:createHash('sha256').update(JSON.stringify(canonical(pin))).digest('hex')};
}
