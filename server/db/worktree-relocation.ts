import { constants, type Stats } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { workspaceGitSchema } from '../../shared/git-worktrees';

const uuid = z.uuid().regex(/^[a-f0-9-]{36}$/);
const identitySchema = z.object({ repositoryId: uuid, workspaceId: uuid, branch: z.string().max(42) }).strict();
const preparedSchema = identitySchema.extend({ state: z.literal('prepared') });
const readySchema = identitySchema.extend({ baseCommit: z.string().regex(/^[a-f0-9]{64}$/) });
const workspaceSchema = z.object({
  id: uuid, name: z.string().min(1).max(128), sourcePath: z.string().nullable(),
  ownerUserId: z.string().min(1).max(160).nullable().optional(), createdAt: z.iso.datetime(),
  fileCount: z.number().int().min(0).max(2000), git: workspaceGitSchema.nullable().optional(),
}).strict();
type Workspace = z.infer<typeof workspaceSchema>;
type Allocation = z.infer<typeof preparedSchema> & { ready?: z.infer<typeof readySchema>; metadata?: Workspace; registered?: boolean };
type Read = { text: string; info: Stats };
type Change = { path: string; before: Read; after: string };
const comparable = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const portable = (path: string) => path.replaceAll('\\', '/');
function fail(reason: string): never { throw new Error(`Managed worktree relocation refused: ${reason}`); }
function same(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function component(value: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(value) || value.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) fail('invalid control path component');
}
function line(text: string): string {
  const value = text.replace(/\r?\n$/, '');
  if (!value || /[\x00-\x1f\x7f]|\p{Cf}/u.test(value)) fail('invalid control pointer line');
  return value;
}
// Original locations are opaque strings. Never pass them to a filesystem or Git API.
function originalRoot(text: string, suffix: string): string {
  const path = portable(line(text));
  const windows = /^[A-Za-z]:\//.test(path);
  if ((!windows && !path.startsWith('/')) || path.startsWith('//') || path.length > 4096) fail('control pointer must be a bounded absolute local path');
  const tail = windows ? path.slice(3) : path.slice(1);
  if (/[<>:"|?*]/.test(tail) || tail.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) fail('noncanonical original pointer');
  if (!path.endsWith(`/${suffix}`)) fail('control pointer identity mismatch');
  const root = path.slice(0, -suffix.length - 1);
  if (!root || /^[A-Za-z]:$/.test(root)) fail('original data root is too broad');
  return windows ? root.toLowerCase() : root;
}

/** Bounded access to an authenticated, private, exclusively owned restore staging tree. */
class Staging {
  private entries = 0;
  private bytes = 0;
  constructor(readonly root: string) {}
  async inspect(path: string): Promise<Stats | undefined> {
    const parts = path ? path.split('/') : [];
    if (parts.length > 8 || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) fail('unsafe staging control path');
    let current = this.root;
    for (let at = -1; at < parts.length; at++) {
      if (at >= 0) current = join(current, parts[at]);
      let info: Stats;
      try { info = await lstat(current); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' && at >= 0) return undefined; throw error; }
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) fail('links or non-regular control files');
      if (comparable(await realpath(current)) !== comparable(current)) fail('noncanonical staging path or reparse point');
      if (at < parts.length - 1 && !info.isDirectory()) fail('control path parent is not a directory');
      if (at === parts.length - 1) return info;
    }
    return undefined;
  }
  async names(path: string): Promise<string[]> {
    const info = await this.inspect(path); if (!info) return [];
    if (!info.isDirectory()) fail('expected a control directory');
    const result: string[] = [];
    for await (const entry of await opendir(join(this.root, path))) {
      if (++this.entries > 20_000) fail('control entry count exceeds restore limit');
      component(entry.name); result.push(entry.name);
    }
    return result;
  }
  async read(path: string, max = 8192, optional = false): Promise<Read | undefined> {
    const info = await this.inspect(path);
    if (!info) { if (optional) return undefined; fail('missing control file'); }
    if (!info.isFile()) fail('expected a regular control file');
    if (info.size > max || (this.bytes += info.size) > 16 * 1024 * 1024) fail('control metadata exceeds restore limit');
    const handle = await open(join(this.root, path), constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    try {
      if (!same(info, await handle.stat())) fail('control file changed while opening');
      const buffer = Buffer.alloc(info.size + 1); let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break; length += bytesRead;
      }
      if (length !== info.size || !same(info, await handle.stat())) fail('control file changed while reading');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)), info };
    } finally { await handle.close(); }
  }
  async write(change: Change): Promise<void> {
    const info = await this.inspect(change.path);
    if (!info || !same(info, change.before.info)) fail('control file changed before relocation');
    const handle = await open(join(this.root, change.path), constants.O_RDWR | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.nlink !== 1 || !same(current, info)) fail('control file changed while opening for relocation');
      await handle.writeFile(change.after); await handle.truncate(Buffer.byteLength(change.after)); await handle.sync();
    } finally { await handle.close(); }
  }
}

