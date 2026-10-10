import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { cp, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { relocateManagedWorktrees } from '../server/db/worktree-relocation';
import { ManagedWorktrees } from '../server/tools/git-worktrees';
import { ToolStore } from '../server/tools/store';
import { gitCommand, trustedGitBinary, type GitExecution } from '../server/tools/git-process';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

let root: string;
let stage: string;
let final: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'relay-relocation-'));
  stage = join(root, 'stage'); final = join(root, 'data'); await mkdir(stage);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const portable = (path: string) => path.replaceAll('\\', '/');
async function put(path: string, content: string) {
  const parts = path.split('/'); parts.pop();
  await mkdir(join(stage, ...parts), { recursive: true });
  await writeFile(join(stage, path), content);
}
async function fixture(options: { preparedOnly?: boolean; basename?: string } = {}) {
  const repositoryId = randomUUID(), workspaceId = randomUUID();
  const branch = `relay/${workspaceId}`, baseCommit = 'a'.repeat(64);
  const project = `git-projects/${repositoryId}`;
  const operation = `${project}/operations/${workspaceId}`;
  const admin = `${project}/objects.git/worktrees/${options.basename ?? 'files'}`;
  const gitfile = `workspaces/${workspaceId}/files/.git`;
  await put(`${project}/ready`, repositoryId);
  await put(`${operation}.json`, JSON.stringify({ state: 'prepared', repositoryId, workspaceId, branch }));
  await put(gitfile, `gitdir: C:/old unavailable/data/${admin}\n`);
  await put(`${admin}/gitdir`, `C:/old unavailable/data/${gitfile}\n`);
  await put(`${admin}/HEAD`, `ref: refs/heads/${branch}\n`);
  await put(`${admin}/commondir`, '../..\n');
  await put(`${admin}/index`, 'opaque index bytes');
  await put(`workspaces/${workspaceId}/files/readme.txt`, '\uFEFFdirty\r\ntext\n');
  if (!options.preparedOnly) await put(`${operation}.ready.json`, JSON.stringify({ repositoryId, workspaceId, branch, baseCommit }));
  const workspace = { id: workspaceId, name: 'Fork', sourcePath: null, ownerUserId: 'owner', createdAt: '2026-10-10T00:00:00.000Z', fileCount: 1, git: { repositoryId, parentWorkspaceId: randomUUID(), branch, baseCommit } };
  return { repositoryId, workspaceId, branch, baseCommit, project, operation, admin, gitfile, workspace };
}
async function contents(path = stage, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await contents(join(path, entry.name), `${name}/`));
    else result[name] = (await readFile(join(path, entry.name))).toString('base64');
  }
  return result;
}

it('rewrites only reciprocal control pointers and preserves published metadata, content and journals', async () => {
  const f = await fixture({ basename: 'files12' });
  await put('workspaces.json', JSON.stringify([f.workspace]));
  await put(`${f.operation}.registration-prepared.json`, JSON.stringify({ state: 'prepared', workspace: f.workspace }));
  await put(`${f.operation}.registration-published.json`, JSON.stringify({ state: 'published', workspace: f.workspace }));
  const before = await contents();
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 1 });
  expect(await readFile(join(stage, f.gitfile), 'utf8')).toBe(`gitdir: ${portable(final)}/${f.admin}\n`);
  expect(await readFile(join(stage, f.admin, 'gitdir'), 'utf8')).toBe(`${portable(final)}/${f.gitfile}\n`);
  const after = await contents();
  delete before[f.gitfile]; delete before[`${f.admin}/gitdir`];
  delete after[f.gitfile]; delete after[`${f.admin}/gitdir`];
  expect(after).toEqual(before);
});

