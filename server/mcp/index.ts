import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createHash } from 'node:crypto';
import type { ToolContext,ToolDecision,ToolRequest,ToolResult } from '../../shared/types';
import { validateNetworkUrl } from '../tools/network-policy';
import { UncertainToolEffect } from '../tools/errors';
import { utf8Excerpt } from '../core/text';
import { PinnedMcpSession } from './transport';
import { MCP_PROTOCOL,boundedJson,catalogTool,mcpCallSchema,mcpEndpointSchema,mcpServersSchema,safeValidator,type McpDiscoveredTool,type McpServerConfig } from './schema';
export { MCP_PROTOCOL,mcpServerSchema,mcpServersSchema,mcpEndpointSchema,mcpServerIdSchema,safeMcpRequestForRecord } from './schema';
export type { McpServerConfig,McpDiscoveredTool } from './schema';
type McpContext=ToolContext&{mcpServerIds?:string[]};

export class McpRegistry {
  private servers=new Map<string,McpServerConfig>();
  private readonly active=new Set<{serverId:string|undefined;controller:AbortController}>();
  configure(input:McpServerConfig[]):void {
    const configs=mcpServersSchema.parse(input);const next=new Map(configs.map(config=>[config.id,config]));
    for(const run of this.active)if(run.serverId && JSON.stringify(this.servers.get(run.serverId))!==JSON.stringify(next.get(run.serverId)))run.controller.abort();
    this.servers=next;
  }
  configurations():McpServerConfig[] {return structuredClone([...this.servers.values()]);}
  authorizationScope(request:ToolRequest):string|undefined {
    const parsed=mcpCallSchema.safeParse(request.arguments);if(!parsed.success)return undefined;
    const server=this.servers.get(parsed.data.serverId);if(!server)return undefined;
    return createHash('sha256').update(JSON.stringify(server)).digest('hex');
  }
  agentCatalog(serverIds:string[]):Array<{serverId:string;name:string;url:string;tools:McpDiscoveredTool[];trust:'untrusted'}> {
    return this.configurations().filter(server=>server.enabled && serverIds.includes(server.id)).map(server=>({serverId:server.id,name:server.name,url:server.url,tools:server.tools,trust:'untrusted' as const}));
  }
  stopAll():void {for(const run of this.active)run.controller.abort();}
  decide(context:McpContext,request:ToolRequest):ToolDecision {
    const deny=(reason:string):ToolDecision=>({decision:'deny',risk:'execute',reason});
    if(context.signal.aborted)return deny('Task was cancelled');
    if(!context.taskId || !context.agentId || !context.allowedTools.includes('mcp_call') || request.name!=='mcp_call')return deny('Agent has no external-tool capability');
    const parsed=mcpCallSchema.safeParse(request.arguments);if(!parsed.success)return deny('Invalid external-tool arguments or potential credential egress');
    const server=this.servers.get(parsed.data.serverId);
    if(!server?.enabled || !context.mcpServerIds?.includes(server.id))return deny('MCP server is disabled or outside the task grant');
    if(!server.tools.some(tool=>tool.name===parsed.data.tool))return deny('External tool is outside the owner-pinned catalog');
    try{validateNetworkUrl(server.url,context.network);}catch{return deny('MCP endpoint is outside the separate network grant');}
    if(!context.approved)return {decision:'approval',risk:'execute',reason:`External MCP operation on ${server.name} (${server.url}) requires approval for this exact call; remote side effects cannot be inferred from tool annotations`};
    if(!context.approvalAuthority || context.approvalAuthority!==this.authorizationScope(request))return deny('MCP configuration changed or approval is unbound; request a new approval for the current endpoint and catalog');
    return {decision:'allow',risk:'execute',reason:'Exact external MCP call approved within owner-pinned tool, task-server and network grants'};
  }
  async discover(url:string,signal:AbortSignal):Promise<McpDiscoveredTool[]> {
    return this.run(mcpEndpointSchema.parse(url),undefined,signal,async(client,sessionSignal)=>this.catalog(client,sessionSignal));
  }
  async execute(context:McpContext,request:ToolRequest):Promise<ToolResult> {
    const decision=this.decide(context,request);if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
    const call=mcpCallSchema.parse(request.arguments);const server=this.servers.get(call.serverId)!;
    return this.run(server.url,server.id,context.signal,async(client,signal)=>{
      const catalog=await this.catalog(client,signal);signal.throwIfAborted();
      const tool=catalog.find(item=>item.name===call.tool);const pinned=server.tools.find(item=>item.name===call.tool)!;
      if(!tool || tool.schemaHash!==pinned.schemaHash)throw new Error('MCP tool catalog changed; owner must inspect and pin the new definition');
      const validation=safeValidator.getValidator(tool.inputSchema)(call.arguments);
      if(!validation.valid)throw new Error('MCP tool arguments do not match the pinned schema');
      const result=await client.callTool({name:call.tool,arguments:call.arguments},{signal,timeout:25_000,maxTotalTimeout:25_000});
      signal.throwIfAborted();
      if(result.isError)throw new Error('External MCP server reported a tool error; side effects require inspection');
      boundedJson(result,512*1024);
      const text=result.content.filter(item=>item.type==='text').map(item=>item.text).join('\n');
      const structured=result.structuredContent===undefined?'':boundedJson(result.structuredContent,512*1024);
      const combined=[text,structured].filter(Boolean).join('\n');
      const excerpt=utf8Excerpt(combined,16384);
      const omittedContentTypes=[...new Set(result.content.filter(item=>item.type!=='text').map(item=>item.type))];
      return {content:JSON.stringify({serverId:server.id,tool:call.tool,schemaHash:tool.schemaHash,content:excerpt.text,truncated:excerpt.truncated,omittedContentTypes,trust:'untrusted'}),evidence:[{kind:'mcp_response',summary:`Received an untrusted response from external tool ${call.tool}; this is not host verification`,passed:true,details:{serverId:server.id,tool:call.tool,schemaHash:tool.schemaHash,trust:'untrusted'}}]};
    });
  }
  private async catalog(client:Client,signal:AbortSignal):Promise<McpDiscoveredTool[]> {
    const result=await client.listTools(undefined,{signal,timeout:25_000,maxTotalTimeout:25_000});
    if(result.tools.length>50)throw new Error('MCP catalog exceeds the 50-tool inspection limit');
    const tools=result.tools.map(catalogTool);if(new Set(tools.map(tool=>tool.name)).size!==tools.length)throw new Error('Duplicate MCP tool names');return tools;
  }
  private async run<T>(url:string,serverId:string|undefined,taskSignal:AbortSignal,operation:(client:Client,signal:AbortSignal)=>Promise<T>):Promise<T> {
    const controller=new AbortController();const run={serverId,controller};this.active.add(run);
    const timeout=setTimeout(()=>controller.abort(),30_000);timeout.unref();const signal=AbortSignal.any([controller.signal,taskSignal]);
    const session=new PinnedMcpSession(url,signal);
    const client=new Client({name:'Relay',version:'0.1.1'},{capabilities:{},versionNegotiation:{mode:{pin:MCP_PROTOCOL},probe:{maxRetries:0,timeoutMs:10_000}},inputRequired:{autoFulfill:false,maxRounds:0},listMaxPages:3,jsonSchemaValidator:safeValidator});
    const transport=new StreamableHTTPClientTransport(new URL(url),{fetch:session.fetch,requestInit:{redirect:'error'},reconnectionOptions:{maxRetries:0,maxReconnectionDelay:0,initialReconnectionDelay:0,reconnectionDelayGrowFactor:1},onInsufficientScope:'throw',maxStepUpRetries:0});
    const abort=()=>{void client.close().catch(()=>undefined);};signal.addEventListener('abort',abort,{once:true});
    try {signal.throwIfAborted();await client.connect(transport,{signal,timeout:10_000,maxTotalTimeout:10_000});signal.throwIfAborted();return await operation(client,signal);}
    catch(error){if(session.dispatchedTool)throw new UncertainToolEffect(error,'external');throw error;}
    finally{clearTimeout(timeout);signal.removeEventListener('abort',abort);controller.abort();await client.close().catch(()=>undefined);this.active.delete(run);}
  }
}
