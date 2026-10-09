import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { commandEnvironment, dockerBinary, inspectPath, readFlags, OUTPUT_LIMIT } from './platform';
import { snapshot,type Guard } from './files';
import type { ToolStore } from './store';
import { SandboxOutput,sandboxInput,type SandboxCommand } from './sandbox-protocol';
import { SANDBOX_SUPERVISOR } from './sandbox-worker';

interface CommandResult { stdout: string; stderr: string; exitCode: number; truncated: boolean; durationMs: number; }
interface SandboxConfiguration { imageId: string; }

async function docker(args: string[], timeoutMs: number, signal?: AbortSignal,exchange?:{input:Iterable<Buffer>;output:SandboxOutput}): Promise<CommandResult> {
  if (signal?.aborted) throw new Error('Command cancelled');
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(dockerBinary(), args, { shell: false, windowsHide: true, env: commandEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let truncated = false; let failure: Error | undefined;
    const append = (target: 'stdout' | 'stderr', buffer: Buffer) => {
      const text = buffer.toString('utf8'); const previous = target === 'stdout' ? stdout : stderr;
      if (previous.length + text.length > OUTPUT_LIMIT) truncated = true;
      if (target === 'stdout') stdout = (previous + text).slice(0, OUTPUT_LIMIT); else stderr = (previous + text).slice(0, OUTPUT_LIMIT);
    };
    child.stdout.on('data', buffer => {if(failure)return;try{if(exchange)exchange.output.push(buffer);else append('stdout',buffer);}catch(error){failure=error instanceof Error?error:new Error('Invalid isolated output');child.kill();}}); child.stderr.on('data', buffer => append('stderr', buffer));
    child.stdin.on('error',()=>{failure??=new Error('Docker input stream failed');});
    const abort = () => { failure = new Error('Command cancelled'); child.kill(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => { failure = new Error('Command timed out'); child.kill(); }, timeoutMs);
    child.on('error', () => { failure = new Error('Docker executable unavailable'); });
    child.on('close', code => {
      clearTimeout(timeout); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure); else resolve({ stdout, stderr, exitCode: code ?? -1, truncated, durationMs: Date.now() - start });
    });
    if (signal?.aborted) abort();
    const input=exchange?.input[Symbol.iterator]();
    const pump=()=>{if(failure||child.stdin.destroyed)return;try{if(input)while(true){signal?.throwIfAborted();const item=input.next();if(item.done)break;if(!child.stdin.write(item.value)){child.stdin.once('drain',pump);return;}}child.stdin.end();}catch(error){failure=error instanceof Error?error:new Error('Invalid isolated input');child.kill();}};
    pump();
  });
}

export function sandboxArguments(helperPath: string, name: string, imageId: string, argv: string[]): string[] {
  if (!helperPath || /[,\r\n\0]/.test(helperPath) || !/^relay-[0-9a-f-]{36}$/.test(name) || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid sandbox configuration');
  if (!argv.length || !argv[0] || argv[0].startsWith('-') || argv.some(value => value.includes('\0'))) throw new Error('Invalid command arguments');
  return ['run', '--rm', '--interactive', '--pull=never', '--name', name, '--init', '--no-healthcheck', '--log-driver', 'none', '--network', 'none', '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'KILL', '--security-opt', 'no-new-privileges:true', '--read-only', '--pids-limit', '64', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--ulimit', 'fsize=1048576:1048576', '--ulimit', 'nofile=256:256', '--shm-size', '16m', '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m,nr_inodes=10000,mode=1777', '--tmpfs', '/workspace:rw,nosuid,nodev,size=64m,nr_inodes=10000,mode=0777', '--mount', `type=bind,source=${helperPath},target=/relay-supervisor.cjs,readonly`, '--workdir', '/workspace', '--user', '0:0', '--env', 'NODE_OPTIONS=', '--env', 'NODE_PATH=', '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--entrypoint', '/usr/local/bin/node', imageId, '--max-old-space-size=128', '/relay-supervisor.cjs'];
}

export class DockerSandbox {
  private active = new Map<string, AbortController>();
  private cleanupFailures = new Set<string>();
  constructor(private readonly store: ToolStore) {}
  async status(): Promise<{ available: boolean; reason: string }> {
    try { await this.configuration(); return { available: true, reason: 'Local Linux Docker engine and configured trusted image available. Commands must pass Node 24, privilege-drop and bounded tmpfs preflight; no writable host mounts.' }; }
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
    if (info.OSType !== 'linux' || info.MemoryLimit !== true || info.SwapLimit !== true || info.PidsLimit !== true || info.CpuCfsQuota !== true || !Array.isArray(info.SecurityOptions) || !info.SecurityOptions.some(value => typeof value === 'string' && value.includes('seccomp'))) throw new Error('Docker requires a Linux engine with memory, swap, PID, CPU and seccomp controls');
    const imageResult = await docker(['image', 'inspect', '--format', '{{.Id}}', image], 5000);
    const imageId = imageResult.stdout.trim();
    if (imageResult.exitCode !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('Trusted sandbox image is not installed locally; automatic image download is disabled');
    return { imageId };
  }
  private async supervisor():Promise<string> {
    await this.store.init();const hash=createHash('sha256').update(SANDBOX_SUPERVISOR).digest('hex');const path=await inspectPath(this.store.root,`containers/.relay-supervisor-${hash}.cjs`);
    try{const handle=await open(path,'wx',0o444);try{await handle.writeFile(SANDBOX_SUPERVISOR);await handle.sync();}finally{await handle.close();}}
    catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const handle=await open(await inspectPath(this.store.root,`containers/.relay-supervisor-${hash}.cjs`),readFlags());
    try{const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size!==Buffer.byteLength(SANDBOX_SUPERVISOR)||createHash('sha256').update(await handle.readFile()).digest('hex')!==hash)throw new Error('Trusted supervisor integrity check failed');}finally{await handle.close();}return path;
  }
  async run(stagePath: string, argv: string[], timeoutSeconds: number, signal: AbortSignal, guard: Guard): Promise<SandboxCommand&{files:Map<string,string>}> {
    const config = await this.configuration(); guard();
    const name = `relay-${randomUUID()}`; const controller = new AbortController();
    const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); this.active.set(name, controller);
    try {
      const helper=await this.supervisor();const files=await snapshot(stagePath,true);guard();
      const output=new SandboxOutput();await this.store.recordContainer(name);guard();
      const result=await docker(sandboxArguments(helper,name,config.imageId,argv),timeoutSeconds*1000+15_000,controller.signal,{input:sandboxInput(files,argv,timeoutSeconds*1000),output});
      if(result.exitCode!==0)throw new Error('Isolated supervisor failed; trusted Node 24 and enforced process/storage limits are required');guard();return output.finish();
    }
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