it('repairs a prepared-only registration without publishing or completing it', async () => {
  const f = await fixture({ preparedOnly: true });
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 1 });
  expect(await readdir(join(stage, f.project, 'operations'))).toEqual([`${f.workspaceId}.json`]);
  await expect(readFile(join(stage, 'workspaces.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['/deleted source/data', 'Z:\\deleted source\\data'])('treats old root %s as opaque path text', async oldRoot => {
  const f = await fixture();
  await put(f.gitfile, `gitdir: ${oldRoot}/${f.admin}\n`);
  await put(`${f.admin}/gitdir`, `${oldRoot}/${f.gitfile}\n`);
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 1 });
  expect(await readFile(join(stage, f.gitfile), 'utf8')).toBe(`gitdir: ${portable(final)}/${f.admin}\n`);
});

it('leaves legacy data and interrupted allocations that never registered unchanged', async () => {
  const repositoryId = randomUUID(), workspaceId = randomUUID();
  await put('workspaces.json', '[]');
  await put(`git-projects/${repositoryId}/empty-config`, '');
  await put(`git-projects/${repositoryId}/operations/${workspaceId}.json`, JSON.stringify({ state: 'prepared', repositoryId, workspaceId, branch: `relay/${workspaceId}` }));
  await mkdir(join(stage, 'workspaces', workspaceId), { recursive: true });
  const before = await contents();
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 0 });
  expect(await contents()).toEqual(before);
});

it('rejects a regular file masquerading as the staging root', async () => {
  await rm(stage, { recursive: true }); await writeFile(stage, 'not a directory');
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow(/directory/i);
  expect(await readFile(stage, 'utf8')).toBe('not a directory');
});

it('is idempotent within unpublished staging and never touches an existing final directory', async () => {
  await fixture();
  await relocateManagedWorktrees(stage, final);
  const before = await contents();
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 0 });
  await mkdir(final); await writeFile(join(final, 'unrelated'), 'keep');
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow(/exists/i);
  expect(await readFile(join(final, 'unrelated'), 'utf8')).toBe('keep');
  expect(await contents()).toEqual(before);
});

it('rejects unrecorded workspace pointers even when no managed repositories exist', async () => {
  await put(`workspaces/${randomUUID()}/files/.git`, 'gitdir: /unrelated/private/repository\n');
  const before = await contents();
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow(/prepared/i);
  expect(await contents()).toEqual(before);
});

it('bounds published metadata before parsing it', async () => {
  await fixture(); await put('workspaces.json', ' '.repeat(1024 * 1024 + 1));
  const before = await contents();
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow(/limit/i);
  expect(await contents()).toEqual(before);
});

it.each(['HEAD', 'commondir', 'gitdir', 'workspace-pointer', 'prepared-identity', 'published-identity', 'oversized', 'multiline', 'unknown-admin'])('rejects %s inconsistencies before changing any pointer', async kind => {
  const first = await fixture(); const f = await fixture();
  if (kind === 'HEAD') await put(`${f.admin}/HEAD`, `ref: refs/heads/relay/${first.workspaceId}\n`);
  if (kind === 'commondir') await put(`${f.admin}/commondir`, '/outside/repository\n');
  if (kind === 'gitdir') await put(`${f.admin}/gitdir`, `C:/another-root/data/${f.gitfile}\n`);
  if (kind === 'workspace-pointer') await put(f.gitfile, `gitdir: C:/old unavailable/data/${first.admin}\n`);
  if (kind === 'prepared-identity') await put(`${f.operation}.json`, JSON.stringify({ state: 'prepared', repositoryId: first.repositoryId, workspaceId: f.workspaceId, branch: f.branch }));
  if (kind === 'published-identity') await put('workspaces.json', JSON.stringify([{ ...f.workspace, git: { ...f.workspace.git, baseCommit: 'b'.repeat(64) } }]));
  if (kind === 'oversized') await put(f.gitfile, 'a'.repeat(8193));
  if (kind === 'multiline') await put(f.gitfile, `gitdir: C:/old unavailable/data/${f.admin}\nextra\n`);
  if (kind === 'unknown-admin') await put(`${f.project}/objects.git/worktrees/unknown/HEAD`, `ref: refs/heads/relay/${randomUUID()}\n`);
  const before = await contents();
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow();
  expect(await contents()).toEqual(before);
});

