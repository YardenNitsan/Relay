import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ToolStore } from '../server/tools/store';
import { ManagedWorktrees } from '../server/tools/git-worktrees';
import { gitCommand, trustedGitBinary, type GitExecution } from '../server/tools/git-process';
import { snapshot } from '../server/tools/files';

let directory: string;
let store: ToolStore;
let worktrees: ManagedWorktrees;
let execution: GitExecution;
const signal = () => new AbortController().signal;
const guard = () => {};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'relay-worktrees-'));
  store = new ToolStore(join(directory, 'data')); await store.init();
  worktrees = new ManagedWorktrees(store);
  const emptyDirectory = join(directory, 'empty'); await mkdir(emptyDirectory);
  const emptyFile = join(directory, 'empty-config'); await writeFile(emptyFile, '');
  execution = { binary: await trustedGitBinary(), directory, emptyDirectory, emptyFile, signal: signal() };
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

it('creates real linked branches with raw bytes and independent files, without reading source Git configuration', async () => {
  const repositoryId = randomUUID(); const a = randomUUID(); const b = randomUUID();
  const files = new Map([['empty.txt', ''], ['src/שלום.txt', '\uFEFFfirst\r\nsecond\n'], ['.gitattributes', '* text eol=crlf filter=evil\n']]);
  const first = await worktrees.create(repositoryId, a, files, signal(), guard);
  const second = await worktrees.create(repositoryId, b, files, signal(), guard);
  const firstRoot = await store.workspaceRoot(a); const secondRoot = await store.workspaceRoot(b);
  expect(await snapshot(firstRoot, true)).toEqual(files);
  expect(await snapshot(secondRoot, true)).toEqual(files);
  expect(first.baseCommit).toMatch(/^[a-f0-9]{64}$/);
  const branches = await gitCommand(execution, [`--git-dir=${join(store.root, 'git-projects', repositoryId, 'objects.git')}`, 'worktree', 'list', '--porcelain']);
  expect(branches.stdout).toContain(`branch refs/heads/${first.branch}`);
  expect(branches.stdout).toContain(`branch refs/heads/${second.branch}`);
  await writeFile(join(firstRoot, 'src/שלום.txt'), 'edited in first');
  expect(await readFile(join(secondRoot, 'src/שלום.txt'), 'utf8')).toBe('\uFEFFfirst\r\nsecond\n');
  expect(await readFile(join(firstRoot, '.git'), 'utf8')).toContain('gitdir:');
  expect((await gitCommand(execution, ['-C', secondRoot, 'rev-parse', 'HEAD'])).stdout.trim()).toBe(second.baseCommit);
});

it('refuses unsafe snapshot paths and duplicate destinations before overwriting a managed branch', async () => {
  const repositoryId = randomUUID(); const workspaceId = randomUUID();
  await expect(worktrees.create(repositoryId, workspaceId, new Map([['../outside', 'bad']]), signal(), guard)).rejects.toThrow(/unsafe/i);
  await expect(worktrees.create(repositoryId, workspaceId, new Map([['.git/config', 'bad']]), signal(), guard)).rejects.toThrow(/protected/i);
  await worktrees.create(repositoryId, workspaceId, new Map([['a.txt', 'original']]), signal(), guard);
  await expect(worktrees.create(repositoryId, workspaceId, new Map([['a.txt', 'replacement']]), signal(), guard)).rejects.toThrow(/exist/i);
  expect(await readFile(join(await store.workspaceRoot(workspaceId), 'a.txt'), 'utf8')).toBe('original');
});

it('does not mutate storage when cancellation or authorization refuses creation', async () => {
  const cancelled = new AbortController(); cancelled.abort();
  await expect(worktrees.create(randomUUID(), randomUUID(), new Map(), cancelled.signal, guard)).rejects.toThrow(/abort|cancel/i);
  await expect(worktrees.create(randomUUID(), randomUUID(), new Map(), signal(), () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
  expect(await readdir(join(store.root, 'workspaces'))).toEqual([]);
});

it('does not run inherited Git filters and initializes each linked index independently', async () => {
  const original = process.env.GIT_CONFIG_GLOBAL;
  const hostile = join(directory, 'hostile-config');
  await writeFile(hostile, '[core]\nrepositoryFormatVersion=invalid\n[filter "evil"]\nrequired=true\nclean=must-not-run\nsmudge=must-not-run\n');
  process.env.GIT_CONFIG_GLOBAL = hostile;
  try {
    const repository = randomUUID(); const a = randomUUID(); const b = randomUUID();
    await worktrees.create(repository, a, new Map([['a.txt', 'A'], ['.gitattributes', '* filter=evil\n']]), signal(), guard);
    await worktrees.create(repository, b, new Map([['b.txt', 'B']]), signal(), guard);
    const first = await gitCommand(execution, ['-C', await store.workspaceRoot(a), 'ls-files']);
    const second = await gitCommand(execution, ['-C', await store.workspaceRoot(b), 'ls-files']);
    expect(first.stdout.trim().split('\n')).toEqual(['.gitattributes', 'a.txt']);
    expect(second.stdout.trim()).toBe('b.txt');
  } finally { if (original === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = original; }
});

it('retains an interrupted registration without a ready receipt when authorization is revoked', async () => {
  const repository = randomUUID(); const id = randomUUID(); const root = await store.workspaceRoot(id);
  const authorize = async () => {
    const registered = await access(join(root, '.git')).then(() => true, () => false);
    if (registered) throw new Error('session revoked during registration');
  };
  await expect(worktrees.create(repository, id, new Map([['private.txt', 'private']]), signal(), guard, authorize)).rejects.toThrow(/revoked/);
  const operations = await readdir(join(store.root, 'git-projects', repository, 'operations'));
  expect(operations).toEqual([`${id}.json`]);
  expect(await snapshot(root, true)).toEqual(new Map());
  expect(await store.workspaces()).toEqual([]);
  const registrations = await gitCommand(execution, [`--git-dir=${join(store.root, 'git-projects', repository, 'objects.git')}`, 'worktree', 'list', '--porcelain']);
  expect(registrations.stdout).toContain(`branch refs/heads/relay/${id}`);
});

it('joins interrupted creation before stop resolves and leaves uncertain allocation inspectable', async () => {
  const repository = randomUUID(); const id = randomUUID(); const root = await store.workspaceRoot(id);
  let release!: () => void; let reached!: () => void;
  const waiting = new Promise<void>(resolve => { reached = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  const operation = worktrees.create(repository, id, new Map([['a.txt', 'A']]), signal(), guard, async () => {
    if (await access(join(root, '.git')).then(() => true, () => false)) { reached(); await resume; }
  });
  const outcome = expect(operation).rejects.toThrow(/abort|cancel/i);
  await waiting;
  let stopped = false; const stop = worktrees.stopAll().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  release(); await stop; await outcome;
  expect(await readdir(join(store.root, 'git-projects', repository, 'operations'))).toEqual([`${id}.json`]);
});
