import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { ToolStore } from './store';
import { boundedText, copySnapshot, snapshot, type Guard } from './files';
import { FILE_COUNT_LIMIT, WORKSPACE_LIMIT, inspectPath, safePath } from './platform';
import { gitCommand, trustedGitBinary, type GitExecution } from './git-process';
import { StorageBudget } from './storage-budget';

export interface WorktreeIdentity {
  repositoryId: string;
  workspaceId: string;
  branch: string;
  baseCommit: string;
}

/** Internal storage boundary. Callers must serialize creation and authorize the parent. */
export class ManagedWorktrees {
  private readonly active = new Map<AbortController, Promise<WorktreeIdentity>>();
  constructor(private readonly store: ToolStore) {}
  async stopAll(): Promise<void> {
    const pending = [...this.active];
    for (const [controller] of pending) controller.abort();
    await Promise.allSettled(pending.map(([, operation]) => operation));
  }
  create(repositoryId: string, workspaceId: string, files: Map<string, string>, signal: AbortSignal, guard: Guard, authorize: () => Promise<void> = async () => {}): Promise<WorktreeIdentity> {
    const controller = new AbortController();
    const operation = this.allocate(repositoryId, workspaceId, files, AbortSignal.any([signal, controller.signal]), guard, authorize);
    this.active.set(controller, operation);
    void operation.finally(() => this.active.delete(controller)).catch(() => {});
    return operation;
  }
  private async allocate(repositoryId: string, workspaceId: string, files: Map<string, string>, signal: AbortSignal, guard: Guard, authorize: () => Promise<void>): Promise<WorktreeIdentity> {
    z.uuid().parse(repositoryId); z.uuid().parse(workspaceId);
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    const check = () => { bounded.throwIfAborted(); guard(); };
    const allowed = async () => { check(); await authorize(); check(); };
    await allowed();
    let bytes = 0;
    if (files.size > FILE_COUNT_LIMIT) throw new Error('Workspace file count limit exceeded');
    for (const [path, content] of files) { safePath(path); boundedText(content); bytes += Buffer.byteLength(content); }
    if (bytes > WORKSPACE_LIMIT) throw new Error('Workspace size limit exceeded');
    await this.store.init(); check();
    await new StorageBudget(this.store.root).assertCapacity(bytes * 4 + 4 * 1024 * 1024); check();
    const binary = await trustedGitBinary(); check();
    const directory = await inspectPath(this.store.root, `git-projects/${repositoryId}`);
    const emptyDirectory = `${directory}/empty`;
    const emptyFile = `${directory}/empty-config`;
    const repo = `${directory}/objects.git`;
    const execution: GitExecution = { binary, directory, emptyDirectory, emptyFile, signal: bounded };
    const run = async (args: string[], input?: Iterable<Buffer>) => { await allowed(); const result = await gitCommand(execution, args, input); check(); return result; };
    let existing = false;
    try { await mkdir(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; existing = true; }
    if (existing) {
      // Unknown/interrupted initialization is retained for inspection, never overwritten.
      if (await readFile(await inspectPath(directory, 'ready'), 'utf8') !== repositoryId) throw new Error('Managed Git repository requires recovery');
    } else {
      await mkdir(emptyDirectory, { mode: 0o700 });
      await writeFile(emptyFile, '', { flag: 'wx', mode: 0o600 });
      await mkdir(`${directory}/operations`, { mode: 0o700 });
      await run(['init', '--bare', '--object-format=sha256', `--template=${emptyDirectory}`, repo]);
      await writeFile(`${directory}/ready`, repositoryId, { flag: 'wx', mode: 0o600 });
    }
    await inspectPath(directory, 'objects.git');
    const root = await this.store.workspaceRoot(workspaceId);
    // Exclusive parent creation refuses duplicate workspaces, including interrupted ones.
    await allowed(); await mkdir(await inspectPath(this.store.root, `workspaces/${workspaceId}`), { mode: 0o700 }); check();
    const branch = `relay/${workspaceId}`;
    const operation = await inspectPath(directory, `operations/${workspaceId}.json`);
    const receipt = await open(operation, 'wx', 0o600);
    try { await receipt.writeFile(JSON.stringify({ state: 'prepared', repositoryId, workspaceId, branch })); await receipt.sync(); }
    finally { await receipt.close(); }
    const ref = `refs/relay/snapshots/${workspaceId}`;
    await run([`--git-dir=${repo}`, 'fast-import', '--quiet', '--done'], importSnapshot(ref, files));
    const baseCommit = (await run([`--git-dir=${repo}`, 'rev-parse', '--verify', ref])).stdout.trim();
    if (!/^[a-f0-9]{64}$/.test(baseCommit)) throw new Error('Invalid managed Git snapshot identity');
    await run([`--git-dir=${repo}`, 'worktree', 'add', '--no-checkout', '-b', branch, root, baseCommit]);
    await inspectPath(root);
    // Never check out untrusted attributes. Write bounded raw bytes and initialize only the index.
    await allowed(); await copySnapshot(root, files, check);
    await run(['-C', root, 'read-tree', baseCommit]);
    const copied = await snapshot(root, true); check();
    if (copied.size !== files.size || [...files].some(([path, content]) => copied.get(path) !== content)) throw new Error('Managed worktree content verification failed');
    const identity = { repositoryId, workspaceId, branch, baseCommit };
    // Prepared receipts intentionally survive failures. No uncertain worktree is automatically replayed.
    await allowed();
    const ready = await open(await inspectPath(directory, `operations/${workspaceId}.ready.json`), 'wx', 0o600);
    try { await ready.writeFile(JSON.stringify(identity)); await ready.sync(); } finally { await ready.close(); }
    check(); return identity;
  }
}

function* importSnapshot(ref: string, files: Map<string, string>): Generator<Buffer> {
  yield Buffer.from(`commit ${ref}\ncommitter Relay <relay@localhost> 0 +0000\ndata 9\nSnapshot\n\ndeleteall\n`);
  for (const [path, content] of files) {
    const data = Buffer.from(content, 'utf8');
    yield Buffer.from(`M 100644 inline ${JSON.stringify(path)}\ndata ${data.length}\n`);
    yield data; yield Buffer.from('\n');
  }
  yield Buffer.from('\ndone\n');
}