it('rejects linked control files without modifying their outside target', async () => {
  const f = await fixture(); const outside = join(root, 'outside-pointer');
  await rename(join(stage, f.gitfile), outside); await link(outside, join(stage, f.gitfile));
  const original = await readFile(outside, 'utf8');
  await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow(/link|regular/i);
  expect(await readFile(outside, 'utf8')).toBe(original);
});

it('rejects redirected staging ancestry before reading its metadata', async () => {
  await fixture(); const alias = join(root, 'alias');
  await symlink(stage, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const before = await contents();
  await expect(relocateManagedWorktrees(alias, final)).rejects.toThrow(/link|canonical|reparse/i);
  expect(await contents()).toEqual(before);
});

it('propagates a mid-rewrite failure without publishing or changing recovery journals', async () => {
  const f = await fixture({ preparedOnly: true });
  const journal = await readFile(join(stage, `${f.operation}.json`), 'utf8');
  const before = await readFile(join(stage, f.admin, 'gitdir'), 'utf8');
  const actualOpen = vi.mocked(open).getMockImplementation()!;
  vi.mocked(open).mockImplementation(async (path, flags, mode) => {
    if (String(path) === join(stage, f.admin, 'gitdir') && typeof flags === 'number' && (flags & constants.O_RDWR)) throw new Error('injected pointer write failure');
    return actualOpen(path, flags, mode);
  });
  try { await expect(relocateManagedWorktrees(stage, final)).rejects.toThrow('injected pointer write failure'); }
  finally { vi.mocked(open).mockImplementation(actualOpen); }
  await expect(readdir(final)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(join(stage, f.admin, 'gitdir'), 'utf8')).toBe(before);
  expect(await readFile(join(stage, `${f.operation}.json`), 'utf8')).toBe(journal);
  expect(await readdir(join(stage, f.project, 'operations'))).toEqual([`${f.workspaceId}.json`]);
});

it('relocates actual independent Git indexes without relying on the original root', async () => {
  final = join(root, 'restored data-שלום');
  const source = join(root, 'source'); const store = new ToolStore(source); await store.init();
  const manager = new ManagedWorktrees(store); const repo = randomUUID(), a = randomUUID(), b = randomUUID();
  const first = await manager.create(repo, a, new Map([['a.txt', 'base A']]), new AbortController().signal, () => {});
  const second = await manager.create(repo, b, new Map([['b.txt', '\uFEFFbase B\r\n']]), new AbortController().signal, () => {});
  await writeFile(join(await store.workspaceRoot(a), 'a.txt'), 'dirty A');
  await cp(source, stage, { recursive: true });
  await rename(source, join(root, 'unavailable-original'));
  expect(await relocateManagedWorktrees(stage, final)).toEqual({ repaired: 2 });
  await rename(stage, final);
  const execution: GitExecution = { binary: await trustedGitBinary(), directory: final, emptyDirectory: join(final, 'git-projects', repo, 'empty'), emptyFile: join(final, 'git-projects', repo, 'empty-config'), signal: new AbortController().signal };
  for (const [id, commit, filename] of [[a, first.baseCommit, 'a.txt'], [b, second.baseCommit, 'b.txt']]) {
    const worktree = join(final, 'workspaces', id, 'files');
    expect((await gitCommand(execution, ['-C', worktree, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(commit);
    expect((await gitCommand(execution, ['-C', worktree, 'ls-files'])).stdout.trim()).toBe(filename);
  }
  expect(await readFile(join(final, 'workspaces', a, 'files', 'a.txt'), 'utf8')).toBe('dirty A');
  expect(await readFile(join(final, 'workspaces', b, 'files', 'b.txt'), 'utf8')).toBe('\uFEFFbase B\r\n');
});
