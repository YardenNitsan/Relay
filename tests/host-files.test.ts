import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { HostFileBroker } from '../server/tools/host-files';
import { sha256 } from '../server/tools/files';
import { UncertainToolEffect } from '../server/tools/errors';

let root: string;
let data: string;
let app: string;
let files: string;
let broker: HostFileBroker;
const signal = () => new AbortController().signal;
const guard = () => {};
const result = async (tool: string, args: Record<string, unknown>) => JSON.parse((await broker.execute(tool, args, signal(), guard, 'task-host-test')).content);

beforeEach(async () => {
  // Windows AppData is deliberately protected; do not weaken policy for Temp fixtures.
  await mkdir(resolve('output'), { recursive: true });
  root = await mkdtemp(join(resolve('output'), 'host-file-test-'));
  data = join(root, 'data'); app = join(root, 'application'); files = join(root, 'documents');
  await Promise.all([data, app, files].map(path => mkdir(path)));
  broker = new HostFileBroker(data, app);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('owner host file boundary', () => {
  it('inspects absent versus empty files under the same protected path and credential boundary', async () => {
    const path=join(files,'empty.txt');
    const absent=await broker.inspectFile(path);expect(absent).toMatchObject({hash:null,identity:null});
    await writeFile(path,'');const empty=await broker.inspectFile(path);
    expect(empty.hash).toBe(sha256(''));expect(empty.identity).not.toBeNull();expect(empty.parentIdentity).toEqual(absent.parentIdentity);
    await expect(broker.inspectFile(join(app,'missing.txt'))).rejects.toThrow(/Protected Relay/);
    await writeFile(path,'api_key = secret-value');await expect(broker.inspectFile(path)).rejects.toThrow(/credential/);
    await expect(broker.inspectFile(join(files,'missing-directory/new.txt'))).rejects.toThrow();
  });
  it('persists exclusive creation identity before writing and stops on failed observation', async () => {
    const path=join(files,'created.txt');let observed=false;
    await expect(broker.execute('host_write',{path,content:'must not be written',expectedHash:null},signal(),guard,'observed',undefined,async identity=>{
      observed=true;const info=await lstat(path,{bigint:true});expect(identity).toEqual({dev:String(info.dev),ino:String(info.ino)});
      expect(await readFile(path,'utf8')).toBe('');throw new Error('Journal unavailable');
    })).rejects.toBeInstanceOf(UncertainToolEffect);
    expect(observed).toBe(true);expect(await readFile(path,'utf8')).toBe('');
  });
  it('reads real files and returns evidence and original content hashes', async () => {
    const path = join(files, 'notes.txt'); await writeFile(path, 'real content');
    const value = await broker.execute('host_read', { path }, signal(), guard);
    expect(JSON.parse(value.content)).toMatchObject({ path, content: 'real content', sha256: sha256('real content'), bytes: 12, truncated: false });
    expect(value.evidence).toContainEqual(expect.objectContaining({ kind: 'file_read', passed: true }));
  });
  it('creates, revises and deletes with durable private recovery records', async () => {
    const path = join(files, 'notes.txt');
    const created = await result('host_write', { path, content: 'before', expectedHash: null });
    expect(await readFile(path, 'utf8')).toBe('before');
    const updated = await result('host_write', { path, content: 'after', expectedHash: created.sha256 });
    const checkpoint = JSON.parse(await readFile(join(data, 'host-checkpoints', `${updated.checkpointId}.json`), 'utf8'));
    expect(checkpoint).toMatchObject({ taskId: 'task-host-test', path, before: 'before', beforeHash: sha256('before'), afterHash: sha256('after'), state: 'committed' });
    expect(updated).not.toHaveProperty('before');
    const deleted = await result('host_delete', { path, expectedHash: sha256('after') });
    expect(deleted.sha256).toBeNull();
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(join(data, 'host-checkpoints'))).length).toBe(3);
  });
  it('refuses stale revisions without replacing external edits or creating a checkpoint', async () => {
    const path = join(files, 'notes.txt'); await writeFile(path, 'external edit');
    await expect(result('host_write', { path, content: 'bad', expectedHash: sha256('old') })).rejects.toThrow(/conflict/i);
    expect(await readFile(path, 'utf8')).toBe('external edit');
  });
  it('never deletes directories or creates missing parent directories', async () => {
    await expect(result('host_delete', { path: files, expectedHash: sha256('') })).rejects.toThrow(/regular|directory|file/i);
    await expect(result('host_write', { path: join(files, 'missing', 'child.txt'), content: 'bad', expectedHash: null })).rejects.toThrow(/parent|ENOENT/i);
    await expect(readFile(join(files, 'missing', 'child.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects model-invented fields, permissions, unknown tools and malformed hashes', async () => {
    await expect(result('host_read', { path: join(files, 'x'), approved: true })).rejects.toThrow();
    await expect(result('host_shell', { command: 'whoami' })).rejects.toThrow();
    await expect(result('host_write', { path: join(files, 'x'), content: '', expectedHash: 'bad' })).rejects.toThrow();
    await expect(result('host_delete', { path: join(files, 'x'), expectedHash: null })).rejects.toThrow();
  });
  it.each(['../outside', 'relative.txt', '\\\\server\\share\\x', '//server/share/x', 'C:relative', 'x\u0000'])('rejects ambiguous or nonnative path %s', async path => {
    await expect(result('host_read', { path })).rejects.toThrow();
  });
  it('rejects traversal, hidden paths, device names and alternate streams before normalization', async () => {
    for (const suffix of ['../outside.txt', './notes.txt', '.profile', 'CON', 'file:stream', 'trailing.', 'nested/.env']) {
      await expect(result('host_read', { path: `${files}/${suffix}` })).rejects.toThrow();
    }
  });
  it('denies application, data, OS, vault and credential locations', async () => {
    const blocked = [join(app, 'server.ts'), join(data, 'session.json'), join(files, 'credentials.json'), join(files, 'secret.key'), join(files, '.ssh', 'id_rsa'), join(files, 'AppData', 'Local', 'Vault', 'key'), join(files, 'Library', 'Keychains', 'login.keychain-db')];
    blocked.push(process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd');
    for (const path of blocked) await expect(result('host_read', { path })).rejects.toThrow(/protected|unsafe|forbidden/i);
  });
  it('refuses hard links and linked parent directories', async () => {
    const source = join(files, 'source.txt'); await writeFile(source, 'private');
    const hard = join(files, 'hard.txt'); await link(source, hard);
    await expect(result('host_read', { path: hard })).rejects.toThrow(/link/i);
    const target = join(root, 'linked-target'); await mkdir(target); await writeFile(join(target, 'x.txt'), 'private');
    await symlink(target, join(files, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(result('host_read', { path: join(files, 'linked', 'x.txt') })).rejects.toThrow(/link|reparse/i);
    expect((await result('host_list', { path: files })).entries).toEqual([]);
  });
  it('lists one directory without revealing protected names or traversing children', async () => {
    await writeFile(join(files, 'notes.txt'), 'hello'); await writeFile(join(files, '.env'), 'SECRET=private');
    await mkdir(join(files, 'nested')); await writeFile(join(files, 'nested', 'child.txt'), 'child');
    const listing = await result('host_list', { path: files });
    expect(listing.entries).toEqual([{ name: 'nested', kind: 'directory' }, { name: 'notes.txt', kind: 'file', bytes: 5 }]);
    expect(listing.truncated).toBe(false);
  });
  it('redacts recognizable credentials in otherwise permitted text without falsifying its revision', async () => {
    const content = 'normal notes\nAPI_KEY=sk-supersecretprovidercredential\nAuthorization: Bearer secret-token-value\n';
    const path = join(files, 'notes.txt'); await writeFile(path, content);
    const read = await result('host_read', { path });
    expect(read.content).toContain('normal notes'); expect(read.content).not.toContain('supersecret'); expect(read.content).not.toContain('secret-token-value');
    expect(read.redacted).toBe(true); expect(read.sha256).toBe(sha256(content));
  });
  it('denies overwriting or deleting credential-bearing content even with its correct hash', async () => {
    const path = join(files, 'notes.txt'); const content = 'API_KEY=sk-do-not-destroy-this-credential';
    await writeFile(path, content);
    for (const tool of ['host_write', 'host_delete']) {
      await expect(result(tool, { path, expectedHash: sha256(content), ...(tool === 'host_write' ? { content: 'replacement' } : {}) })).rejects.toThrow(/protected credential/i);
    }
    expect(await readFile(path, 'utf8')).toBe(content);
    await expect(readdir(join(data, 'host-checkpoints'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['profile.ps1', 'Microsoft.PowerShell_profile.ps1', 'Microsoft.VSCode_profile.ps1'])('protects executable shell startup profile %s', async name => {
    await expect(result('host_write', { path: join(files, name), content: 'malicious startup action', expectedHash: null })).rejects.toThrow(/protected/i);
  });
  it('anchors the default protected installation independently from the working directory', async () => {
    const sourceFile = resolve('server/tools/host-files.ts');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(files);
    try {
      const defaultBroker = new HostFileBroker(data);
      await expect(defaultBroker.execute('host_read', { path: sourceFile }, signal(), guard)).rejects.toThrow(/protected/i);
    } finally { cwd.mockRestore(); }
  });
  it('preserves the existing file identity and POSIX permission bits while changing content', async () => {
    const path = join(files, 'script.sh'); await writeFile(path, 'original content');
    if (process.platform !== 'win32') await chmod(path, 0o750);
    const before = await lstat(path);
    await result('host_write', { path, content: 'short', expectedHash: sha256('original content') });
    const after = await lstat(path);
    expect(await readFile(path, 'utf8')).toBe('short');
    expect({ dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid }).toEqual({ dev: before.dev, ino: before.ino, mode: before.mode, uid: before.uid, gid: before.gid });
  });
  it('reports cancellation after an actual write as an uncertain effect and preserves recovery data', async () => {
    const path = join(files, 'notes.txt'); const before = 'before'; await writeFile(path, before);
    // Observe the real file in the controller guard; revoke only after bytes changed.
    const { readFileSync } = await import('node:fs');
    const stopAfterWrite = () => { if (readFileSync(path, 'utf8') !== before) throw new Error('Emergency stop during commit'); };
    await expect(broker.execute('host_write', { path, content: 'changed', expectedHash: sha256(before) }, signal(), stopAfterWrite)).rejects.toBeInstanceOf(UncertainToolEffect);
    const names = await readdir(join(data, 'host-checkpoints'));
    const checkpoint = JSON.parse(await readFile(join(data, 'host-checkpoints', names[0]), 'utf8'));
    expect(checkpoint).toMatchObject({ before, beforeHash: sha256(before), state: 'prepared' });
  });
  it('blocks binary and oversized text and bounds returned output', async () => {
    const path = join(files, 'notes.txt'); await writeFile(path, 'x'.repeat(40_000));
    expect(await result('host_read', { path })).toMatchObject({ truncated: true, bytes: 40_000 });
    await expect(result('host_write', { path, content: 'x'.repeat(1024 * 1024 + 1), expectedHash: sha256('x'.repeat(40_000)) })).rejects.toThrow(/limit/i);
    await writeFile(path, Buffer.from([0xff, 0, 0xfe]));
    await expect(result('host_read', { path })).rejects.toThrow();
  });
  it('honors cancellation and a revoked broker guard before any host mutation', async () => {
    const path = join(files, 'notes.txt'); const controller = new AbortController(); controller.abort();
    await expect(broker.execute('host_write', { path, content: 'bad', expectedHash: null }, controller.signal, guard)).rejects.toThrow(/cancel/i);
    await expect(broker.execute('host_write', { path, content: 'bad', expectedHash: null }, signal(), () => { throw new Error('Emergency stop'); })).rejects.toThrow(/stop/i);
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
