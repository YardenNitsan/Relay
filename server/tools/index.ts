import { randomUUID } from 'node:crypto';
import {assertTaskDeadline} from '../orchestration/deadline.js';
import {GoogleWorkspace} from '../integrations/google-workspace.js';
import {assertWorkspaceConversation} from '../integrations/workspace-policy.js';
import {prepareWorkspaceRead} from './google-workspace.js';
import {isWorkspaceTool} from './google-workspace-schema.js';
import {CodeEvaluationSandbox} from './code-evaluation.js';
import type {CodeSandboxIdentity} from '../models/code-evaluation.js';
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
import { ManagedWorktrees } from './git-worktrees';
import { captureGitBaseline } from './git-baseline';
import { StorageBudget } from './storage-budget';
import { McpRegistry } from '../mcp';
import { HostFileBroker } from './host-files';
import { row, type Store } from '../db/store';
import { authorizeOptions, type User } from '../auth/policy';
import { AppError } from '../core/errors';
import type { TaskOptions } from '../../shared/types';
import { PersonalTasks } from './personal';
import type { DevelopmentProfileId } from './development-profiles';

export class ToolBroker {
  private readonly store: ToolStore;
  private readonly sandbox: DockerSandbox;
  private readonly http = new PublicHttpClient();
  private readonly git: ManagedGit;
  private readonly worktrees: ManagedWorktrees;
  private readonly forkOperations=new Set<Promise<Workspace>>();
  private readonly hostFiles: HostFileBroker;
  private readonly personal: PersonalTasks | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  constructor(dataDir: string, private readonly isStopped: () => boolean, readonly mcp = new McpRegistry(), private readonly durableStore?: Store, private readonly googleWorkspace?:GoogleWorkspace) { this.store = new ToolStore(dataDir); this.sandbox = new DockerSandbox(this.store); this.git = new ManagedGit(this.store); this.worktrees = new ManagedWorktrees(this.store); this.hostFiles = new HostFileBroker(dataDir); this.personal = durableStore ? new PersonalTasks(durableStore) : undefined; }
  get dataDirectory():string {return this.store.root;}
  codeEvaluationStatus(){return new CodeEvaluationSandbox(this.store,this.sandbox).status();}
  codeEvaluationPreflight(signal:AbortSignal,authorize:()=>Promise<void>){const guard=this.guard(signal);return this.serial(async()=>{guard();await authorize();guard();return new CodeEvaluationSandbox(this.store,this.sandbox).preflight(signal,guard);});}
  codeEvaluationVerify(caseId:string,source:string,identity:CodeSandboxIdentity,signal:AbortSignal,authorize:()=>Promise<void>){const guard=this.guard(signal);return this.serial(async()=>{guard();await authorize();guard();return new CodeEvaluationSandbox(this.store,this.sandbox).verify(caseId,source,identity,signal,guard);});}
  definitions(): ToolDefinition[] { return definitions().filter(tool => (tool.name !== 'personal_tasks' || this.personal)&&(!isWorkspaceTool(tool.name)||!!this.googleWorkspace&&!!this.durableStore)); }
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
  async createWorkspace(name: string, sourcePath?: string, ownerUserId?:string, authorize?:()=>Promise<void>): Promise<Workspace> {
    const guard = this.guard();
    return this.serial(async () => {
      guard(); if (!name.trim() || name.length > 128) throw new Error('Workspace name must contain 1–128 characters');
      await authorize?.();
      await this.store.init();
      if(ownerUserId&&sourcePath)throw new AppError('WORKSPACE_IMPORT','Personal workspaces cannot import host paths',403);
      if(ownerUserId&&(await this.store.workspaces()).filter(item=>item.ownerUserId===ownerUserId).length>=8)throw new AppError('WORKSPACE_QUOTA','Each account can create up to eight personal workspaces.',429);
      const source = sourcePath ? await sourceRoot(sourcePath, this.store.root) : null;
      const files = source ? await snapshot(source) : new Map<string, string>(); guard();
      await new StorageBudget(this.store.root).assertCapacity([...files.values()].reduce((sum,value)=>sum+2*Buffer.byteLength(value),2*1024*1024));guard();
      const record: Workspace = { ...(ownerUserId?{ownerUserId}:{}), id: randomUUID(), name: name.trim(), sourcePath: source, createdAt: new Date().toISOString(), fileCount: files.size };
      const root = await this.store.workspaceRoot(record.id);
      await mkdir(root, { recursive: true, mode: 0o700 }); await inspectPath(root);
      await copySnapshot(root, files, guard); guard(); await captureGitBaseline(this.store,record.id,files,'workspace_creation',guard); await this.store.saveWorkspace(record);
      return record;
    });
  }
  async listWorkspaces(): Promise<Workspace[]> { return this.serial(() => this.store.workspaces()); }
  forkWorkspace(parentId:string,name:string,authorize:()=>Promise<void>,persist:(workspace:Workspace,guard:Guard)=>Promise<void>,signal:AbortSignal=new AbortController().signal):Promise<Workspace> {
    const guard=this.guard(signal);
    const operation=this.serial(async()=>{
      guard();await authorize();guard();
      if(!name.trim()||name.length>128)throw new Error('Workspace name must contain 1–128 characters');
      const parent=await this.workspace(parentId);
      if(parent.record.ownerUserId&&(await this.store.workspaces()).filter(item=>item.ownerUserId===parent.record.ownerUserId).length>=8)throw new AppError('WORKSPACE_QUOTA','Each account can create up to eight personal workspaces.',429);
      const files=await snapshot(parent.root,true);guard();
      const id=randomUUID();
      const identity=await this.worktrees.create(parent.record.git?.repositoryId??parentId,id,files,signal,guard,authorize);
      const record:Workspace={id,name:name.trim(),sourcePath:null,ownerUserId:parent.record.ownerUserId??null,createdAt:new Date().toISOString(),fileCount:files.size,git:{repositoryId:identity.repositoryId,parentWorkspaceId:parentId,branch:identity.branch,baseCommit:identity.baseCommit}};
      await authorize();guard();await captureGitBaseline(this.store,id,files,'workspace_creation',guard);
      await this.store.recordForkRegistration(record,'prepared');
      await authorize();guard();await persist(record,guard);guard();
      await authorize();guard();await this.store.saveWorkspace(record);guard();
      await this.store.recordForkRegistration(record,'published');guard();
      return record;
    });
    this.forkOperations.add(operation);void operation.finally(()=>this.forkOperations.delete(operation)).catch(()=>{});
    return operation;
  }
  async listFiles(workspaceId: string): Promise<string[]> {
    return this.serial(async () => listTextFiles((await this.workspace(workspaceId)).root));
  }
  async readFile(workspaceId:string,path:string):Promise<{path:string;content:string;sha256:string}> {
    safePath(path);
    return this.serial(async()=>{const {root}=await this.workspace(workspaceId);const content=await readText(root,path,true);if(content===null)throw new AppError('FILE_NOT_FOUND','File not found',404);return {path,content,sha256:sha256(content)};});
  }
  async changeFile(workspaceId:string,path:string,content:string|null,expectedHash:string|null,authorize?:()=>Promise<void>):Promise<{path:string;sha256:string|null}> {
    safePath(path);if(content!==null)boundedText(content);const guard=this.guard();
    return this.serial(async()=>{
      guard();await authorize?.();const {root,record}=await this.workspace(workspaceId);
      const before=await readText(root,path,true);
      if(hashOrNull(before)!==expectedHash)throw new AppError('FILE_CONFLICT','This file changed. Reload it before replacing or deleting it.',409);
      await this.commit({taskId:`manual-${randomUUID()}`,workspaceId},root,[{path,before,after:content}],guard,authorize);
      record.fileCount=(await listTextFiles(root)).length;
      if(this.durableStore)await this.durableStore.saveWorkspace(record);
      return {path,sha256:hashOrNull(content)};
    });
  }
  async upload(workspaceId: string, path: string, content: string, authorize?:()=>Promise<void>): Promise<void> {
    await this.changeFile(workspaceId,path,content,null,authorize);
  }
  private async authorizeExecution(context:ToolContext) {
    if(!this.durableStore)return;
    if(!context.userId)throw new AppError('WORKSPACE_DENIED','Missing account capability',403);
    // Read policy, ownership and stop generation in one database snapshot. This
    // check runs after the broker queue, not only when the engine proposes work.
    const state=(await this.durableStore.db.query(`SELECT to_jsonb(t) AS task,to_jsonb(u) AS account,c.value AS control,to_jsonb(w) AS workspace
      FROM tasks t JOIN users u ON u.id=t.user_id JOIN settings c ON c.key='control'
      LEFT JOIN workspaces w ON w.id=t.options->>'workspaceId'
      WHERE t.id=$1 AND t.user_id=$2`,[context.taskId,context.userId]))[0];
    if(!state)throw new AppError('WORKSPACE_DENIED','Task ownership could not be verified',403);
    const task=state.task as Record<string,unknown>,account=state.account as Record<string,unknown>;
    const user=row<User>(account),options=task.options as TaskOptions;
    assertTaskDeadline({createdAt:String(task.created_at),options});
    if(user.sessionVersion!==context.sessionVersion||options.workspaceId!==context.workspaceId||options.access!==context.access)throw new AppError('REVOKED','Task scope was revoked',403);
    const selection=(values:string[]|undefined)=>JSON.stringify([...new Set(values??[])].sort());
    const hostAccess=options.access==='unrestricted'&&options.hostAccessConfirmed===true&&user.role==='owner';
    if((context.hostAccess===true)!==hostAccess||
      (context.network?.mode??'deny')!==(options.network?.mode??'deny')||
      selection(context.network?.allowedOrigins)!==selection(options.network?.allowedOrigins)||
      selection(context.mcpServerIds)!==selection(options.mcpServerIds))throw new AppError('REVOKED','Task capability scope was changed or revoked',403);
    if((context.googleWorkspace?.mail===true)!==(options.googleWorkspace?.mail===true)||(context.googleWorkspace?.calendar===true)!==(options.googleWorkspace?.calendar===true))throw new AppError('REVOKED','Google Workspace task scope changed',403);
    await assertWorkspaceConversation(this.durableStore.db,String(task.conversation_id),options);
    const control=state.control as {stopped:boolean;generation:number};
    if(control.stopped||control.generation!==Number(task.stop_generation)||!['executing','verifying'].includes(String(task.status)))throw new AppError('STOPPED','This task is not authorized to execute',409);
    authorizeOptions({user,remote:user.role!=='owner',sessionId:'tool-execution'},options,state.workspace?row<Workspace>(state.workspace as Record<string,unknown>):undefined);
    if(context.workspaceId){const {record}=await this.workspace(context.workspaceId);if(record.ownerUserId&&record.ownerUserId!==user.id&&user.role!=='owner')throw new AppError('WORKSPACE_DENIED','Private workspace access denied',403);}
    assertTaskDeadline({createdAt:String(task.created_at),options});
  }
  async execute(context: ToolContext, request: ToolRequest): Promise<ToolResult> {
    const guard = this.guard(context.signal);
    if(isWorkspaceTool(request.name)){
      if(!this.googleWorkspace||!this.durableStore)throw new AppError('WORKSPACE_SETUP','Google Workspace tools are unavailable.',403);
      const read=prepareWorkspaceRead(this.durableStore,this.googleWorkspace,context,request,async()=>{guard();await this.authorizeExecution(context);guard();const decision=this.decide(context,request);if(decision.decision!=='allow')throw new AppError('WORKSPACE_CAPABILITY',decision.reason,403);});
      return this.serial(read);
    }
    if (request.name === 'personal_tasks') return this.serial(async () => {
      guard(); await this.authorizeExecution(context); guard(); const decision = this.decide(context, request);
      if (decision.decision !== 'allow') throw new Error(`${decision.decision}: ${decision.reason}`);
      if (!this.personal) throw new Error('Personal task storage is unavailable');
      return this.personal.execute(context, request.arguments, guard);
    });
    if(request.name.startsWith('host_'))return this.serial(async()=>{
      guard();await this.authorizeExecution(context);guard();const decision=this.decide(context,request);if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const {name,args}=parseRequest(request);
      return this.hostFiles.execute(name,args,context.signal,guard,context.taskId,async()=>{guard();await this.authorizeExecution(context);guard();});
    });
    if(request.name==='mcp_call') {
      guard();await this.authorizeExecution(context);guard();const decision=this.decide(context,request);if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const result=await this.mcp.execute(context,request);guard();return result;
    }
    if (request.name==='http_get') {
      guard();await this.authorizeExecution(context);guard();const decision=this.decide(context,request);
      if(decision.decision!=='allow')throw new Error(`${decision.decision}: ${decision.reason}`);
      const {args}=parseRequest(request);const result=await this.http.get(args.url as string,context.network!,context.signal);guard();return result;
    }
    return this.serial(async () => {
      guard(); await this.authorizeExecution(context); guard(); const decision = this.decide(context, request);
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
        const checkpoint = await this.commit(context, root, [{ path, before, after }], guard,()=>this.authorizeExecution(context));
        return { content: JSON.stringify({ path, sha256: hashOrNull(after), checkpointId: checkpoint.id }), evidence: [{ kind: 'file_content', summary: name === 'file_delete' ? `Verified deletion of ${path}` : `Verified written content of ${path}`, passed: true, details: { path, sha256: hashOrNull(after), checkpointId: checkpoint.id } }] };
      }
      return this.terminal(context, root, args.argv as string[], (args.timeoutSeconds as number | undefined) ?? 30, guard, args.profile as DevelopmentProfileId|undefined);
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
  private async commit(context: Pick<ToolContext, 'taskId' | 'workspaceId'>, root: string, entries: ChangeEntry[], guard: Guard, authorize?:()=>Promise<void>): Promise<Checkpoint> {
    await this.capacity(root, entries); guard();
    const checkpoint: Checkpoint = { id: randomUUID(), taskId: context.taskId, workspaceId: context.workspaceId!, createdAt: new Date().toISOString(), state: 'prepared', entries };
    await new StorageBudget(this.store.root).assertCapacity(2*Buffer.byteLength(JSON.stringify(checkpoint))+entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.after??''),2*1024*1024));guard();
    await this.store.saveCheckpoint(checkpoint);
    try {
      for (const entry of entries) await replaceText(root, entry.path, entry.after, hashOrNull(entry.before), guard,authorize);
      checkpoint.state = 'committed'; await this.store.saveCheckpoint(checkpoint);
      const { record } = await this.workspace(context.workspaceId!); record.fileCount = (await listTextFiles(root)).length; await this.store.saveWorkspace(record);
      return checkpoint;
    } catch(error) { throw new UncertainToolEffect(error); }
  }
  private async terminal(context: ToolContext, root: string, argv: string[], timeoutSeconds: number, guard: Guard, profile?:DevelopmentProfileId): Promise<ToolResult> {
    const status = await this.sandbox.status(profile); if (!status.available) throw new Error(status.reason);
    const before = await snapshot(root, true); guard();
    await new StorageBudget(this.store.root).assertCapacity([...before.values()].reduce((sum,value)=>sum+2*Buffer.byteLength(value),2*1024*1024));guard();
    const stage = await inspectPath(this.store.root, `runs/${randomUUID()}`);
    await mkdir(stage, { recursive: true, mode: 0o700 }); await copySnapshot(stage, before, guard);
    const { files: after, ...command } = await this.sandbox.run(stage, argv, timeoutSeconds, context.signal, guard, profile); guard();
    const entries: ChangeEntry[] = [];
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const oldValue = before.get(path) ?? null; const newValue = after.get(path) ?? null;
      if (oldValue !== newValue) entries.push({ path, before: oldValue, after: newValue });
    }
    const checkpoint = entries.length ? await this.commit(context, root, entries, guard,()=>this.authorizeExecution(context)) : null;
    await rm(await inspectPath(this.store.root,`runs/${stage.split(/[\\/]/).at(-1)}`),{recursive:true,force:true,maxRetries:3,retryDelay:25});
    return { content: JSON.stringify({ ...command, checkpointId: checkpoint?.id ?? null, filesChanged: entries.length }), evidence: [{ kind: 'command_exit', summary: `Isolated command exited ${command.exitCode}`, passed: command.exitCode === 0, details: { argv, exitCode: command.exitCode, durationMs: command.durationMs, truncated: command.truncated, imageId:command.imageId, toolchain:command.toolchain } }, ...(checkpoint ? [{ kind: 'file_content', summary: `Verified ${entries.length} changed files`, passed: true, details: { checkpointId: checkpoint.id } }] : [])] };
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
  async revert(taskId: string, checkpointId: string, authorize?:()=>Promise<void>): Promise<void> {
    const guard = this.guard();
    return this.serial(async () => {
      guard();await authorize?.();guard(); const checkpoint = await this.store.checkpoint(checkpointId);
      if (checkpoint.taskId !== taskId) throw new Error('Checkpoint belongs to another task');
      if (checkpoint.state !== 'committed') throw new Error('Checkpoint is not a completed mutation; inspect interrupted operations before recovery');
      const { root, record } = await this.workspace(checkpoint.workspaceId);
      for (const entry of checkpoint.entries) if (hashOrNull(await readText(root, entry.path, true)) !== hashOrNull(entry.after)) throw new Error(`Content conflict: ${entry.path} changed after the checkpoint`);
      await new StorageBudget(this.store.root).assertCapacity(Buffer.byteLength(JSON.stringify(checkpoint))+checkpoint.entries.reduce((sum,entry)=>sum+Buffer.byteLength(entry.before??''),2*1024*1024));guard();
      for (const entry of [...checkpoint.entries].reverse()) await replaceText(root, entry.path, entry.before, hashOrNull(entry.after), guard,authorize);
      checkpoint.state = 'reverted'; await this.store.saveCheckpoint(checkpoint);
      record.fileCount = (await listTextFiles(root)).length; await this.store.saveWorkspace(record);
    });
  }
  async sandboxStatus(profile?:DevelopmentProfileId): Promise<{ available: boolean; reason: string }> { return this.sandbox.status(profile); }
  async stopAll(): Promise<void> {
    this.generation++;this.http.stopAll();this.git.stopAll();this.mcp.stopAll();
    const results=await Promise.allSettled([this.sandbox.stopAll(),this.worktrees.stopAll(),...this.forkOperations]);
    // Cancelled fork requests retain journals; resource cleanup failures still propagate.
    for(const result of results.slice(0,2))if(result.status==='rejected')throw result.reason;
  }
}
