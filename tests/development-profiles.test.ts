import { describe, expect, it, vi } from 'vitest';
import { Script } from 'node:vm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { developmentProfile, developmentProfileSchema, SANDBOX_PROFILE_PROBE } from '../server/tools/development-profiles';
import { sandboxInput, SandboxOutput } from '../server/tools/sandbox-protocol';
import { DockerSandbox, sandboxArguments } from '../server/tools/sandbox';
import { SANDBOX_PROFILE_EXECUTION } from '../server/tools/sandbox-worker';
import { ToolBroker } from '../server/tools/index';
import { decide, parseRequest } from '../server/tools/policy';
import type { ToolContext } from '../shared/types';

const pinned = `sha256:${'a'.repeat(64)}`;
const record = (profile = 'python') => ({ type: 'result', stdout: 'test result', stderr: '', exitCode: 0, truncated: false, durationMs: 12, toolchain: { profile, version: '3.12.7' } });
const output = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n${JSON.stringify({ type: 'complete', files: 0, bytes: 0 })}\n`);

describe('owner-configured isolated development profiles', () => {
  it('retains the legacy image only for default and requires explicit digest pins for language profiles', () => {
    expect(developmentProfile(undefined, { RELAY_SANDBOX_IMAGE: 'trusted-legacy:local' })).toMatchObject({ id: 'default', image: 'trusted-legacy:local' });
    for (const id of ['node', 'python', 'dotnet'] as const) {
      expect(developmentProfile(id, { [`RELAY_SANDBOX_${id.toUpperCase()}_IMAGE`]: pinned })).toMatchObject({ id, image: pinned });
      expect(() => developmentProfile(id, { [`RELAY_SANDBOX_${id.toUpperCase()}_IMAGE`]: 'unreviewed:latest' })).toThrow(/digest/i);
      expect(() => developmentProfile(id, { RELAY_SANDBOX_IMAGE: pinned })).toThrow(/configure/i);
    }
    expect(() => developmentProfileSchema.parse('host-shell')).toThrow();
    expect(() => developmentProfile('python', { RELAY_SANDBOX_PYTHON_IMAGE: pinned + '\n--privileged' })).toThrow();
  });

  it('carries exact profile choices through tool validation, approval policy and trusted seeding', () => {
    const request = { id: 'call', name: 'terminal', arguments: { argv: ['python3', '-m', 'unittest'], profile: 'python', timeoutSeconds: 10 } };
    expect(parseRequest(request).args.profile).toBe('python');
    const context: ToolContext = { taskId: 'task', agentId: 'agent', workspaceId: '00000000-0000-4000-8000-000000000000', access: 'supervised', allowedTools: ['terminal'], signal: new AbortController().signal, approved: false };
    expect(decide(context, request, false).decision).toBe('approval');
    expect(decide({ ...context, access: 'read_only' }, request, false).decision).toBe('deny');
    const seed = JSON.parse([...sandboxInput(new Map(), request.arguments.argv, 10000, 'python')][0].toString());
    expect(seed.profile).toBe('python');
    expect(seed.argv).toEqual(request.arguments.argv);
    expect(() => parseRequest({ ...request, arguments: { ...request.arguments, image: 'attacker/image' } })).toThrow();
    expect(() => parseRequest({ ...request, arguments: { ...request.arguments, profile: 'shell' } })).toThrow();
  });

  it('requires matching toolchain provenance without changing container isolation or network policy', () => {
    const parser = new SandboxOutput('python'); parser.push(output(record()));
    expect(parser.finish().toolchain).toEqual({ profile: 'python', version: '3.12.7' });
    expect(() => new SandboxOutput('node').push(output(record()))).toThrow(/profile/i);
    const absent = { ...record(), toolchain: undefined };
    expect(() => new SandboxOutput('python').push(output(absent))).toThrow(/preflight/i);
    expect(() => new SandboxOutput('python').push(output({ ...record(), toolchain: { profile: 'python', version: 'invented' } }))).toThrow();
    const args = sandboxArguments('/safe/supervisor.cjs', 'relay-00000000-0000-4000-8000-000000000000', pinned, ['python3', '-m', 'unittest']);
    expect(args[args.indexOf('--network') + 1]).toBe('none');
    expect(args).toContain('--pull=never'); expect(args).toContain('--read-only');
    expect(args.filter((_, index) => args[index - 1] === '--mount')).toEqual(['type=bind,source=/safe/supervisor.cjs,target=/relay-supervisor.cjs,readonly']);
    expect(args).not.toContain('--privileged'); expect(args.join(' ')).not.toMatch(/docker\.sock|network=host/);
  });

  it('executes the actual fixed probe against bounded process fixtures, never workspace code or a shell', () => {
    const run = (profile: string, stdout: string, status = 0) => {
      let emitted = ''; const invocations: unknown[][] = [];
      new Script(SANDBOX_PROFILE_PROBE).runInNewContext({
        require: (module: string) => { expect(module).toBe('node:child_process'); return { spawnSync: (...args: unknown[]) => { invocations.push(args); return { stdout, stderr: '', status }; } }; },
        process: { argv: ['node', profile], env: { PATH: '/trusted', HOME: '/tmp' }, stdout: { write: (value: string) => { emitted += value; } } },
      });
      return { emitted: JSON.parse(emitted), invocations };
    };
    const python = run('python', 'Python 3.12.7\n');
    expect(python.emitted).toEqual({ profile: 'python', version: '3.12.7' });
    expect(python.invocations[0]).toEqual(['/usr/local/bin/python3', ['-I', '--version'], expect.objectContaining({ cwd: '/tmp', shell: false, timeout: 5000, maxBuffer: 1024 })]);
    expect(run('node', 'v24.12.0\n').emitted.version).toBe('24.12.0');
    expect(run('dotnet', '10.0.100\n').emitted.version).toBe('10.0.100');
    expect(() => run('python', 'Python 2.7.18\n')).toThrow(/toolchain/i);
    expect(() => run('node', 'v22.0.0\n')).toThrow(/toolchain/i);
    expect(() => run('dotnet', '8.0.100\n', 127)).toThrow(/toolchain/i);
    expect(() => run('unknown', 'anything')).toThrow(/profile/i);
  });

  it('runs the trusted probe before user argv and cannot accept toolchain claims printed by user commands', async () => {
    const invocations: Array<{ argv: string[]; timeoutMs: number }> = [];
    const invoke = (probeExit: number) => new Script(`${SANDBOX_PROFILE_EXECUTION}\nprofiledExecute(config)`).runInNewContext({
      config: { profile: 'python', argv: ['python3', 'tests.py'], timeoutMs: 10000 }, profileProbe: SANDBOX_PROFILE_PROBE,
      check: (valid: unknown, message: string) => { if (!valid) throw new Error(message); },
      execute: async (config: { argv: string[]; timeoutMs: number }) => {
        invocations.push(config);
        return config.argv[1] === '-e'
          ? { exitCode: probeExit, stdout: JSON.stringify({ profile: 'python', version: '3.12.7' }), truncated: false }
          : { exitCode: 0, stdout: '{"profile":"dotnet","version":"100.0.0"}', truncated: false };
      },
    }) as Promise<{ toolchain: { profile: string; version: string } }>;
    expect((await invoke(0)).toolchain).toEqual({ profile: 'python', version: '3.12.7' });
    expect(invocations[0].argv).toEqual(['/usr/local/bin/node', '-e', SANDBOX_PROFILE_PROBE, 'python']);
    expect(invocations[1].argv).toEqual(['python3', 'tests.py']);
    invocations.length = 0;
    await expect(invoke(127)).rejects.toThrow(/preflight/i);
    expect(invocations).toHaveLength(1);
  });

  it('dispatches the chosen environment through the real broker and records its exact image/runtime evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'relay-profile-'));
    const status = vi.spyOn(DockerSandbox.prototype, 'status').mockResolvedValue({ available: true, reason: 'Explicit deterministic Docker fixture' });
    const run = vi.spyOn(DockerSandbox.prototype, 'run').mockResolvedValue({ files: new Map(), stdout: 'Synthetic successful test receipt', stderr: '', exitCode: 0, truncated: false, durationMs: 5, imageId: pinned, toolchain: { profile: 'python', version: '3.12.7' } });
    const broker = new ToolBroker(directory, () => false);
    try {
      const workspace = await broker.createWorkspace('Development profile fixture');
      const context: ToolContext = { taskId: 'task', agentId: 'agent', workspaceId: workspace.id, access: 'supervised', approved: true, allowedTools: ['terminal'], signal: new AbortController().signal };
      const request = { id: 'call', name: 'terminal', arguments: { argv: ['python3', '-m', 'unittest'], profile: 'python' } };
      const result = await broker.execute(context, request);
      expect(status).toHaveBeenCalledWith('python');
      expect(run.mock.calls[0][5]).toBe('python');
      expect(result.evidence[0].details).toMatchObject({ imageId: pinned, toolchain: { profile: 'python', version: '3.12.7' }, argv: request.arguments.argv });
      await expect(broker.execute({ ...context, approved: false }, request)).rejects.toThrow(/approv/i);
      expect(run).toHaveBeenCalledTimes(1);
    } finally { vi.restoreAllMocks(); await broker.stopAll(); await rm(directory, { recursive: true, force: true }); }
  });
});
