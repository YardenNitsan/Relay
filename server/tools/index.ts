import { randomUUID } from 'node:crypto';
import { mkdir,rm } from 'node:fs/promises';
import { createPatch } from 'diff';
import type { FileChange, ToolContext, ToolDecision, ToolDefinition, ToolRequest, ToolResult, Workspace } from '../../shared/types';
import { boundedText, copySnapshot, hashOrNull, listTextFiles, readText, replaceText, sha256, snapshot, type Guard } from './files';
import { decide, definitions, parseRequest } from './policy';
import { FILE_COUNT_LIMIT, inspectPath, OUTPUT_LIMIT, safePath, sourceRoot, WORKSPACE_LIMIT } from './platform';
import { DockerSandbox } from './sandbox';
import { ToolStore, type ChangeEntry, type Checkpoint } from './store';
import { UncertainToolEffect } from './errors';
import { PublicHttpClient } from './http';
import { ManagedGit } from './git';
import { captureGitBaseline } from './git-baseline';
import { StorageBudget } from './storage-budget';
import { McpRegistry } from '../mcp';
import { HostFileBroker } from './host-files';

export class ToolBroker {
  private readonly store: ToolStore;
  private readonly sandbox: DockerSandbox;
  private readonly http = new PublicHttpClient();
  private readonly git: ManagedGit;
  private readonly hostFiles: HostFileBroker;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(dataDir: string, private readonly isStopped: () => boolean, readonly mcp = new McpRegistry()) { this.store = new ToolStore(dataDir); this.sandbox = new DockerSandbox(this.store); this.git = new ManagedGit(this.store); this.hostFiles = new HostFileBroker(dataDir); }
  definitions(): ToolDefinition[] { return definitions(); }
  async verifyHostFile(path:string,expectedHash:string|null,signal:AbortSignal):Promise<boolean> {
    const guard=this.guard(signal);guard();
    try {
      const result=await this.hostFiles.execute('host_read',{path},signal,guard);
      guard();return (JSON.parse(result.content) as {sha256:string}).sha256===expectedHash;
    } catch(error) {
      guard();if((error as NodeJS.ErrnoException).code==='ENOENT')return expectedHash===null;
      throw error;
    }
  }
  decide(context: ToolContext, request: ToolRequest): ToolDecision { return decide(context, request, this.isStopped(),this.mcp); }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation); this.queue = result.catch(() => undefined); return result;
  }
  private guard(signal?: AbortSignal): Guard {
    const generation = this.generation;
    return () => {
      if (this.isStopped() || this.generation !== generation) throw new Error('Emergency stop invalidated this operation');
      if (signal?.aborted) throw new Error('Task was cancelled');
    };
  }
  private async workspace(id: string): Promise<{ record: Workspace; root: string }> {
    const record = (await this.store.workspaces()).find(item => item.id === id);
    if (!record) throw new Error('Unknown managed workspace');
    return { record, root: await this.store.workspaceRoot(id) };
  }
  async createWorkspace(name: string, sourcePath?: string): Promise<Workspace> {
    const guard = this.guard();
    return this.serial(async () => {
      guard(); if (!name.trim() || name.length > 128) throw new Error('Workspace name must contain 1–128 characters');
      await this.store.init();
      const source = sourcePath ? await sourceRoot(sourcePath, this.store.root) : null;
      const files = source ? await snapshot(source) : new Map<string, string>(); guard();
      await new StorageBudget(this.store.root).assertCapacity([...files.values()].reduce((sum,value)=>sum+2*Buffer.byteLength(value),2*1024*1024));guard();
      const record: Workspace = { id: randomUUID(), name: name.trim(), sourcePath: source, createdAt: new Date().toISOString(), fileCount: files.size };
      const root = await this.store.workspaceRoot(record.id);
      await mkdir(root, { recursive: true, mode: 0o700 }); await inspectPath(root);
      await copySnapshot(root, files, guard); guard(); await captureGitBaseline(this.store,record.id,files,'workspace_creation',guard); await this.store.saveWorkspace(record);
      return record;
    });
  }
  async listWorkspaces(): Promise<Workspace[]> { return this.serial(() => this.store.workspaces()); }
  async listFiles(workspaceId: string): Promise<string[]> {
    return this.serial(async () => listTextFiles((await this.workspace(workspaceId)).root));
  }
  async upload(workspaceId: string, path: string, content: string): Promise<void> {
    safePath(path); boundedText(content); const guard = this.guard();
    return this.serial(async () => {
      guard(); const { root, record } = await this.workspace(workspaceId);
      const before = await readText(root, path, true); await this.capacity(root, [{ path, before, after: content }]);
      await new StorageBudget(this.store.root).assertCapacity(Buffer.byteLength(content)+2*1024*1024);guard();
      await replaceText(root, path, content, hashOrNull(before), guard);
      record.fileCount = (await listTextFiles(root)).length; await this.store.saveWorkspace(record);
    });
  }
  async execute(context: ToolContext, request: ToolRequest): Promise<ToolResult> {
    const guard = this.guard(context.signal);
    if(request.name.startsWith('host_'))return this.serial(async()=>{
      guard();const decision=this.decide(context,request);if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const {name,args}=parseRequest(request);
      return this.hostFiles.execute(name,args,context.signal,guard,context.taskId);
    });
    if(request.name==='mcp_call') {
      guard();const decision=this.decide(context,request);if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const result=await this.mcp.execute(context,request);guard();return result;
    }
    if (request.name==='http_get') {
      guard();const decision=this.decide(context,request);
      if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const {args}=parseRequest(request);const result=await this.http.get(args.url as string,context.network!,context.signal);guard();return result;
    }
    return this.serial(async () => {
      guard(); const decision = this.decide(context, request);
      if (decision.decision !== 'allow') throw new Error(`${decision.decision}: ${decision.reason}`);
      const { name, args } = parseRequest(request);
      const { root } = await this.workspace(context.workspaceId!); guard();
      if (name==='git_status' || name==='git_diff') return this.git.inspect(context.workspaceId!,root,name,args.path as string|undefined,context.signal,guard);
      if (name === 'file_list') {
        const files = await listTextFiles(root, safePath((args.path as string | undefined) ?? '', true));
        guard(); return { content: JSON.stringify({ files }), evidence: [{ kind: 'file_listing', summary: `Inspected ${files.length} permitted files`, passed: true }] };
      }
      if (name === 'file_read') {
        const content = (await readText(root, args.path as string))!; guard();
        const truncated = content.length > OUTPUT_LIMIT;
        return { content: JSON.stringify({ path: args.path, content: content.slice(0, OUTPUT_LIMIT), sha256: sha256(content), bytes: Buffer.byteLength(content), truncated }), evidence: [{ kind: 'file_read', summary: `Read ${args.path}${truncated ? ' (output truncated)' : ''}`, passed: true, details: { sha256: sha256(content), bytes: Buffer.byteLength(content), truncated } }] };
      }
      if (name === 'file_search') return this.search(root, args.query as string, (args.path as string | undefined) ?? '', guard);
      if (name === 'file_write' || name === 'file_delete') {
        const path = args.path as string; const before = await readText(root, path, true);
        if (hashOrNull(before) !== args.expectedHash) throw new Error('Content conflict: current file differs from expectedHash');
        const after = name === 'file_delete' ? null : args.content as string;
        const checkpoint = await this.commit(context, root, [{ path, before, after }], guard);
        return { content: JSON.stringify({ path, sha256: hashOrNull(after), checkpointId: checkpoint.id }), evidence: [{ kind: 'file_content', summary: name === 'file_delete' ? `Verified deletion of ${path}` : `Verified written content of ${path}`, passed: true, details: { path, sha256: hashOrNull(after), checkpointId: checkpoint.id } }] };
      }
      return this.terminal(context, root, args.argv as string[], (args.timeoutSeconds as number | undefined) ?? 30, guard);
    });
  }
  private async search(root: string, query: string, path: string, guard: Guard): Promise<ToolResult> {
    const matches: { path: string; line: number; text: string }[] = []; let truncated = false;
    for (const file of await listTextFiles(root, safePath(path, true))) {
      guard(); let contents: string;
      try { contents = (await readText(root, file))!; } catch { continue; }
      const lines = contents.split(/\r?\n/);
      for (let line = 0; line < lines.length; line++) {
        if (!lines[line].toLowerCase().includes(query.toLowerCase())) continue;
        if (matches.length >= 100) { truncated = true; break; }
        matches.push({ path: file, line: line + 1, text: lines[line].slice(0, 240) });
      }
      if (truncated) break;
    }
    guard(); return { content: JSON.stringify({ matches, truncated }), evidence: [{ kind: 'file_search', summary: `Found ${matches.length}${truncated ? '+' : ''} matching lines`, passed: true }] };
  }
  private async capacity(root: string, entries: ChangeEntry[]): Promise<void> {
    const contents = await snapshot(root);
    for (const entry of entries) { if (entry.after === null) contents.delete(entry.path); else contents.set(entry.path, entry.after); }
    if (contents.size > FILE_COUNT_LIMIT || [...contents.values()].reduce((sum, value) => sum + Buffer.byteLength(value), 0) > WORKSPACE_LIMIT) throw new Error('Workspace capacity limit exceeded');
  }
  private async commit(context: Pick<ToolContext, 'taskId' | 'workspaceId'>, root: string, entries: ChangeEntry[], guard: Guard): Promise<Checkpoint> {
    await this.capacity(root, entries); guard();
    const checkpoint: Checkpoint = { id: randomUUID(), taskId: context.taskId, workspaceId: context.workspaceId!, createdAt: new Date().toISOString(), state: 'prepared', entries };
    await new StorageBudget(this.store.root).assertCapacity(2*Buffer.byteLength(JSON.stringify(checkpoint))+entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.after??''),2*1024*1024));guard();
    await this.store.saveCheckpoint(checkpoint);
    try {
      for (const entry of entries) await replaceText(root, entry.path, entry.after, hashOrNull(entry.before), guard);
      checkpoint.state = 'committed'; await this.store.saveCheckpoint(checkpoint);
      const { record } = await this.workspace(context.workspaceId!); record.fileCount = (await listTextFiles(root)).length; await this.store.saveWorkspace(record);
      return checkpoint;
    } catch(error) { throw new UncertainToolEffect(error); }
  }
  private async terminal(context: ToolContext, root: string, argv: string[], timeoutSeconds: number, guard: Guard): Promise<ToolResult> {
    const status = await this.sandbox.status(); if (!status.available) throw new Error(status.reason);
    const before = await snapshot(root, true); guard();
    await new StorageBudget(this.store.root).assertCapacity([...before.values()].reduce((sum,value)=>sum+2*Buffer.byteLength(value),2*1024*1024));guard();
    const stage = await inspectPath(this.store.root, `runs/${randomUUID()}`);
    await mkdir(stage, { recursive: true, mode: 0o700 }); await copySnapshot(stage, before, guard);
    const { files: after, ...command } = await this.sandbox.run(stage, argv, timeoutSeconds, context.signal, guard); guard();
    const entries: ChangeEntry[] = [];
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const oldValue = before.get(path) ?? null; const newValue = after.get(path) ?? null;
      if (oldValue !== newValue) entries.push({ path, before: oldValue, after: newValue });
    }
    const checkpoint = entries.length ? await this.commit(context, root, entries, guard) : null;
    await rm(await inspectPath(this.store.root,`runs/${stage.split(/[\\/]/).at(-1)}`),{recursive:true,force:true,maxRetries:3,retryDelay:25});
    return { content: JSON.stringify({ ...command, checkpointId: checkpoint?.id ?? null, filesChanged: entries.length }), evidence: [{ kind: 'command_exit', summary: `Isolated command exited ${command.exitCode}`, passed: command.exitCode === 0, details: { argv, exitCode: command.exitCode, durationMs: command.durationMs, truncated: command.truncated } }, ...(checkpoint ? [{ kind: 'file_content', summary: `Verified ${entries.length} changed files`, passed: true, details: { checkpointId: checkpoint.id } }] : [])] };
  }
  async changes(taskId: string): Promise<FileChange[]> {
    return this.serial(async () => {
      const result: FileChange[] = [];
      for (const checkpoint of await this.store.checkpoints(taskId)) {
        if (checkpoint.state === 'reverted') continue;
        for (const entry of checkpoint.entries) {
          if (checkpoint.state === 'prepared') {
            const root = (await this.workspace(checkpoint.workspaceId)).root;
            if (hashOrNull(await readText(root, entry.path, true)) !== hashOrNull(entry.after)) continue;
          }
          const before = entry.before ?? ''; const after = entry.after ?? '';
          result.push({ path: entry.path, before, after, patch: createPatch(entry.path, before, after, 'before', 'after'), checkpointId: checkpoint.id });
        }
      }
      return result;
    });
  }
  async revert(taskId: string, checkpointId: string): Promise<void> {
    const guard = this.guard();
    return this.serial(async () => {
      guard(); const checkpoint = await this.store.checkpoint(checkpointId);
      if (checkpoint.taskId !== taskId) throw new Error('Checkpoint belongs to another task');
      if (checkpoint.state !== 'committed') throw new Error('Checkpoint is not a completed mutation; inspect interrupted operations before recovery');
      const { root, record } = await this.workspace(checkpoint.workspaceId);
      for (const entry of checkpoint.entries) if (hashOrNull(await readText(root, entry.path, true)) !== hashOrNull(entry.after)) throw new Error(`Content conflict: ${entry.path} changed after the checkpoint`);
      await new StorageBudget(this.store.root).assertCapacity(Buffer.byteLength(JSON.stringify(checkpoint))+checkpoint.entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.before??''),2*1024*1024));guard();
      for (const entry of [...checkpoint.entries].reverse()) await replaceText(root, entry.path, entry.before, hashOrNull(entry.after), guard);
      checkpoint.state = 'reverted'; await this.store.saveCheckpoint(checkpoint);
      record.fileCount = (await listTextFiles(root)).length; await this.store.saveWorkspace(record);
    });
  }
  async sandboxStatus(): Promise<{ available: boolean; reason: string }> { return this.sandbox.status(); }
  async stopAll(): Promise<void> { this.generation++; this.http.stopAll(); this.git.stopAll(); this.mcp.stopAll(); await this.sandbox.stopAll(); }
}
