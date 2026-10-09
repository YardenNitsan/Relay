import { describe, expect, it } from 'vitest';
import { applyDeviceChanges, deviceChanges, scanDeviceFolder, safeDevicePath, textDocument, type DeviceDirectoryHandle, type DeviceFileHandle } from './device-files';

class FileHandle implements DeviceFileHandle {
  readonly kind = 'file'; writes = 0;
  constructor(readonly name: string, public content: string) {}
  async getFile() { const bytes = new TextEncoder().encode(this.content); return { size: bytes.length, arrayBuffer: async () => bytes.buffer }; }
  async createWritable() { let content = this.content; return { write: async (value: string) => { content = value; }, close: async () => { this.content = content; this.writes++; }, abort: async () => {} }; }
}
class Directory implements DeviceDirectoryHandle {
  readonly kind = 'directory'; children = new Map<string, Directory | FileHandle>(); permission: PermissionState = 'granted'; requests = 0;
  constructor(readonly name = 'test') {}
  async *values() { yield* this.children.values(); }
  async queryPermission() { return this.permission; }
  async requestPermission() { this.requests++; return this.permission; }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) { const found = this.children.get(name); if (found instanceof Directory) return found; if (found) throw new DOMException('Wrong kind', 'TypeMismatchError'); if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); const next = new Directory(name); this.children.set(name, next); return next; }
  async getFileHandle(name: string, options?: { create?: boolean }) { const found = this.children.get(name); if (found instanceof FileHandle) return found; if (found) throw new DOMException('Wrong kind', 'TypeMismatchError'); if (!options?.create) throw new DOMException('Missing', 'NotFoundError'); const next = new FileHandle(name, ''); this.children.set(name, next); return next; }
  async removeEntry(name: string) { this.children.delete(name); }
  add(name: string, content: string) { const file = new FileHandle(name, content); this.children.set(name, file); return file; }
}
const options = { allowDelete: false, active: () => true, onApplied: () => {} };

