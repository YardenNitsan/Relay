import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';
import { ToolBroker } from '../server/tools/index.js';
import { HostFileBroker } from '../server/tools/host-files.js';
import { PublicHttpClient } from '../server/tools/http.js';
import { McpRegistry } from '../server/mcp/index.js';
import { catalogTool } from '../server/mcp/schema.js';
import type { TaskOptions, ToolContext, ToolRequest } from '../shared/types.js';

let store: Store, broker: ToolBroker, directory: string, registry: McpRegistry;
const receipt = { content: 'downstream fixture', evidence: [] };
const options: TaskOptions = { depth: 'fast', modelId: null, workspaceId: null, access: 'unrestricted', hostAccessConfirmed: true, contextTokens: 4096, network: { mode: 'allow', allowedOrigins: ['https://example.com'] }, mcpServerIds: ['docs'], budget: { maxCalls: 4, maxSeconds: 60, maxIterations: 2, maxCostUsd: 0, localOnly: true } };
const requests: Record<string, ToolRequest> = {
  host_write: { id: 'host', name: 'host_write', arguments: { path: 'C:/authorized-test/note.txt', content: 'test', expectedHash: null } },
  http_get: { id: 'http', name: 'http_get', arguments: { url: 'https://example.com/info' } },
  mcp_call: { id: 'mcp', name: 'mcp_call', arguments: { serverId: 'docs', tool: 'lookup', arguments: {} } },
};
beforeEach(async () => {
  store = new Store(await openDatabase()); await store.init();
  directory = await mkdtemp(join(tmpdir(), 'relay-authorization-'));
  registry = new McpRegistry();
  registry.configure([{ id: 'docs', name: 'Docs', url: 'https://example.com/mcp', enabled: true, tools: [catalogTool({ name: 'lookup', inputSchema: { type: 'object', properties: {}, additionalProperties: false } })] }]);
  broker = new ToolBroker(directory, () => false, registry, store);
  vi.spyOn(HostFileBroker.prototype, 'execute').mockResolvedValue(receipt);
  vi.spyOn(PublicHttpClient.prototype, 'get').mockResolvedValue(receipt);
  vi.spyOn(registry, 'execute').mockResolvedValue(receipt);
});
afterEach(async () => { vi.restoreAllMocks(); await broker.stopAll(); await store.close(); await rm(directory, { recursive: true, force: true }); });
async function context(): Promise<ToolContext> {
  const conversation = await store.createConversation();
  const { task } = await store.createTask(conversation.id, 'Authorized tool operation', options);
  await store.db.query("UPDATE tasks SET status='executing' WHERE id=$1", [task.id]);
  return { taskId: task.id, agentId: 'controller-issued-agent', userId: 'owner', sessionVersion: 0, workspaceId: null, access: 'unrestricted', hostAccess: true, network: options.network, mcpServerIds: options.mcpServerIds, allowedTools: Object.keys(requests), signal: new AbortController().signal, approved: true, approvalAuthority: registry.authorizationScope(requests.mcp_call) };
}
function expectNoDispatch() {
  expect(HostFileBroker.prototype.execute).not.toHaveBeenCalled();
  expect(PublicHttpClient.prototype.get).not.toHaveBeenCalled();
  expect(registry.execute).not.toHaveBeenCalled();
}

describe('durable authorization at consequential broker boundaries', () => {
  it.each(Object.keys(requests))('rejects %s after its overall task deadline before dispatch', async name => {
    const scope = await context();
    await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{budget,maxElapsedSeconds}','30'),created_at=now()-interval '31 seconds' WHERE id=$1", [scope.taskId]);
    await expect(broker.execute(scope, requests[name])).rejects.toThrow(/deadline/i);
    expectNoDispatch();
  });
  it.each(Object.keys(requests))('dispatches an authorized %s operation', async name => {
    await expect(broker.execute(await context(), requests[name])).resolves.toEqual(receipt);
  });
  it.each(Object.keys(requests))('rejects %s after account revocation before downstream dispatch', async name => {
    const scope = await context();
    await store.db.query("UPDATE users SET session_version=session_version+1 WHERE id='owner'");
    await expect(broker.execute(scope, requests[name])).rejects.toThrow(/revoked/i);
    expectNoDispatch();
  });
  it.each(['disabled', 'stopped', 'cancelled', 'wrong_owner'] as const)('rejects all consequential tools when authority is %s', async reason => {
    const scope = await context();
    if (reason === 'disabled') await store.db.query("UPDATE users SET enabled=false WHERE id='owner'");
    if (reason === 'stopped') await store.setStopped(true);
    if (reason === 'cancelled') await store.db.query("UPDATE tasks SET status='cancelled' WHERE id=$1", [scope.taskId]);
    if (reason === 'wrong_owner') scope.userId = 'someone-else';
    for (const request of Object.values(requests)) await expect(broker.execute(scope, request)).rejects.toThrow();
    expectNoDispatch();
  });
  it('rejects network/server grants widened beyond the durable task', async () => {
    const scope = await context();
    await expect(broker.execute({ ...scope, network: { mode: 'allow', allowedOrigins: ['https://example.com', 'https://example.org'] } }, requests.http_get)).rejects.toThrow(/scope/i);
    await expect(broker.execute({ ...scope, mcpServerIds: ['docs', 'other'] }, requests.mcp_call)).rejects.toThrow(/scope/i);
    await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{hostAccessConfirmed}','false') WHERE id=$1", [scope.taskId]);
    await expect(broker.execute(scope, requests.host_write)).rejects.toThrow(/scope|confirm/i);
    expectNoDispatch();
  });
  it('rechecks revocation after a host operation waits in the serial queue', async () => {
    const scope = await context();
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(HostFileBroker.prototype.execute).mockImplementationOnce(async () => { entered(); await pending; return receipt; });
    const first = broker.execute(scope, requests.host_write); await started;
    const second = broker.execute(scope, requests.host_write);
    const denied = expect(second).rejects.toThrow(/revoked/i);
    await store.db.query("UPDATE users SET session_version=1 WHERE id='owner'");
    release(); await first; await denied;
    expect(HostFileBroker.prototype.execute).toHaveBeenCalledTimes(1);
  });
  it('rechecks the overall deadline after waiting behind an executing host operation', async () => {
    const scope=await context();let release!:()=>void,entered!:()=>void;
    const started=new Promise<void>(resolve=>{entered=resolve;}),pending=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(HostFileBroker.prototype.execute).mockImplementationOnce(async()=>{entered();await pending;return receipt;});
    const first=broker.execute(scope,requests.host_write);await started;
    const second=broker.execute(scope,requests.host_write),denied=expect(second).rejects.toThrow(/deadline/i);
    await store.db.query("UPDATE tasks SET options=jsonb_set(options,'{budget,maxElapsedSeconds}','30'),created_at=now()-interval '31 seconds' WHERE id=$1",[scope.taskId]);
    release();await first;await denied;expect(HostFileBroker.prototype.execute).toHaveBeenCalledTimes(1);
  });
});
