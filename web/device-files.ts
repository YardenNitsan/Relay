/** Browser-selected folders only. Handles are deliberately never serialized. */
export interface DeviceFileHandle {
  kind: 'file'; name: string;
  getFile(): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{ write(content: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}
export interface DeviceDirectoryHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<DeviceDirectoryHandle | DeviceFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DeviceDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<DeviceFileHandle>;
  removeEntry(name: string): Promise<void>;
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
export interface DeviceFile { path: string; content: string; hash: string; bytes: number }
export interface DeviceChange { path: string; before: DeviceFile | null; after: DeviceFile | null }
export const DEVICE_LIMITS = { files: 100, bytes: 5 * 1024 * 1024, fileBytes: 240 * 1024, entries: 2000, depth: 16 };
const blocked = /^(?:\..*|node_modules|vendor|dist|build|coverage|target|venv|__pycache__|credentials?(?:\..*)?|secrets?(?:\..*)?|id_rsa.*|id_ed25519.*)$/i;
const extension = /\.(?:txt|md|markdown|json|jsonc|yaml|yml|toml|csv|tsv|log|html|css|scss|js|jsx|mjs|cjs|ts|tsx|py|rs|go|java|c|h|cpp|hpp|cs|sql|xml|svg|ini|cfg)$/i;
export function safeDevicePath(path: string, directory = false): boolean {
  const parts = path.split('/');
  return path.length <= 400 && !/\p{Cf}/u.test(path) && parts.length <= DEVICE_LIMITS.depth && parts.every(part => !!part && part.length <= 160 && !blocked.test(part) && !/[\\:\x00-\x1f\x7f<>"|?*]/.test(part) && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)) && (directory || extension.test(path) || /^(?:README|LICENSE|Dockerfile|Makefile)$/i.test(parts.at(-1)!));
}
export async function contentHash(content: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function textDocument(path: string, content: string): Promise<DeviceFile> {
  if (!safeDevicePath(path)) throw new Error(`Unsupported or protected file: ${path}`);
  const bytes = new TextEncoder().encode(content).byteLength;
  if (bytes > DEVICE_LIMITS.fileBytes || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new Error(`Not a bounded text file: ${path}`);
  return { path, content, bytes, hash: await contentHash(content) };
}
async function readFile(path: string, handle: DeviceFileHandle): Promise<DeviceFile> {
  const file = await handle.getFile();
  if (file.size > DEVICE_LIMITS.fileBytes) throw new Error(`File exceeds 240 KiB: ${path}`);
  const data = await file.arrayBuffer();
  if (data.byteLength > DEVICE_LIMITS.fileBytes) throw new Error(`File exceeds 240 KiB: ${path}`);
  return textDocument(path, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data));
}
export async function scanDeviceFolder(root: DeviceDirectoryHandle): Promise<{ files: DeviceFile[]; skipped: number }> {
  if (await root.queryPermission({ mode: 'read' }) !== 'granted') throw new Error('Folder read permission was revoked. Choose the folder again.');
  const files: DeviceFile[] = []; let entries = 0; let total = 0; let skipped = 0;
  const visit = async (directory: DeviceDirectoryHandle, prefix: string): Promise<void> => {
    for await (const handle of directory.values()) {
      if (++entries > DEVICE_LIMITS.entries) throw new Error('Folder exceeds the 2,000-entry scan limit. Choose a smaller folder.');
      const path = prefix + handle.name;
      if (!safeDevicePath(path, handle.kind === 'directory')) { skipped++; continue; }
      if (handle.kind === 'directory') { await visit(handle, path + '/'); continue; }
      if (files.length >= DEVICE_LIMITS.files) throw new Error('Folder exceeds 100 text files. Choose a smaller folder.');
      let file: DeviceFile;
      try { file = await readFile(path, handle); }
      catch (error) {
        if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) throw error;
        skipped++; continue;
      }
      total += file.bytes;
      if (total > DEVICE_LIMITS.bytes) throw new Error('Folder exceeds 5 MiB of text. Choose a smaller folder.');
      files.push(file);
    }
  };
  await visit(root, ''); return { files: files.sort((a, b) => a.path.localeCompare(b.path)), skipped };
}
export function deviceChanges(baseline: ReadonlyMap<string, DeviceFile>, current: DeviceFile[]): DeviceChange[] {
  if (current.length > DEVICE_LIMITS.files || current.reduce((sum, file) => sum + file.bytes, 0) > DEVICE_LIMITS.bytes) throw new Error('Managed copy exceeds device review limits.');
  const map = new Map(current.map(file => [file.path, file]));
  if (map.size !== current.length) throw new Error('Duplicate file paths in managed copy.');
  return [...new Set([...baseline.keys(), ...map.keys()])].sort().flatMap(path => {
    if (!safeDevicePath(path)) throw new Error('Managed copy includes an unsupported or protected path.');
    const before = baseline.get(path) ?? null; const after = map.get(path) ?? null;
    return before?.hash === after?.hash ? [] : [{ path, before, after }];
  });
}
async function parentFolder(root: DeviceDirectoryHandle, path: string, create: boolean): Promise<DeviceDirectoryHandle> {
  let parent = root;
  for (const segment of path.split('/').slice(0, -1)) parent = await parent.getDirectoryHandle(segment, { create });
  return parent;
}
async function currentFile(root: DeviceDirectoryHandle, path: string): Promise<DeviceFile | null> {
  try { return await readFile(path, await (await parentFolder(root, path, false)).getFileHandle(path.split('/').at(-1)!)); }
  catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error; }
}
async function checkUnchanged(root: DeviceDirectoryHandle, change: DeviceChange): Promise<void> {
  const current = await currentFile(root, change.path);
  if ((current?.hash ?? null) !== (change.before?.hash ?? null)) throw new Error(`Device file changed since import: ${change.path}. No overwrite was attempted for this file.`);
}
/** Explicit UI action only. Browser FS has no atomic compare-and-swap; keep editors closed while applying. */
export async function applyDeviceChanges(root: DeviceDirectoryHandle, changes: DeviceChange[], options: { allowDelete: boolean; active: () => boolean; onApplied: (change: DeviceChange) => void }): Promise<void> {
  const assertActive = () => { if (!options.active()) throw new Error('Folder connection ended. Remaining changes were stopped.'); };
  assertActive();
  if (changes.length > DEVICE_LIMITS.files || changes.reduce((sum, change) => sum + (change.after?.bytes ?? 0), 0) > DEVICE_LIMITS.bytes) throw new Error('Selection exceeds device write limits.');
  if (new Set(changes.map(change => change.path)).size !== changes.length) throw new Error('Duplicate selected paths.');
  // Invoke before asynchronous hashes or network work consume transient user activation.
  if (await root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Device write permission was not granted. No device files were changed.');
  for (const change of changes) {
    if (!safeDevicePath(change.path)) throw new Error('Unsupported or protected path.');
    if (!change.after && !options.allowDelete) throw new Error('Confirm device file deletion before applying.');
    if (change.after) { const validated = await textDocument(change.path, change.after.content); if (validated.hash !== change.after.hash) throw new Error('Review content changed. Review again.'); }
  }
  for (const change of changes) { assertActive(); await checkUnchanged(root, change); }
  for (const change of changes) {
    assertActive();
    if (await root.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Device write permission was revoked. Remaining changes were stopped.');
    await checkUnchanged(root, change); assertActive();
    const parent = await parentFolder(root, change.path, change.after != null); const name = change.path.split('/').at(-1)!;
    if (!change.after) { assertActive(); await parent.removeEntry(name); }
    else {
      const handle = await parent.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      try {
        // Opening a temporary writable stream must not allow a stale preview to overwrite a changed original.
        if (change.before) await checkUnchanged(root, change);
        else if ((await handle.getFile()).size !== 0) throw new Error(`A device file appeared: ${change.path}.`);
        assertActive(); await writer.write(change.after.content); assertActive(); await writer.close();
      } catch (error) { await writer.abort().catch(() => {}); throw error; }
    }
    options.onApplied(change);
  }
}