/**
 * Repair only copied linked-worktree pointers before the caller atomically publishes staging.
 * The caller must own/protect staging, authenticate its complete archive, and discard it on error.
 * This does not run Git, recover operations, create missing metadata, or alter SQL authority.
 */
export async function relocateManagedWorktrees(stage: string, finalDataDirectory: string): Promise<{ repaired: number }> {
  for (const path of [stage, finalDataDirectory]) {
    if (!isAbsolute(path) || /^[\\/]{2}/.test(path) || /[\x00-\x1f\x7f]|\p{Cf}/u.test(path)) fail('restore roots must be absolute local paths');
  }
  const root = resolve(stage), final = resolve(finalDataDirectory);
  if (comparable(root) === comparable(final) || comparable(dirname(root)) !== comparable(dirname(final))) fail('final data directory must be a distinct staging sibling');
  const fs = new Staging(root); await fs.inspect('');
  try { await lstat(final); fail('final data directory already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const allocations = new Map<string, Allocation>();
  const repositories: { id: string; path: string; ready: boolean }[] = [];

  for (const repositoryId of await fs.names('git-projects')) {
    uuid.parse(repositoryId); const path = `git-projects/${repositoryId}`;
    const ready = await fs.read(`${path}/ready`, 64, true);
    if (ready && ready.text !== repositoryId) fail('repository ready identity mismatch');
    repositories.push({ id: repositoryId, path, ready: !!ready });
    const names = await fs.names(`${path}/operations`);
    for (const name of names) {
      const match = /^([a-f0-9-]{36})(\.ready|\.registration-prepared|\.registration-published)?\.json$/.exec(name);
      if (!match) fail('unknown operation record'); uuid.parse(match[1]);
      if (match[2]) continue;
      const data = preparedSchema.parse(JSON.parse((await fs.read(`${path}/operations/${name}`, 64 * 1024))!.text));
      if (data.repositoryId !== repositoryId || data.workspaceId !== match[1] || data.branch !== `relay/${data.workspaceId}` || allocations.has(data.workspaceId)) fail('prepared allocation identity mismatch');
      allocations.set(data.workspaceId, data);
    }
    for (const name of names) {
      const match = /^([a-f0-9-]{36})\.(ready|registration-prepared|registration-published)\.json$/.exec(name);
      if (!match) continue;
      const allocation = allocations.get(match[1]);
      if (!allocation || allocation.repositoryId !== repositoryId) fail('metadata has no prepared allocation');
      const value: unknown = JSON.parse((await fs.read(`${path}/operations/${name}`, 64 * 1024))!.text);
      if (match[2] === 'ready') {
        const data = readySchema.parse(value);
        if (data.repositoryId !== repositoryId || data.workspaceId !== allocation.workspaceId || data.branch !== allocation.branch) fail('ready allocation identity mismatch');
        allocation.ready = data;
      } else {
        const record = z.object({ state: z.literal(match[2] === 'registration-prepared' ? 'prepared' : 'published'), workspace: workspaceSchema }).strict().parse(value);
        checkMetadata(allocation, record.workspace);
      }
    }
  }
  const listed = await fs.read('workspaces.json', 1024 * 1024, true);
  const listedIds = new Set<string>();
  if (listed) for (const workspace of z.array(workspaceSchema).max(1000).parse(JSON.parse(listed.text))) {
    if (listedIds.has(workspace.id)) fail('duplicate published workspace identity'); listedIds.add(workspace.id);
    const allocation = allocations.get(workspace.id);
    if (workspace.git) {
      if (!allocation) fail('published workspace has no prepared allocation');
      checkMetadata(allocation, workspace);
    } else if (allocation) fail('published workspace lost its Git identity');
  }
  for (const allocation of allocations.values()) if (allocation.metadata) {
    if (!allocation.ready || allocation.ready.baseCommit !== allocation.metadata.git!.baseCommit) fail('published metadata disagrees with ready allocation');
  }

  const pointers = new Map<string, Read>();
  for (const id of await fs.names('workspaces')) {
    uuid.parse(id); const pointer = await fs.read(`workspaces/${id}/files/.git`, 8192, true);
    if (pointer) {
      if (!allocations.has(id)) fail('workspace pointer has no prepared allocation');
      pointers.set(id, pointer);
    }
  }
  const changes: Change[] = []; let repaired = 0; let sourceRoot: string | undefined;
  for (const repository of repositories) {
    for (const basename of await fs.names(`${repository.path}/objects.git/worktrees`)) {
      const admin = `${repository.path}/objects.git/worktrees/${basename}`;
      if (!(await fs.names(admin)).length) continue; // Git may have only created an empty admin directory.
      const head = line((await fs.read(`${admin}/HEAD`))!.text);
      const match = /^ref: refs\/heads\/relay\/([a-f0-9-]{36})$/.exec(head);
      const allocation = match && allocations.get(match[1]);
      if (!allocation || allocation.repositoryId !== repository.id || allocation.registered || !repository.ready) fail('unknown or duplicate Git admin binding');
      const pointer = pointers.get(allocation.workspaceId);
      if (!pointer || !pointer.text.startsWith('gitdir: ')) fail('Git admin has no matching workspace pointer');
      const gitfile = `workspaces/${allocation.workspaceId}/files/.git`;
      const reverse = (await fs.read(`${admin}/gitdir`))!;
      if (line((await fs.read(`${admin}/commondir`))!.text) !== '../..') fail('unexpected common repository binding');
      const oldRoot = originalRoot(pointer.text.slice(8), admin);
      if (originalRoot(reverse.text, gitfile) !== oldRoot || (sourceRoot !== undefined && sourceRoot !== oldRoot)) fail('reciprocal original pointer root mismatch');
      sourceRoot = oldRoot; allocation.registered = true;
      const target = `gitdir: ${portable(final)}/${admin}\n`, back = `${portable(final)}/${gitfile}\n`;
      if (pointer.text !== target || reverse.text !== back) repaired++;
      if (pointer.text !== target) changes.push({ path: gitfile, before: pointer, after: target });
      if (reverse.text !== back) changes.push({ path: `${admin}/gitdir`, before: reverse, after: back });
    }
  }
  for (const allocation of allocations.values()) {
    if (!allocation.registered && (pointers.has(allocation.workspaceId) || allocation.ready || allocation.metadata)) fail('incomplete Git registration requires recovery');
  }
  // Every binding is validated before the first write. An I/O failure leaves unpublished staging.
  for (const change of changes) await fs.write(change);
  return { repaired };
}

function checkMetadata(allocation: Allocation, workspace: Workspace): void {
  const git = workspace.git;
  if (workspace.id !== allocation.workspaceId || workspace.sourcePath !== null || !git || git.repositoryId !== allocation.repositoryId || git.branch !== allocation.branch) fail('workspace metadata identity mismatch');
  const previous = allocation.metadata;
  if (previous && (JSON.stringify(previous.git) !== JSON.stringify(git) || (previous.ownerUserId ?? null) !== (workspace.ownerUserId ?? null))) fail('conflicting published workspace metadata');
  allocation.metadata = workspace;
}