describe('device folder boundaries', () => {
  it('refuses traversal, secrets, generated trees and ambiguous Windows names', () => {
    for (const path of ['../a.txt', '/a.txt', 'a\\b.txt', '.env', '.aws/config', 'credentials.json', 'secret.json', 'node_modules/a.ts', 'dist/a.js', 'a:b.txt', 'NUL.txt', 'a./b.txt', 'a//b.txt', 'a\u0000.txt', 'key.pem']) expect(safeDevicePath(path), path).toBe(false);
    expect(safeDevicePath('src/auth.ts')).toBe(true);
    expect(safeDevicePath('hidden\u202efile.txt')).toBe(false);
    expect(safeDevicePath('COM¹.txt')).toBe(false);
  });
  it('scans only bounded safe text without inspecting excluded folders', async () => {
    const root = new Directory(); root.add('hello.md', 'hi'); root.add('.env', 'private'); root.add('image.png', 'binary'); root.add('bad.txt', '\u0000');
    const blocked = new Directory('node_modules'); blocked.values = () => { throw new Error('must not read'); }; root.children.set(blocked.name, blocked);
    const scan = await scanDeviceFolder(root);
    expect(scan.files.map(file => file.path)).toEqual(['hello.md']); expect(scan.skipped).toBe(4);
  });
  it('refuses read permission revocation and malformed UTF-8', async () => {
    const root = new Directory(); root.permission = 'denied'; await expect(scanDeviceFolder(root)).rejects.toThrow('revoked');
    root.permission = 'granted'; const file = root.add('invalid.txt', ''); file.getFile = async () => ({ size: 2, arrayBuffer: async () => Uint8Array.from([0xc3, 0x28]).buffer });
    expect((await scanDeviceFolder(root)).files).toHaveLength(0);
  });
  it('enforces file, byte and traversal quotas without returning a partial import', async () => {
    const many = new Directory(); for (let index = 0; index < 101; index++) many.add(`${index}.txt`, 'x');
    await expect(scanDeviceFolder(many)).rejects.toThrow('100 text');
    const large = new Directory(); for (let index = 0; index < 23; index++) large.add(`${index}.txt`, 'x'.repeat(240 * 1024));
    await expect(scanDeviceFolder(large)).rejects.toThrow('5 MiB');
    const entries = new Directory(); for (let index = 0; index < 2001; index++) entries.add(`${index}.png`, '');
    await expect(scanDeviceFolder(entries)).rejects.toThrow('2,000');
  });
  it('preserves a UTF-8 BOM in the hash and upload content', async () => {
    const root = new Directory(); root.add('bom.txt', '\ufefftext');
    expect((await scanDeviceFolder(root)).files[0]?.content).toBe('\ufefftext');
  });
  it('produces added, modified and deleted review entries', async () => {
    const old = await textDocument('old.txt', 'old'); const deleted = await textDocument('delete.txt', 'delete');
    const changes = deviceChanges(new Map([[old.path, old], [deleted.path, deleted]]), [await textDocument('old.txt', 'changed'), await textDocument('new.txt', 'new')]);
    expect(changes.map(change => [change.path, !!change.before, !!change.after])).toEqual([['delete.txt', true, false], ['new.txt', false, true], ['old.txt', true, true]]);
  });
  it('preflights the entire batch and refuses overwriting an external edit', async () => {
    const root = new Directory(); const first = root.add('a.txt', 'original'); root.add('b.txt', 'externally changed');
    const changes = [{ path: 'a.txt', before: await textDocument('a.txt', 'original'), after: await textDocument('a.txt', 'new') }, { path: 'b.txt', before: await textDocument('b.txt', 'original'), after: await textDocument('b.txt', 'new') }];
    await expect(applyDeviceChanges(root, changes, options)).rejects.toThrow('changed since import'); expect(first.writes).toBe(0); expect(first.content).toBe('original');
  });
  it('will not overwrite an existing device file when the managed copy adds it', async () => {
    const root = new Directory(); const original = root.add('new.txt', 'mine');
    await expect(applyDeviceChanges(root, [{ path: 'new.txt', before: null, after: await textDocument('new.txt', 'new') }], options)).rejects.toThrow('changed since import'); expect(original.content).toBe('mine');
  });
  it('requires explicit delete confirmation and stops on write revocation', async () => {
    const root = new Directory(); root.add('old.txt', 'old'); const change = { path: 'old.txt', before: await textDocument('old.txt', 'old'), after: null };
    await expect(applyDeviceChanges(root, [change], options)).rejects.toThrow('Confirm device file deletion'); expect(root.children.has('old.txt')).toBe(true);
    root.permission = 'denied'; await expect(applyDeviceChanges(root, [change], { ...options, allowDelete: true })).rejects.toThrow('not granted'); expect(root.children.has('old.txt')).toBe(true);
  });
  it('updates only selected changes and can explicitly delete', async () => {
    const root = new Directory(); root.add('old.txt', 'old'); const changed = await textDocument('old.txt', 'new'); let applied = 0;
    await applyDeviceChanges(root, [{ path: changed.path, before: await textDocument('old.txt', 'old'), after: changed }], { ...options, onApplied: () => { applied++; } });
    expect((await root.getFileHandle('old.txt')).content).toBe('new'); expect(applied).toBe(1);
    await applyDeviceChanges(root, [{ path: changed.path, before: changed, after: null }], { ...options, allowDelete: true }); expect(root.children.has('old.txt')).toBe(false);
  });
  it('stops remaining effects after session invalidation', async () => {
    const root = new Directory(); let active = true;
    const changes = [{ path: 'a.txt', before: null, after: await textDocument('a.txt', 'a') }, { path: 'b.txt', before: null, after: await textDocument('b.txt', 'b') }];
    await expect(applyDeviceChanges(root, changes, { ...options, active: () => active, onApplied: () => { active = false; } })).rejects.toThrow('connection ended');
    expect(root.children.has('a.txt')).toBe(true); expect(root.children.has('b.txt')).toBe(false);
  });
  it('rechecks the original after opening a write stream', async () => {
    const root = new Directory(); const file = root.add('a.txt', 'old'); const create = file.createWritable.bind(file);
    file.createWritable = async () => { const stream = await create(); file.content = 'external edit'; return stream; };
    await expect(applyDeviceChanges(root, [{ path: 'a.txt', before: await textDocument('a.txt', 'old'), after: await textDocument('a.txt', 'new') }], options)).rejects.toThrow('changed since import');
    expect(file.content).toBe('external edit'); expect(file.writes).toBe(0);
  });
  it('will not commit staged content after the session ends', async () => {
    const root = new Directory(); const file = root.add('a.txt', 'old'); let active = true; const create = file.createWritable.bind(file);
    file.createWritable = async () => { const stream = await create(); return { ...stream, write: async (value: string) => { await stream.write(value); active = false; } }; };
    await expect(applyDeviceChanges(root, [{ path: 'a.txt', before: await textDocument('a.txt', 'old'), after: await textDocument('a.txt', 'new') }], { ...options, active: () => active })).rejects.toThrow('connection ended');
    expect(file.content).toBe('old'); expect(file.writes).toBe(0);
  });
});
