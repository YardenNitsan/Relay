import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { ToolResult } from '../../shared/types';
import { AppError } from '../core/errors';
import { privateDirectory, writePrivate } from '../host/private-storage';
import { boundedText, hashOrNull, readText, replaceText, sha256, type Guard } from './files';
import { FILE_LIMIT, inside, inspectPath, OUTPUT_LIMIT, protectedName } from './platform';
import { StorageBudget } from './storage-budget';
import { UncertainToolEffect } from './errors';
import type {PublicationFileIdentity} from '../../shared/publication';

export interface HostFileState {hash:string|null;identity:PublicationFileIdentity|null;parentIdentity:PublicationFileIdentity}
export interface HostDestinationPlan {state:HostFileState|null;directories:Array<{path:string;parentIdentity:PublicationFileIdentity|null}>}
type CreationObserver=(identity:PublicationFileIdentity)=>Promise<void>;
const fileIdentity=async(path:string):Promise<PublicationFileIdentity>=>{const info=await lstat(path,{bigint:true});return {dev:String(info.dev),ino:String(info.ino)};};

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const pathArgument = z.string().min(1).max(2048);
const schemas = {
  host_list: z.object({ path: pathArgument }).strict(),
  host_read: z.object({ path: pathArgument }).strict(),
  host_write: z.object({ path: pathArgument, content: z.string(), expectedHash: revision.nullable() }).strict(),
  host_delete: z.object({ path: pathArgument, expectedHash: revision }).strict(),
};
type HostTool = keyof typeof schemas;
type ParsedRequest = { path: string; content?: string; expectedHash?: string | null };
interface RecoveryRecord {
  id: string;
  taskId: string | null;
  tool: 'host_write' | 'host_delete';
  path: string;
  createdAt: string;
  state: 'prepared' | 'committed';
  before: string | null;
  beforeHash: string | null;
  afterHash: string | null;
}
const deniedComponents = new Set([
  'appdata', 'library', 'keychains', 'keychain', 'vault', 'vaults', 'keyrings',
  'windows', 'system32', 'syswow64', 'winsxs', 'program files', 'program files (x86)',
  'programdata', 'system volume information', '$recycle.bin', 'recovery', 'efi',
  'boot', 'startup', 'launchagents', 'launchdaemons', 'autostart',
]);
const deniedFiles = /^(?:pagefile\.sys|swapfile\.sys|hiberfil\.sys|bootmgr|boot\.ini|ntuser(?:\..*)?|usrclass\.dat(?:\..*)?|login data|local state|cookies|logins\.json|key[34]\.db|wallet(?:\..*)?|.*\.keychain(?:-db)?|.*profile\.ps1)$/i;
const deviceName = /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i;
const posixSystemRoots = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/lib64', '/proc', '/sys', '/dev', '/run', '/boot', '/root', '/var', '/private/etc', '/private/var', '/System', '/Library', '/Applications', '/Network'];
const CHECKPOINT_BYTES = 256 * 1024 * 1024;
const CHECKPOINT_COUNT = 2000;
const LIST_COUNT = 100;
const LIST_SCAN = 500;
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
// Source lives in server/tools; the bundled host lives in dist-server. CWD is
// user-controlled and must never determine which installation is protected.
const installationRoot = resolve(moduleDirectory, basename(moduleDirectory) === 'tools' && basename(dirname(moduleDirectory)) === 'server' ? '../..' : '..');

function comparable(path: string): string { return process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path); }
function protectedComponent(part: string): boolean {
  return part.startsWith('.') || protectedName(part) || deniedComponents.has(part.toLowerCase()) || deniedFiles.test(part);
}

