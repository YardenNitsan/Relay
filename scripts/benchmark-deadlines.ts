/** Disposable embedded-PostgreSQL measurement; never opens user data. */
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { Store } from '../server/db/store.js';
import { openDatabase } from '../server/db/database.js';

const store = new Store(await openDatabase());
try {
  await store.init();
  const conversation = await store.createConversation('Synthetic deadline reconciliation benchmark');
  const retained = 50_000, pending = 100;
  await store.db.query(`INSERT INTO tasks(id,conversation_id,objective,status,options,created_at)
    SELECT 'deadline-benchmark-'||n,$1,'Synthetic retained task',
      CASE WHEN n<=$2 THEN 'completed' ELSE 'paused' END,
      '{"budget":{"maxElapsedSeconds":30}}'::jsonb,
      now()-interval '1 day' FROM generate_series(1,$2::integer+$3::integer) n`,
  [conversation.id, retained, pending]);
  await store.db.exec('ANALYZE tasks');
  const measure = async () => {
    const samples:number[]=[];
    for(let index=0;index<35;index++) {
      const start=performance.now();const result=await store.overdueTasks();
      if(result.length!==pending)throw new Error(`Expected ${pending} overdue tasks, got ${result.length}`);
      if(index>=5)samples.push(performance.now()-start);
    }
    samples.sort((a,b)=>a-b);
    return {samples: samples.length, medianMs:samples[Math.floor(samples.length/2)],p95Ms:samples[Math.ceil(samples.length*.95)-1]};
  };
  const query = `EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM tasks
    WHERE status NOT IN ('completed','failed','cancelled')
    AND options->'budget'->>'maxElapsedSeconds' IS NOT NULL
    AND id<>ALL('{}'::text[])
    AND created_at+(options->'budget'->>'maxElapsedSeconds')::double precision*interval '1 second'<=$1::timestamptz
    ORDER BY created_at,id LIMIT 128`;
  const indexed=await measure();
  const plan=await store.db.query(query,[new Date().toISOString()]);
  // Only the disposable in-memory database loses its index for this comparison.
  await store.db.exec('DROP INDEX tasks_pending_deadlines');
  const unindexed=await measure();
  console.log(JSON.stringify({protocol:'relay-deadline-reconciliation-v1',platform:process.platform,node:process.version,cpu:os.cpus()[0]?.model,retained,pending,indexed,unindexed,plan},null,2));
} finally { await store.close(); }
