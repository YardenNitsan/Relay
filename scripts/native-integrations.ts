// Opt-in integration checks against real PostgreSQL and the real Docker broker.
// Run with: node --import tsx scripts/native-integrations.ts postgres|sandbox
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { ToolBroker } from '../server/tools/index.js';
import { ToolStore } from '../server/tools/store.js';
import {verifyNativeUpgrade} from './native-upgrade-acceptance.js';
import type { TaskOptions, ToolContext, ToolRequest } from '../shared/types.js';

const run = promisify(execFile);
const mode = process.argv[2];
assert.ok(mode === 'postgres' || mode === 'sandbox', 'Choose postgres or sandbox');
await mkdir('output', { recursive: true });
const report: Record<string, unknown> = { testedAt: new Date().toISOString(), platform: process.platform, node: process.version, mode, checks: [] };
const checks = report.checks as string[];
const options: TaskOptions = { depth: 'fast', modelId: null, access: 'read_only', workspaceId: null, contextTokens: 4096, cloudPolicy: 'local_only', budget: { maxCalls: 4, maxSeconds: 60, maxIterations: 3, maxCostUsd: null, localOnly: true } };

if (mode === 'postgres') {
  const connection = process.env.RELAY_TEST_DATABASE_URL;
  assert.ok(connection, 'Set RELAY_TEST_DATABASE_URL to a new disposable native PostgreSQL database');
  const target = new URL(connection);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Integration database must be on loopback');
  assert.match(target.pathname, /^\/relay_integration_[a-z0-9_]+$/, 'Refusing a database outside the relay_integration_* namespace');
  const store = new Store(await openDatabase(undefined, connection));
  const second = new Store(await openDatabase(undefined, connection));
  try {
    assert.equal((await store.db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).length, 0, 'Integration requires an empty disposable database');
    report.serverVersion = String((await store.db.query('SHOW server_version'))[0]?.server_version);
    checks.push(...await verifyNativeUpgrade(store,second,options));
    await store.init();
    await store.init();
    checks.push('Current schema and additive migrations initialize idempotently on native PostgreSQL');
    const conversation = await store.createConversation('Native PostgreSQL concurrency');
    const attempts = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? store : second).createTask(conversation.id, `Competing objective ${index}`, options)));
    const accepted = attempts.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<Store['createTask']>>> => result.status === 'fulfilled');
    assert.equal(accepted.length, 1);
    assert.equal((await store.conversation(conversation.id)).messages.length, 1);
    checks.push('Two independent PostgreSQL pools admit exactly one of twelve simultaneous conversation tasks');
    const task = accepted[0]!.value.task;
    const rollbackId = randomUUID();
    await assert.rejects(store.db.transaction(async transaction => {
      await transaction.query('INSERT INTO conversations(id,title,user_id) VALUES ($1,$2,$3)', [rollbackId, 'Must roll back', 'owner']);
      throw new Error('Intentional transaction rollback');
    }), /Intentional/);
    assert.equal((await store.db.query('SELECT id FROM conversations WHERE id=$1', [rollbackId])).length, 0);
    checks.push('Failed transactions roll back their relational writes');
    await store.transition(task.id, 'analyzing');
    await store.transition(task.id, 'planning');
    await store.transition(task.id, 'executing');
    await second.recover();
    assert.equal((await store.task(task.id)).status, 'paused');
    const resumes = await Promise.allSettled([store.resumeTask(task.id), second.resumeTask(task.id)]);
    assert.equal(resumes.filter(result => result.status === 'fulfilled').length, 1);
    checks.push('Recovery pauses interrupted work and concurrent resume reserves a single execution slot');
    await store.setStopped(true);
    const next = await store.createConversation('Stopped scheduling');
    await assert.rejects(second.createTask(next.id, 'Must not start', options), /stop/i);
    assert.equal((await second.control()).stopped, true);
    checks.push('Emergency stop is authoritative across independent PostgreSQL connections');
    const events = await second.events(0);
    assert.equal(new Set(events.map(event => event.id)).size, events.length);
    assert.ok(events.every((event, index) => index === 0 || event.id > events[index - 1]!.id));
    const columns = await store.db.query("SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name IN ('execution_used_ms','execution_reserved_ms')");
    assert.equal(columns.length, 2);
    checks.push('Durable budget columns and monotonic replayable events exist in the native schema');
  } finally { await second.close(); await store.close(); }
} else {
  assert.match(process.env.RELAY_SANDBOX_IMAGE ?? '', /^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/, 'Choose an explicit installed immutable image ID/digest; this check never pulls an image');
  const directory = await mkdtemp(join(resolve('output'), 'native-sandbox-'));
  let stopped = false;
  const broker = new ToolBroker(directory, () => stopped);
  const ledger = new ToolStore(directory);
  const workspace = await broker.createWorkspace('Native isolation integration');
  const context: ToolContext = { taskId: randomUUID(), agentId: 'native-integration', workspaceId: workspace.id, access: 'workspace', allowedTools: ['terminal', 'file_read'], signal: new AbortController().signal, approved: false };
  let sequence = 0;
  const command = (argv: string[], timeoutSeconds = 10): ToolRequest => ({ id: `native-${++sequence}`, name: 'terminal', arguments: { argv, timeoutSeconds } });
  const docker = async (args: string[]) => run(process.platform === 'win32' ? 'docker.exe' : 'docker', args, { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 });
  async function waitForManagedContainer(): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const names = await ledger.containers();
      for (const name of names) {
        const inspected = await docker(['inspect', '--format', '{{.State.Running}}', name]).catch(() => null);
        if (inspected?.stdout.trim() === 'true') return name;
      }
      await delay(100);
    }
    throw new Error('Managed container did not enter running state');
  }
  async function absent(name: string) {
    await delay(250);
    await assert.rejects(docker(['inspect', name]));
    assert.equal((await ledger.containers()).length, 0);
  }
  let executionFailure:unknown;
  try {
    const status = await broker.sandboxStatus();
    assert.ok(status.available, status.reason);
    report.image = process.env.RELAY_SANDBOX_IMAGE;
    process.env.OPENAI_API_KEY = 'relay-test-environment-must-not-cross';
    const inspect = `const fs=require('node:fs'),os=require('node:os');let rootDenied=false;try{fs.writeFileSync('/escape-test','bad')}catch(e){rootDenied=['EROFS','EACCES','EPERM'].includes(e.code)}const result={uid:process.getuid(),status:fs.readFileSync('/proc/self/status','utf8'),memory:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),pids:fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),cpu:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),interfaces:Object.keys(os.networkInterfaces()),rootDenied,secretPresent:!!process.env.OPENAI_API_KEY};fs.writeFileSync('verified.json',JSON.stringify(result));console.log(JSON.stringify(result));`;
    const receipt = JSON.parse((await broker.execute(context, command(['node', '-e', inspect]))).content) as { exitCode: number; filesChanged: number };
    assert.equal(receipt.exitCode, 0); assert.equal(receipt.filesChanged, 1);
    const file = JSON.parse((await broker.execute(context, { id: 'read-proof', name: 'file_read', arguments: { path: 'verified.json' } })).content) as { content: string };
    const result = JSON.parse(file.content) as Record<string, unknown>;
    assert.notEqual(result.uid, 0); assert.equal(result.rootDenied, true); assert.equal(result.secretPresent, false);
    assert.match(String(result.status), /NoNewPrivs:\s+1/); assert.match(String(result.status), /Seccomp:\s+2/); assert.match(String(result.status), /CapEff:\s+0+/);
    assert.equal(result.memory, String(512 * 1024 * 1024)); assert.equal(result.pids, '64');
    const [quota, period] = String(result.cpu).split(' ').map(Number); assert.equal(quota, period);
    assert.deepEqual(result.interfaces, ['lo']);
    checks.push('Real broker runs non-root with read-only root, no capabilities, seccomp, no-new-privileges and no provider environment');
    checks.push('Real cgroups enforce 512 MiB memory, 64 PIDs and one CPU; only loopback networking exists');
    checks.push('Successful isolated file changes commit with actual file read-back evidence');
    const cancelled = new AbortController();
    const running = broker.execute({ ...context, signal: cancelled.signal }, command(['node', '-e', 'setInterval(()=>{},1000)'], 30));
    const outcome = running.then(() => null, error => error as Error);
    const name = await waitForManagedContainer(); const started = Date.now(); cancelled.abort();
    assert.match(String(await outcome), /cancel/i); await absent(name);
    report.cancellationMs = Date.now() - started;
    checks.push('Cancellation terminates the running container and removes its durable cleanup marker');
    const emergency = broker.execute(context, command(['node', '-e', 'setInterval(()=>{},1000)'], 30));
    const emergencyOutcome = emergency.then(() => null, error => error as Error);
    const emergencyName = await waitForManagedContainer(); stopped = true; await broker.stopAll();
    const emergencyResult=await emergencyOutcome;
    if(emergencyResult&&!/cancel|stop/i.test(String(emergencyResult)))throw emergencyResult;
    assert.match(String(emergencyResult), /cancel|stop/i); await absent(emergencyName);
    await assert.rejects(broker.execute(context, command(['node', '-v'])), /stop/i);
    checks.push('Emergency stop kills managed execution and rejects new tool calls');
  } catch(error) { executionFailure=error;throw error; }
  finally {
    delete process.env.OPENAI_API_KEY; stopped = true;
    try {await broker.stopAll();}catch(cleanup){throw new AggregateError(executionFailure?[executionFailure,cleanup]:[cleanup],'Native sandbox acceptance or cleanup failed');}
  }
}
report.passed = true;
await writeFile(join('output', `native-${mode}.json`), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
