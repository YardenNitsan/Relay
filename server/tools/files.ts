import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { FILE_COUNT_LIMIT, FILE_LIMIT, inspectPath, protectedName, readFlags, safePath, WORKSPACE_LIMIT } from './platform';

export type Guard = () => void;
export const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
export const hashOrNull = (content: string | null) => content === null ? null : sha256(content);
export function boundedText(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > FILE_LIMIT) throw new Error('File exceeds the 1 MiB size limit');
  if (content.includes('\0')) throw new Error('Only UTF-8 text files are supported');
}

export async function readText(root: string, path: string, optional = false): Promise<string | null> {
  const target = await inspectPath(root, path);
  let handle;
  try {
    const before = await lstat(target);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error('File links and non-regular files are forbidden');
    if (before.size > FILE_LIMIT) throw new Error('File exceeds the 1 MiB size limit');
    handle = await open(target, readFlags());
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('File changed or became a link while opening');
    const buffer = Buffer.alloc(FILE_LIMIT + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > FILE_LIMIT) throw new Error('File exceeds the 1 MiB size limit');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    boundedText(content);
    await inspectPath(root, path);
    return content;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

export async function ensureParent(root: string, path: string): Promise<void> {
  const parts = path.split('/'); parts.pop();
  let relative = '';
  for (const part of parts) {
    relative = relative ? `${relative}/${part}` : part;
    const target = await inspectPath(root, relative);
    await mkdir(target, { recursive: true, mode: 0o700 });
    await inspectPath(root, relative);
  }
}

export async function replaceText(root: string, path: string, content: string | null, expectedHash: string | null, guard: Guard): Promise<void> {
  safePath(path); if (content !== null) boundedText(content);
  guard();
  if (hashOrNull(await readText(root, path, true)) !== expectedHash) throw new Error(`Content conflict: ${path} changed since it was read`);
  await ensureParent(root, path);
  const target = await inspectPath(root, path);
  if (content === null) {
    guard(); await unlink(target);
    if (await readText(root, path, true) !== null) throw new Error('File deletion verification failed');
    return;
  }
  const temp = join(dirname(target), `.relay-${randomUUID()}.tmp`);
  let temporaryExists = false;
  try {
    const handle = await open(temp, 'wx', 0o600); temporaryExists = true;
    try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    if (hashOrNull(await readText(root, path, true)) !== expectedHash) throw new Error(`Content conflict: ${path} changed before commit`);
    await inspectPath(root, path); guard();
    await rename(temp, target); temporaryExists = false;
    if (hashOrNull(await readText(root, path)) !== sha256(content)) throw new Error('Written content verification failed');
  } finally { if (temporaryExists) await unlink(temp).catch(() => undefined); }
}

export async function listTextFiles(root: string, path = '', strict = false): Promise<string[]> {
  const result: string[] = [];
  let seen = 0;
  async function walk(rel: string): Promise<void> {
    const absolute = await inspectPath(root, rel);
    const entries = await readdir(absolute, { withFileTypes: true });
    if (entries.length > 10_000) throw new Error('Directory entry limit exceeded');
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++seen > 10_000) throw new Error('Workspace traversal limit exceeded');
      if (protectedName(entry.name)) continue;
      const candidate = rel ? `${rel}/${entry.name}` : entry.name;
      try {
        safePath(candidate);
        const target = await inspectPath(root, candidate);
        const info = await lstat(target);
        if (info.isDirectory()) await walk(candidate);
        else if (info.isFile() && info.nlink === 1 && info.size <= FILE_LIMIT) {
          result.push(candidate);
          if (result.length > FILE_COUNT_LIMIT) throw new Error('Workspace file count limit exceeded');
        } else if (strict) throw new Error(`Unsafe or oversized generated file: ${candidate}`);
      } catch (error) {
        if (strict || /limit exceeded/.test(String(error))) throw error;
        // Imports/listings omit unsupported objects; direct reads always report a denial.
      }
    }
  }
  await walk(path);
  return result.sort();
}

export async function snapshot(root: string, strict = false): Promise<Map<string, string>> {
  const files = new Map<string, string>(); let bytes = 0;
  for (const path of await listTextFiles(root, '', strict)) {
    try {
      const content = (await readText(root, path))!;
      bytes += Buffer.byteLength(content);
      if (bytes > WORKSPACE_LIMIT) throw new Error('Workspace exceeds the 50 MiB limit');
      files.set(path, content);
    } catch (error) { if (strict || /limit/.test(String(error))) throw error; }
  }
  return files;
}

export async function copySnapshot(root: string, contents: Map<string, string>, guard: Guard): Promise<void> {
  for (const [path, content] of contents) { guard(); await replaceText(root, path, content, null, guard); }
}
