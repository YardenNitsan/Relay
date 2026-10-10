import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {openDatabase} from '../server/db/database.js';

const sourceUrl=new URL(process.env.RELAY_TEST_DATABASE_URL??'');
assert.ok(['postgres:','postgresql:'].includes(sourceUrl.protocol));
assert.ok(['127.0.0.1','localhost','[::1]'].includes(sourceUrl.hostname));
assert.match(sourceUrl.pathname,/^\/relay_integration_[a-z0-9_]+$/);
const restoredUrl=new URL(sourceUrl);restoredUrl.pathname+='_restored';
const source=await openDatabase(undefined,sourceUrl.href),restored=await openDatabase(undefined,restoredUrl.href);
try {
  const tables=(await source.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>String(row.tablename));
  assert.deepEqual((await restored.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row=>String(row.tablename)),tables);
  const summaries=[];
  for(const table of tables) {
    assert.match(table,/^[a-z_]+$/);
    const sql=`SELECT row_to_json(t)::text AS value FROM "${table}" t ORDER BY row_to_json(t)::text`;
    const original=await source.query(sql),copy=await restored.query(sql);
    assert.deepEqual(copy,original,`Restored ${table} records must match the quiesced source`);
    summaries.push({table,rows:copy.length,sha256:createHash('sha256').update(JSON.stringify(copy)).digest('hex')});
  }
  await assert.rejects(restored.query("INSERT INTO tasks(id,conversation_id,objective,status,options) VALUES ('restore-constraint-probe','missing','Must fail','created','{}')"),/foreign key/);
  const report={testedAt:new Date().toISOString(),protocol:'relay-native-postgres-restore-v1',platform:process.platform,passed:true,tables:summaries,checks:['Actual pg_dump custom archive and pg_restore into separate disposable database','Every public table and row compared to the stopped source','Restored foreign-key enforcement checked']};
  await writeFile('output/native-postgres-restore.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,tables:tables.length}));
} finally {await restored.close();await source.close();}
