import { randomUUID } from 'node:crypto';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Workspace } from '../../shared/types';
import { boundedText } from './files';
import { inspectPath, readFlags, safePath } from './platform';
import { workspaceGitSchema } from '../../shared/git-worktrees';

const workspaceSchema = z.object({ ownerUserId:z.string().min(1).max(160).nullable().optional(), id: z.uuid(), name: z.string().min(1).max(128), sourcePath: z.string().nullable(), createdAt: z.iso.datetime(), fileCount: z.number().int().min(0).max(2000), git:workspaceGitSchema.nullable().optional() }).strict();
const entrySchema = z.object({ path: z.string(), before: z.string().nullable(), after: z.string().nullable() }).strict();
const checkpointSchema = z.object({ id: z.uuid(), taskId: z.string().min(1).max(160), workspaceId: z.uuid(), createdAt: z.iso.datetime(), state: z.enum(['prepared', 'committed', 'reverted']), entries: z.array(entrySchema).max(2000) }).strict();
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type ChangeEntry = z.infer<typeof entrySchema>;

export class ToolStore {
  readonly root: string;
  private initialized = false;
  constructor(root: string) { this.root = resolve(root); }
  async init(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await inspectPath(this.root);
    for (const folder of ['workspaces', 'checkpoints', 'runs', 'containers', 'baselines', 'git-runs', 'git-projects']) {
      const target = await inspectPath(this.root, folder);
      await mkdir(target, { recursive: true, mode: 0o700 });
      await inspectPath(this.root, folder);
    }
    this.initialized = true;
  }
  async workspaceRoot(id: string): Promise<string> {
    z.uuid().parse(id); await this.init();
    return inspectPath(this.root, `workspaces/${id}/files`);
  }
  async workspaces(): Promise<Workspace[]> {
    await this.init();
    const data = await this.readJson('workspaces.json', 1024 * 1024, true);
    return data === null ? [] : z.array(workspaceSchema).max(1000).parse(data);
  }
  async saveWorkspace(workspace: Workspace): Promise<void> {
    const records = await this.workspaces();
    const index = records.findIndex(item => item.id === workspace.id);
    if(index>=0&&(records[index].ownerUserId??null)!==(workspace.ownerUserId??null))throw new Error('Workspace ownership is immutable');
    if(index>=0&&JSON.stringify(records[index].git??null)!==JSON.stringify(workspace.git??null))throw new Error('Workspace Git identity is immutable');
    if (index < 0) records.push(workspace); else records[index] = workspace;
    z.array(workspaceSchema).max(1000).parse(records);
    await this.writeJson('workspaces.json', records, 1024 * 1024);
  }
  async recordForkRegistration(workspace:Workspace,state:'prepared'|'published'):Promise<void> {
    workspaceSchema.parse(workspace);
    if(!workspace.git)throw new Error('Missing Git workspace identity');
    await this.writeJson(`git-projects/${workspace.git.repositoryId}/operations/${workspace.id}.registration-${state}.json`,{state,workspace});
  }
  async checkpoint(id: string): Promise<Checkpoint> {
    z.uuid().parse(id); await this.init();
    const record = checkpointSchema.parse(await this.readJson(`checkpoints/${id}.json`, 16 * 1024 * 1024));
    if (record.id !== id) throw new Error('Checkpoint identity mismatch');
    for (const entry of record.entries) {
      safePath(entry.path);
      if (entry.before !== null) boundedText(entry.before);
      if (entry.after !== null) boundedText(entry.after);
    }
    return record;
  }
  async saveCheckpoint(record: Checkpoint): Promise<void> {
    checkpointSchema.parse(record);
    await this.writeJson(`checkpoints/${record.id}.json`, record);
  }
  async containers(): Promise<string[]> {
    await this.init();
    const names = await readdir(await inspectPath(this.root, 'containers'));
    if (names.length > 100) throw new Error('Too many interrupted containers; inspect recovery state');
    return names.filter(name => /^relay-[0-9a-f-]{36}\.json$/.test(name)).map(name => name.slice(0, -5));
  }
  async recordContainer(name: string): Promise<void> {
    if (!/^relay-[0-9a-f-]{36}$/.test(name)) throw new Error('Invalid managed container identity');
    await this.writeJson(`containers/${name}.json`, { name });
  }
  async forgetContainer(name: string): Promise<void> {
    if (!/^relay-[0-9a-f-]{36}$/.test(name)) throw new Error('Invalid managed container identity');
    await unlink(await inspectPath(this.root, `containers/${name}.json`)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
  }
  async checkpoints(taskId: string): Promise<Checkpoint[]> {
    await this.init(); const records: Checkpoint[] = [];
    const names = await readdir(await inspectPath(this.root, 'checkpoints'));
    if (names.length > 10_000) throw new Error('Checkpoint directory exceeds inspection limit');
    for (const name of names) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const record = await this.checkpoint(name.slice(0, -5));
      if (record.taskId === taskId) records.push(record);
    }
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  private async readJson(path: string, limit: number, optional = false): Promise<unknown> {
    const target = await inspectPath(this.root, path);
    let handle;
    try {
      handle = await open(target, readFlags()); const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > limit) throw new Error('Invalid or oversized broker metadata');
      const contents = await handle.readFile('utf8');
      if (Buffer.byteLength(contents) > limit) throw new Error('Oversized broker metadata');
      return JSON.parse(contents);
    } catch (error) {
      if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    } finally { await handle?.close(); }
  }
  private async writeJson(path: string, value: unknown, limit = 16 * 1024 * 1024): Promise<void> {
    await this.init(); const target = await inspectPath(this.root, path);
    const content = JSON.stringify(value);
    if (Buffer.byteLength(content) > limit) throw new Error('Broker metadata or checkpoint exceeds its size limit; split the operation into smaller changes');
    const temp = join(this.root, `.relay-${randomUUID()}.json`);
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await inspectPath(this.root, path); await rename(temp, target);
    } finally { await unlink(temp).catch(() => undefined); }
  }
}
