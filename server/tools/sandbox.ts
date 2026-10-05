import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { commandEnvironment, containerUser, dockerBinary, OUTPUT_LIMIT } from './platform';
import type { Guard } from './files';
import type { ToolStore } from './store';

interface CommandResult { stdout: string; stderr: string; exitCode: number; truncated: boolean; durationMs: number; }
interface SandboxConfiguration { imageId: string; }

async function docker(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<CommandResult> {
  if (signal?.aborted) throw new Error('Command cancelled');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary(), args, { shell: false, windowsHide: true, env: commandEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let truncated = false; let failure: Error | undefined;
    const append = (target: 'stdout' | 'stderr', buffer: Buffer) => {
      const text = buffer.toString('utf8'); const previous = target === 'stdout' ? stdout : stderr;
      if (previous.length + text.length > OUTPUT_LIMIT) truncated = true;
      if (target === 'stdout') stdout = (previous + text).slice(0, OUTPUT_LIMIT); else stderr = (previous + text).slice(0, OUTPUT_LIMIT);
    };
    child.stdout.on('data', buffer => append('stdout', buffer)); child.stderr.on('data', buffer => append('stderr', buffer));
    const abort = () => { failure = new Error('Command cancelled'); child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { failure = new Error('Command timed out'); child.kill(); }, timeoutMs);
    child.on('error', () => { failure = new Error('Docker executable unavailable'); });
    child.on('close', code => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve({ stdout, stderr, exitCode: code ?? -1, truncated, durationMs: Date.now() - start });
    });
    if (signal?.aborted) abort();
  });
}

export function sandboxArguments(stagePath: string, name: string, imageId: string, argv: string[]): string[] {
  if (!stagePath || /[,\r\n\0]/.test(stagePath) || !/^relay-[0-9a-f-]{36}$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid sandbox configuration');
  if (!argv.length || !argv[0] || argv[0].startsWith('-') || argv.some(value => value.includes('\0'))) throw new Error('Invalid command arguments');
  return ['run', '--rm', '--pull=never', '--name', name, '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--read-only', '--pids-limit', '64', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--ulimit', 'fsize=1048576:1048576', '--ulimit', 'nofile=256:256', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m', '--mount', `type=bind,source=${stagePath},target=/workspace`, '--workdir', '/workspace', '--user', containerUser(), '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--entrypoint', argv[0], imageId, ...argv.slice(1)];
}

export class DockerSandbox {
  private active = new Map<string, AbortController>();
  private cleanupFailures = new Set<string>();
  constructor(private readonly store: ToolStore) {}
  async status(): Promise<{ available: boolean; reason: string }> {
    try { await this.configuration(); return { available: true, reason: 'Local Linux Docker engine and preinstalled image available; commands use an offline disposable workspace with resource limits.' }; }
    catch (error) { return { available: false, reason: error instanceof Error ? error.message : 'Sandbox unavailable' }; }
  }
  private async configuration(): Promise<SandboxConfiguration> {
    if (this.cleanupFailures.size) throw new Error('Sandbox unavailable: previous container cleanup is unverified; retry emergency stop or inspect Docker');
    if ((await this.store.containers()).some(name => !this.active.has(name))) throw new Error('Sandbox unavailable: interrupted containers require cleanup; use emergency stop before resuming');
    const image = process.env.RELAY_SANDBOX_IMAGE;
    if (!image) throw new Error('Sandbox unavailable: configure RELAY_SANDBOX_IMAGE with a preinstalled trusted Linux image; no image is pulled automatically');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)) throw new Error('Invalid configured sandbox image');
    if (process.env.DOCKER_HOST) throw new Error('DOCKER_HOST overrides are unsupported; select a local Docker context');
    const context = await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], 5000);
    if (context.exitCode !== 0) throw new Error('Docker context unavailable');
    const endpoint: unknown = JSON.parse(context.stdout.trim());
    if (typeof endpoint !== 'string' || !(endpoint.startsWith('unix:///') || endpoint.startsWith('npipe:////./pipe/'))) throw new Error('Only a local Docker socket/named pipe is supported');
    const infoResult = await docker(['info', '--format', '{{json .}}'], 5000);
    if (infoResult.exitCode !== 0 || infoResult.truncated) throw new Error('Local Docker engine unavailable');
    const info = JSON.parse(infoResult.stdout) as Record<string, unknown>;
    if (info.OSType !== 'linux' || info.MemoryLimit !== true || info.PidsLimit !== true || info.CpuCfsQuota !== true || !Array.isArray(info.SecurityOptions) || !info.SecurityOptions.some(value => typeof value === 'string' && value.includes('seccomp'))) throw new Error('Docker requires a Linux engine with memory, PID, CPU and seccomp controls');
    const imageResult = await docker(['image', 'inspect', '--format', '{{.Id}}', image], 5000);
    const imageId = imageResult.stdout.trim();
    if (imageResult.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Trusted sandbox image is not installed locally; automatic image download is disabled');
    return { imageId };
  }
  async run(stagePath: string, argv: string[], timeoutSeconds: number, signal: AbortSignal, guard: Guard): Promise<CommandResult> {
    const config = await this.configuration(); guard();
    const name = `relay-${randomUUID()}`; const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); this.active.set(name, controller);
    try { await this.store.recordContainer(name); guard(); return await docker(sandboxArguments(stagePath, name, config.imageId, argv), timeoutSeconds * 1000, controller.signal); }
    finally { signal.removeEventListener('abort', abort); try { await this.remove(name); } finally { this.active.delete(name); } }
  }
  private async remove(name: string): Promise<void> {
    try {
      const result = await docker(['rm', '--force', name], 10_000);
      if (result.exitCode !== 0 && !/No such container/i.test(result.stderr)) throw new Error('Docker container termination could not be verified');
      await this.store.forgetContainer(name);
      this.cleanupFailures.delete(name);
    } catch { this.cleanupFailures.add(name); throw new Error(`Container cleanup could not be verified: ${name}. Further commands are disabled.`); }
  }
  async stopAll(): Promise<void> {
    const names = new Set([...this.active.keys(), ...this.cleanupFailures, ...await this.store.containers()]);
    for (const controller of this.active.values()) controller.abort();
    const results = await Promise.allSettled([...names].map(name => this.remove(name)));
    if (results.some(result => result.status === 'rejected')) throw new Error('Emergency stop prevented new work but some Docker container cleanup remains unverified');
  }
}
