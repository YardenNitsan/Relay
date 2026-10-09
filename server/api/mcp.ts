import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import type { Principal } from '../auth/policy.js';
import type { McpRegistry } from '../mcp/registry.js';
import { MCP_PROTOCOL,mcpEndpointSchema,mcpServersSchema } from '../mcp/schema.js';
import { AppError } from '../core/errors.js';

const initialized=new WeakSet<McpRegistry>();
export async function mcpRoutes(app:FastifyInstance,store:Store,registry:McpRegistry,principal:(request:FastifyRequest)=>Principal,owner:(request:FastifyRequest)=>unknown) {
  if(!initialized.has(registry)){
    const saved=(await store.db.query('SELECT value FROM settings WHERE key=$1',['mcp_servers']))[0];
    registry.configure(saved?mcpServersSchema.parse(saved.value):[]);initialized.add(registry);
  }
  const state=()=>({servers:registry.configurations(),protocol:MCP_PROTOCOL,transport:'public_https'});
  app.get('/api/mcp/servers',async request=>{owner(request);return state();});
  app.get('/api/mcp/available',async request=>{
    const actor=principal(request);const localOwner=actor.user.role==='owner'&&!actor.remote;
    return {servers:registry.configurations().filter(server=>server.enabled&&(localOwner||actor.user.permissions.mcpServerIds?.includes(server.id))).map(({id,name,url})=>({id,name,url}))};
  });
  let discoveryActive=false;
  app.post('/api/mcp/discover',async request=>{
    owner(request);const {url}=z.object({url:mcpEndpointSchema}).strict().parse(request.body);
    if(discoveryActive)throw new AppError('MCP_BUSY','A tool-server discovery is already running.',429);
    discoveryActive=true;
    try{const tools=await registry.discover(url,AbortSignal.timeout(30000));await store.audit(null,'MCP_DISCOVERED',{url,tools:tools.map(tool=>({name:tool.name,schemaHash:tool.schemaHash}))});return {tools};}
    finally{discoveryActive=false;}
  });
  let saving=false;
  app.put('/api/mcp/servers',async request=>{
    owner(request);const {servers}=z.object({servers:mcpServersSchema}).strict().parse(request.body);
    if(saving)throw new AppError('MCP_BUSY','Another tool-server configuration is being saved.',409);
    saving=true;
    try{
      await store.db.transaction(async tx=>{await tx.query('INSERT INTO settings(key,value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',['mcp_servers',JSON.stringify(servers)]);await tx.query('INSERT INTO audit_events(operation,metadata) VALUES ($1,$2)',['MCP_CONFIGURATION_CHANGED',JSON.stringify({servers:servers.map(server=>({id:server.id,url:server.url,enabled:server.enabled,tools:server.tools.map(tool=>tool.name)}))})]);});
      registry.configure(servers);return state();
    }finally{saving=false;}
  });
}
