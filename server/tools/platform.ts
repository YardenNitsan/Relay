import { constants } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export const FILE_LIMIT = 1024 * 1024;
export const WORKSPACE_LIMIT = 50 * 1024 * 1024;
export const FILE_COUNT_LIMIT = 2_000;
export const OUTPUT_LIMIT = 32_768;

const blockedDirectories = new Set(['.git', '.hg', '.svn', '.ssh', '.aws', '.azure', '.gcloud', '.gnupg', '.kube', '.docker', '.codex', '.agents', '.config', 'node_modules', 'vendor', '.venv', 'venv', '__pycache__', 'dist', 'build', 'target', '.next', '.cache']);
const blockedFiles = /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.gitconfig|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i;
export const sandboxFileFilter={directories:[...blockedDirectories],files:blockedFiles.source};
const deviceName = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;

export function protectedName(name: string): boolean {
  return blockedDirectories.has(name.toLowerCase()) || blockedFiles.test(name) || /\.(?:pem|key|p12|pfx)$/i.test(name) || name.startsWith('.relay-');
}

export function safePath(value: string, allowRoot = false): string {
  if (allowRoot && (value === '' || value === '.')) return '';
  if (!value || value.length > 2048 || /[\\:\x00-\x1f\x7f]/.test(value) || /\p{Cf}/u.test(value) || value.startsWith('/')) throw new Error('Unsafe workspace path');
  const parts = value.split('/');
  if (parts.length > 24 || parts.some(part => !part || part === '.' || part === '..' || part.length > 200 || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || deviceName.test(part))) throw new Error('Unsafe workspace path');
  if (parts.some(protectedName)) throw new Error('Protected secret or generated path is not accessible');
  return parts.join('/');
}

const comparable = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export function inside(root: string, path: string): boolean {
  const rel = relative(comparable(root), comparable(path));
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

export async function inspectPath(root: string, rel = ''): Promise<string> {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || comparable(await realpath(root)) !== comparable(root)) throw new Error('Workspace root contains a link or reparse point');
  let current = root;
  for (const part of rel.split('/').filter(Boolean)) {
    current = resolve(current, part);
    if (!inside(root, current)) throw new Error('Path escaped workspace');
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))) throw new Error('Links, reparse points and non-regular files are forbidden');
      if (!inside(root, await realpath(current))) throw new Error('Resolved path escaped workspace');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      break;
    }
  }
  return resolve(root, rel);
}

export async function sourceRoot(source: string, dataDir: string): Promise<string> {
  if (!isAbsolute(source) || source.startsWith('\\\\') || source.startsWith('//')) throw new Error('Source must be an absolute local directory');
  const resolved = resolve(source);
  if (resolved === dirname(resolved) || inside(resolved, dataDir) || inside(dataDir, resolved)) throw new Error('Source is too broad or overlaps Relay data');
  await inspectPath(resolved);
  return resolved;
}

export function readFlags(): number { return constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW); }
export function dockerBinary(): string { return process.platform === 'win32' ? 'docker.exe' : 'docker'; }
export function commandEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  // Docker needs its selected context and OS paths, never the backend's provider-key environment.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']) {
    if (process.env[key]) result[key] = process.env[key];
  }
  return result;
}
export function containerUser(): string {
  // Linux bind mounts preserve host ownership; Desktop shares files through its VM.
  if (process.platform === 'linux' && process.getuid && process.getgid && process.getuid() !== 0) return `${process.getuid()}:${process.getgid()}`;
  return '1000:1000';
}
