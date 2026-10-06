// Read-only acceptance of the compiled host and previously persisted real task.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pairLocalSession } from './local-session.mjs';
const base = process.env.RELAY_ACCEPTANCE_URL ?? 'http://127.0.0.1:4317';
const acceptance = JSON.parse(await readFile('output/local-acceptance.json', 'utf8'));
if (acceptance.passed !== true) throw new Error('Restart verification requires a successful real-runtime acceptance report');
const {cookie}=await pairLocalSession(base);
const headers = { cookie };
async function get(path) {
  const response = await fetch(`${base}/api${path}`, { headers });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
const [conversation, detail, discovery, status] = await Promise.all([
  get(`/conversations/${acceptance.conversationId}`), get(`/tasks/${acceptance.taskId}`), get('/models'), get('/status'),
]);
if (!conversation.messages.some(message => message.role === 'assistant') || detail.task.status !== 'completed' || detail.changes.find(change => change.path === 'greeting.txt')?.after !== 'Hello from Relay\n') throw new Error('Persisted acceptance records did not survive restart');
const measured = discovery.models.find(model => model.id === acceptance.model);
if (measured?.tokensPerSecond && measured.details.performance?.source !== 'persisted') throw new Error('A restored measurement must identify its persisted provenance');
const controller = new AbortController();
const started = Date.now();
const stream = await fetch(`${base}/api/events?after=${conversation.cursor}`, { headers, signal: controller.signal });
if (!stream.ok) throw new Error('Activity stream was rejected');
const reader = stream.body.getReader();
let bytes = 0;
let heartbeatObserved = false;
let tail = '';
const decoder = new TextDecoder();
const timer = setTimeout(() => controller.abort(), 17000);
try {
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('Activity stream ended before its idle heartbeat');
    bytes += chunk.value.byteLength;
    tail = (tail + decoder.decode(chunk.value, { stream: true })).slice(-4096);
    heartbeatObserved ||= tail.includes(': heartbeat\n\n');
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
if (!heartbeatObserved) throw new Error('No actual idle heartbeat was observed');
const report = { testedAt: new Date().toISOString(), passed: true, database: status.database, taskId: detail.task.id, persistedMessages: conversation.messages.length, measurementPersistence: measured?.tokensPerSecond ? 'observed' : 'not_observed', measuredTokensPerSecond: measured?.tokensPerSecond ?? null, measuredAt: measured?.details.performance?.measuredAt ?? null, idleStreamMs: Date.now() - started, streamBytes: bytes, heartbeatObserved };
await mkdir('output', { recursive: true });
await writeFile('output/production-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