/** Best-effort output redaction is additional protection, never a substitute for path policy. */
function redactedText(content: string): { content: string; redacted: boolean } {
  const output = content
    .replace(/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, '[redacted credential]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted credential]')
    .replace(/^(\s*(?:export\s+)?["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key)[\w.-]*["']?\s*[:=]\s*).*$/gim, '$1[redacted credential]');
  return { content: output, redacted: output !== content };
}

/** Owner policy and task capabilities are enforced by ToolBroker before entry.
 * These structured operations deliberately never execute file contents or shell commands.
 * This is not an isolation boundary against a hostile process running as the OS owner:
 * Node path rechecks reduce link races but do not provide native handle-relative traversal.
 */
export class HostFileBroker {
  private readonly dataDir: string;
  private readonly protectedRoots: string[];
  private readonly checkpointRoot: string;
  private checkpointReady = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string, protectedAppRoot = installationRoot) {
    this.dataDir = resolve(dataDir);
    this.checkpointRoot = join(this.dataDir, 'host-checkpoints');
    this.protectedRoots = [this.dataDir, resolve(protectedAppRoot)];
    if (process.platform === 'win32') {
      for (const name of ['SystemRoot', 'WINDIR', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'APPDATA', 'LOCALAPPDATA']) {
        const path = process.env[name]; if (path && isAbsolute(path)) this.protectedRoots.push(resolve(path));
      }
    } else this.protectedRoots.push(...posixSystemRoots);
  }

  /** Internal owner-review inspection, deliberately not an LLM tool. Missing leaves
   * still traverse the complete protected path and require an existing parent. */
  async inspectFile(value:string,authorize?:()=>Promise<void>):Promise<HostFileState>{
    const operation=this.queue.then(async()=>{
      await authorize?.();const path=this.validatePath(value);await this.inspect(path,true,()=>{});
      const parentIdentity=await fileIdentity(dirname(path)),content=await readText(dirname(path),basename(path),true);
      if(content!==null&&redactedText(content).redacted)throw new AppError('PUBLICATION_PROTECTED','Protected credential content cannot be published.',403);
      const identity=content===null?null:await fileIdentity(path);
      await this.inspect(path,true,()=>{});await authorize?.();
      const parentAfter=await fileIdentity(dirname(path));
      if(parentAfter.dev!==parentIdentity.dev||parentAfter.ino!==parentIdentity.ino)throw new AppError('PUBLICATION_IDENTITY','Original parent identity changed during inspection.',409);
      return {hash:hashOrNull(content),identity,parentIdentity};
    });
    this.queue=operation.catch(()=>undefined);return operation;
  }

  /** Owner publication planning only. No host tool exposes directory creation. */
  async planPublicationFile(value:string,authorize:()=>Promise<void>):Promise<HostDestinationPlan>{
    try{return {state:await this.inspectFile(value,authorize),directories:[]};}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    const operation=this.queue.then(async()=>{
      await authorize();const path=this.validatePath(value),missing:string[]=[];let cursor=dirname(path);
      for(;;){
        try{
          await this.inspect(cursor,false,()=>{});const info=await lstat(cursor,{bigint:true});
          if(!info.isDirectory())throw new Error('Publication file parent must be a directory');
          if(!missing.length)throw new AppError('PUBLICATION_CHANGED','Destination changed during planning. Refresh the review.',409);
          const parentIdentity={dev:String(info.dev),ino:String(info.ino)};await authorize();
          return {state:null,directories:missing.reverse().map((path,index)=>({path,parentIdentity:index===0?parentIdentity:null}))};
        }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        missing.push(cursor);const parent=dirname(cursor);if(parent===cursor||missing.length>64)throw new Error('Publication directory plan exceeds its path boundary');cursor=parent;
      }
    });
    this.queue=operation.catch(()=>undefined);return operation;
  }

  async createPublicationDirectory(value:string,expectedParent:PublicationFileIdentity,authorize:()=>Promise<void>,signal:AbortSignal,onCreated:CreationObserver):Promise<PublicationFileIdentity>{
    const check=()=>{if(signal.aborted)throw new AppError('CANCELLED','Directory creation was cancelled',409);};
    const operation=this.queue.then(async()=>{
      check();await authorize();check();const path=this.validatePath(value);await this.inspect(path,true,check);
      const parent=await fileIdentity(dirname(path));if(parent.dev!==expectedParent.dev||parent.ino!==expectedParent.ino)throw new AppError('PUBLICATION_IDENTITY','Directory parent identity changed before creation.',409);
      await authorize();check();await mkdir(path,{mode:0o700});
      // Creation must be recorded even if authority expires immediately after
      // mkdir. Recording an already-created identity grants no further access.
      const created=await fileIdentity(path);await this.inspect(path,false,()=>{});await onCreated(created);check();return created;
    });
    this.queue=operation.catch(()=>undefined);return operation;
  }

  async execute(tool: string, arguments_: Record<string, unknown>, signal: AbortSignal | undefined, guard: Guard, taskId?: string, authorize?:()=>Promise<void>,onCreated?:CreationObserver): Promise<ToolResult> {
    const check = () => { guard(); if (signal?.aborted) throw new AppError('CANCELLED', 'Host file operation was cancelled', 409); };
    check();
    if (!Object.hasOwn(schemas, tool)) throw new Error('Unknown host file tool');
    const args = schemas[tool as HostTool].parse(arguments_) as ParsedRequest;
    if (taskId !== undefined && (!taskId || taskId.length > 160 || /[\x00-\x1f]/.test(taskId))) throw new Error('Invalid host checkpoint task identity');
    if (tool === 'host_write') boundedText(args.content!);
    const operation = this.queue.then(async () => {
      await authorize?.();check();
      check(); const path = this.validatePath(args.path);
      await this.inspect(path, tool === 'host_write', check);
      if (tool === 'host_list') return this.list(path, check);
      if (tool === 'host_read') return this.read(path, check);
      return this.mutate(tool as 'host_write' | 'host_delete', path, args, check, taskId,authorize,onCreated);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private validatePath(value: string): string {
    if (!isAbsolute(value) || value.startsWith('\\\\') || value.startsWith('//') || /[\x00-\x1f\x7f]/.test(value) || /\p{Cf}/u.test(value)) throw new Error('Unsafe host path: use an absolute local path');
    if (process.platform === 'win32' ? !/^[A-Za-z]:[\\/]/.test(value) : /[\\:]/.test(value)) throw new Error('Unsafe host path: device, network and nonnative paths are forbidden');
    const volume = parse(value).root;
    const parts = value.slice(volume.length).split(process.platform === 'win32' ? /[\\/]/ : /\//);
    if (!parts.length || parts.length > 64 || parts.some(part => !part || part === '.' || part === '..' || part.length > 200 || /[. ]$/.test(part) || /[<>:"|?*]/.test(part) || deviceName.test(part))) throw new Error('Unsafe host path components');
    if (parts.some(protectedComponent)) throw new Error('Protected host, credential or system path is forbidden');
    const path = resolve(value);
    if (this.protectedRoots.some(root => inside(root, path))) throw new Error('Protected Relay, credential or operating-system path is forbidden');
    return path;
  }

  /** Walk every ancestor from the volume, rejecting junctions, aliases and special files. */
  private async inspect(path: string, missingLeaf: boolean, check: Guard): Promise<void> {
    const volume = parse(path).root;
    const parts = path.slice(volume.length).split(process.platform === 'win32' ? /[\\/]/ : /\//);
    let current = volume;
    for (let index = -1; index < parts.length; index++) {
      if (index >= 0) current = join(current, parts[index]);
      check();
      try {
        const info = await lstat(current); check();
        if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new Error('Host links, reparse points and non-regular files are forbidden');
        if (index < parts.length - 1 && !info.isDirectory()) throw new Error('Host file parent must be an existing directory');
        const canonical = await realpath(current); check();
        if (comparable(canonical) !== comparable(current)) throw new Error('Host path contains a link, reparse point or filesystem alias');
      } catch (error) {
        if (missingLeaf && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
    }
  }

  private async list(path: string, check: Guard): Promise<ToolResult> {
    const entries: { name: string; kind: 'file' | 'directory'; bytes?: number }[] = [];
    let scanned = 0; let truncated = false;
    check(); const directory = await opendir(path); check();
    for await (const entry of directory) {
      check();
      if (++scanned > LIST_SCAN || entries.length >= LIST_COUNT) { truncated = true; break; }
      if (protectedComponent(entry.name)) continue;
      try {
        const candidate = this.validatePath(join(path, entry.name));
        await this.inspect(candidate, false, check);
        const info = await lstat(candidate); check();
        if (info.isDirectory()) entries.push({ name: entry.name, kind: 'directory' });
        else if (info.isFile() && info.nlink === 1 && info.size <= FILE_LIMIT) entries.push({ name: entry.name, kind: 'file', bytes: info.size });
      } catch { check(); /* Listing omits protected, linked, changed and unsupported entries. */ }
    }
    await this.inspect(path, false, check); check();
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { content: JSON.stringify({ path, entries, truncated }), evidence: [{ kind: 'file_listing', summary: `Inspected ${entries.length} permitted host entries${truncated ? ' (listing bounded)' : ''}`, passed: true, details: { path, entries: entries.length, truncated } }] };
  }

  private async read(path: string, check: Guard): Promise<ToolResult> {
    check(); const content = (await readText(dirname(path), basename(path)))!;
    await this.inspect(path, false, check); check();
    const clean = redactedText(content); const truncated = clean.content.length > OUTPUT_LIMIT;
    const details = { path, sha256: sha256(content), bytes: Buffer.byteLength(content), truncated, redacted: clean.redacted };
    return { content: JSON.stringify({ ...details, content: clean.content.slice(0, OUTPUT_LIMIT) }), evidence: [{ kind: 'file_read', summary: `Read host file ${path}${truncated ? ' (output truncated)' : ''}`, passed: true, details }] };
  }

  private async prepareCheckpoints(bytes: number, check: Guard): Promise<void> {
    check(); await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await inspectPath(this.dataDir); check();
    await inspectPath(this.dataDir, 'host-checkpoints'); check();
    if (!this.checkpointReady) { await privateDirectory(this.checkpointRoot); check(); this.checkpointReady = true; }
    await inspectPath(this.checkpointRoot); check();
    let used = 0; let count = 0;
    const directory = await opendir(this.checkpointRoot);
    for await (const entry of directory) {
      check(); const target = await inspectPath(this.checkpointRoot, entry.name);
      const info = await lstat(target); check();
      if (!info.isFile() || info.nlink !== 1) throw new Error('Host checkpoint storage contains an unsafe object');
      used += info.size;
      if (++count >= CHECKPOINT_COUNT || used + bytes > CHECKPOINT_BYTES) throw new Error('Host checkpoint quota reached; retain recovery records and perform owner maintenance before continuing');
    }
    await new StorageBudget(this.dataDir).assertCapacity(used + 2 * bytes + 2 * 1024 * 1024); check();
  }

  private async saveCheckpoint(record: RecoveryRecord, check: Guard): Promise<void> {
    check(); const target = await inspectPath(this.checkpointRoot, `${record.id}.json`); check();
    await writePrivate(target, JSON.stringify(record)); check();
  }

  private async mutate(tool: 'host_write' | 'host_delete', path: string, args: ParsedRequest, check: Guard, taskId?: string,authorize?:()=>Promise<void>,onCreated?:CreationObserver): Promise<ToolResult> {
    check(); const before = await readText(dirname(path), basename(path), tool === 'host_write');
    await this.inspect(path, tool === 'host_write', check); check();
    if (before !== null && redactedText(before).redacted) throw new Error('Protected credential content cannot be overwritten or deleted by a host file tool');
    if (hashOrNull(before) !== args.expectedHash) throw new Error('Content conflict: host file differs from expectedHash');
    const after = tool === 'host_write' ? args.content! : null;
    const checkpoint: RecoveryRecord = { id: randomUUID(), taskId: taskId ?? null, tool, path, createdAt: new Date().toISOString(), state: 'prepared', before, beforeHash: hashOrNull(before), afterHash: hashOrNull(after) };
    await this.prepareCheckpoints(Buffer.byteLength(JSON.stringify(checkpoint)) + Buffer.byteLength(after ?? ''), check);
    await this.saveCheckpoint(checkpoint, check);
    check(); await this.inspect(path, tool === 'host_write', check);
    try {
      await authorize?.();check();
      if (after === null) await replaceText(dirname(path), basename(path), null, args.expectedHash!, check,authorize);
      else await this.writePreservingMetadata(path, after, args.expectedHash!, check,authorize,onCreated);
      await this.inspect(path, tool === 'host_delete', check); check();
      if (hashOrNull(await readText(dirname(path), basename(path), tool === 'host_delete')) !== hashOrNull(after)) throw new Error('Host file verification failed');
      check(); checkpoint.state = 'committed'; await this.saveCheckpoint(checkpoint, check);
    } catch (cause) {
      const error = new UncertainToolEffect(cause, 'external');
      error.message = 'A host file mutation may have completed. Inspect the host file and its private checkpoint before continuing; automatic replay is blocked.';
      throw error;
    }
    const details = { path, sha256: hashOrNull(after), checkpointId: checkpoint.id };
    return { content: JSON.stringify(details), evidence: [{ kind: 'file_content', summary: tool === 'host_delete' ? `Verified deletion of host file ${path}` : `Verified written host file ${path}`, passed: true, details }] };
  }

  /** Existing files are updated through their verified open handle so their ACL,
   * ownership and POSIX mode survive. This is intentionally not an atomic rename:
   * interrupted writes retain the prepared checkpoint and become uncertain effects.
   */
  private async writePreservingMetadata(path: string, content: string, expectedHash: string | null, check: Guard,authorize?:()=>Promise<void>,onCreated?:CreationObserver): Promise<void> {
    await this.inspect(path, expectedHash === null, check); check();
    const original = expectedHash === null ? null : await lstat(path); check();
    if (original && (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1)) throw new Error('Host links and non-regular files are forbidden');
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
    const flags = expectedHash === null ? constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow : constants.O_RDWR | noFollow;
    // O_EXCL is itself a mutation, including for empty content. Recheck durable
    // authority after path traversal, before creating the directory entry.
    if(expectedHash===null){await authorize?.();check();}
    const handle = await open(path, flags, 0o600);
    try {
      check(); const opened = await handle.stat(); check();
      if (!opened.isFile() || opened.nlink !== 1 || original && (opened.dev !== original.dev || opened.ino !== original.ino)) throw new Error('Host file changed while opening');
      if(expectedHash===null&&onCreated){const created=await handle.stat({bigint:true});await onCreated({dev:String(created.dev),ino:String(created.ino)});check();}
      if (expectedHash !== null) {
        if (opened.size > FILE_LIMIT) throw new Error('Host file exceeds the 1 MiB size limit');
        const buffer = Buffer.alloc(FILE_LIMIT + 1); let length = 0;
        while (length < buffer.length) {
          check(); const part = await handle.read(buffer, length, buffer.length - length, length); check();
          if (!part.bytesRead) break;
          length += part.bytesRead;
        }
        if (length > FILE_LIMIT) throw new Error('Host file exceeds the 1 MiB size limit');
        const current = new TextDecoder('utf-8', { fatal: true,ignoreBOM:true }).decode(buffer.subarray(0, length));
        boundedText(current);
        if (sha256(current) !== expectedHash) throw new Error('Content conflict: host file changed before write');
        if (redactedText(current).redacted) throw new Error('Protected credential content cannot be overwritten');
      }
      await this.inspect(path, false, check);
      const currentInfo = await lstat(path); check();
      if (currentInfo.dev !== opened.dev || currentInfo.ino !== opened.ino || currentInfo.nlink !== 1) throw new Error('Host file changed before commit');
      const bytes = Buffer.from(content, 'utf8'); let offset = 0;
      while (offset < bytes.length) {
        await authorize?.();check(); const written = await handle.write(bytes, offset, Math.min(bytes.length-offset,64*1024), offset); check();
        if (!written.bytesWritten) throw new Error('Host file write made no progress');
        offset += written.bytesWritten;
      }
      await authorize?.();check(); await handle.truncate(bytes.length); check(); await handle.sync(); check();
    } finally { await handle.close(); }
  }
}
