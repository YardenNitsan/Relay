import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { openDatabase, type Database } from '../server/db/database.js';
import { Store } from '../server/db/store.js';
import { schema } from '../server/db/schema.js';
import { migrate, migrations } from '../server/db/migrations.js';

const latest=migrations.at(-1)!.version;
const versions=[1,2,3,...migrations.map(migration=>migration.version)];
let db: Database;
beforeEach(async () => { db = await openDatabase(); });
afterEach(async () => { await db.close(); });

describe('versioned database initialization', () => {
  it('upgrades version 8 evaluation protocols while retaining old records and rejecting unknown suites',async()=>{
    await migrate(db,migrations.filter(item=>item.version<=8));const oldHistory=await db.query('SELECT * FROM schema_migrations ORDER BY version');const store=new Store(db),conversation=await store.createConversation();
    const {task}=await store.createTask(conversation.id,'Retained evaluation',{depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:3,maxSeconds:30,maxIterations:3,maxCostUsd:0,localOnly:true}});
    await db.query("INSERT INTO model_evaluations(id,user_id,task_id,protocol,identity,status) VALUES ('legacy-evaluation','owner',$1,'relay-capability-eval-v2','{}','failed')",[task.id]);await store.init();
    expect(await db.query('SELECT * FROM schema_migrations WHERE version<=8 ORDER BY version')).toEqual(oldHistory);expect((await db.query("SELECT protocol FROM model_evaluations WHERE id='legacy-evaluation'"))[0].protocol).toBe('relay-capability-eval-v2');
    await db.query("UPDATE model_evaluations SET protocol='relay-code-eval-v1' WHERE id='legacy-evaluation'");await expect(db.query("UPDATE model_evaluations SET protocol='unrecognized-suite' WHERE id='legacy-evaluation'")).rejects.toThrow(/check constraint/i);
  });
  it('appends wait accounting to version 4 without rewriting history or active budgets',async()=>{
    await migrate(db,migrations.slice(0,1));
    const history=(await db.query('SELECT name,checksum FROM schema_migrations WHERE version=4'))[0];
    const store=new Store(db),conversation=await store.createConversation();
    const {task}=await store.createTask(conversation.id,'Preserve active budget',{depth:'fast',modelId:null,access:'read_only',workspaceId:null,contextTokens:8192,budget:{maxCalls:4,maxSeconds:30,maxIterations:2,maxCostUsd:0,localOnly:true}});
    await db.query('UPDATE tasks SET execution_used_ms=1200,execution_reserved_ms=800 WHERE id=$1',[task.id]);
    await store.init();
    const saved=(await db.query('SELECT * FROM tasks WHERE id=$1',[task.id]))[0];
    expect(Number(saved.execution_used_ms)).toBe(1200);expect(Number(saved.execution_reserved_ms)).toBe(800);
    expect(Number(saved.approval_wait_ms)).toBe(0);expect(Number(saved.resource_wait_ms)).toBe(0);expect(saved.execution_wait_kind).toBeNull();
    expect((await db.query('SELECT name,checksum FROM schema_migrations WHERE version=4'))[0]).toEqual(history);
  });
  it('initializes once with checksummed history and preserves settings on repeated initialization', async () => {
    const store = new Store(db); await store.init();
    await db.query("UPDATE users SET permissions=jsonb_set(permissions,'{providers}','[\"ollama\"]') WHERE id='owner'");
    const history = await db.query('SELECT * FROM schema_migrations ORDER BY version');
    expect(history.map(row => row.version)).toEqual(versions);
    expect(history[3].checksum).toMatch(/^[a-f0-9]{64}$/);
    await store.init();
    expect(await db.query('SELECT * FROM schema_migrations ORDER BY version')).toEqual(history);
    expect((await db.query("SELECT permissions->'providers' AS providers FROM users WHERE id='owner'"))[0].providers).toEqual(['ollama']);
  });
  it('refuses a database created by a newer application without modifying it', async () => {
    await db.exec(schema); await db.query('INSERT INTO schema_migrations(version) VALUES (999)');
    await expect(new Store(db).init()).rejects.toThrow(/newer|unsupported/i);
    expect((await db.query('SELECT count(*) AS count FROM schema_migrations'))[0].count).toBe(4);
  });
  it('rejects gapped migration history', async () => {
    await db.exec(schema); await db.query('DELETE FROM schema_migrations WHERE version=2');
    await expect(new Store(db).init()).rejects.toThrow(/history|gap/i);
    expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).map(row => row.version)).toEqual([1, 3]);
  });
  it('upgrades an older marker-3 snapshot while preserving conversation data and revoked provider grants', async () => {
    // The old release kept marker 3 while adding columns; simulate a snapshot
    // predating durable execution budgets and private workspace ownership.
    await db.exec(schema);
    await db.exec('ALTER TABLE tasks DROP COLUMN execution_used_ms, DROP COLUMN execution_reserved_ms, DROP COLUMN execution_lease_id; ALTER TABLE workspaces DROP COLUMN owner_user_id');
    const store = new Store(db); const conversation = await store.createConversation('Keep this history');
    await db.query("UPDATE users SET permissions=jsonb_set(permissions,'{providers}','[\"ollama\"]') WHERE id='owner'");
    await store.init();
    expect((await store.conversation(conversation.id)).conversation.title).toBe('Keep this history');
    expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name LIKE 'execution_%'"))).toHaveLength(5);
    expect((await db.query("SELECT permissions->'providers' AS providers FROM users WHERE id='owner'"))[0].providers).toEqual(['ollama']);
    expect((await db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version).toBe(latest);
  });
  it('rolls back a failed upgrade instead of leaving a partially altered schema', async () => {
    await db.exec(schema);
    await db.exec('ALTER TABLE tasks DROP COLUMN execution_used_ms; DROP TABLE personal_tasks; CREATE VIEW personal_tasks AS SELECT 1 AS dummy');
    await expect(new Store(db).init()).rejects.toThrow();
    expect(await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='tasks' AND column_name='execution_used_ms'")).toHaveLength(0);
    expect((await db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version).toBe(3);
  });
  it('serializes concurrent initialization without duplicate upgrades', async () => {
    await Promise.all([new Store(db).init(), new Store(db).init()]);
    expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).map(row => row.version)).toEqual(versions);
  });
  it('refuses changed checksums instead of silently accepting edited migration history', async () => {
    const store = new Store(db); await store.init();
    await db.query("UPDATE schema_migrations SET checksum=$1 WHERE version=4", ['0'.repeat(64)]);
    await expect(store.init()).rejects.toThrow(/checksum|changed/i);
  });
  it('upgrades the actual 9c29d1b schema while retaining history, users and workspace records', async () => {
    await db.exec(await readFile(new URL('./fixtures/schema-9c29d1b.sql', import.meta.url), 'utf8'));
    await db.exec(`INSERT INTO conversations(id,title) VALUES ('old-conversation','Existing conversation');
      INSERT INTO messages(id,conversation_id,role,content) VALUES ('old-message','old-conversation','user','Keep my message');
      INSERT INTO workspaces(id,name,file_count) VALUES ('old-workspace','Existing project',12);
      INSERT INTO users(id,name,role,permissions) SELECT 'old-user','Existing user','chat',permissions FROM users WHERE id='owner';`);
    const originalUser = (await db.query("SELECT * FROM users WHERE id='old-user'"))[0];
    const store = new Store(db); await store.init();
    expect((await store.conversation('old-conversation')).messages[0].content).toBe('Keep my message');
    expect((await db.query("SELECT * FROM users WHERE id='old-user'"))[0]).toMatchObject(originalUser);
    expect((await db.query("SELECT * FROM workspaces WHERE id='old-workspace'"))[0]).toMatchObject({ name: 'Existing project', file_count: 12, owner_user_id: null });
    expect((await db.query("SELECT permissions->'providers' AS providers FROM users WHERE id='old-user'"))[0].providers).not.toContain('xai');
    expect((await db.query("SELECT permissions->'providers' AS providers FROM users WHERE id='owner'"))[0].providers).toContain('xai');
    await store.init();
    expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).map(row => row.version)).toEqual(versions);
  });
  it('rolls back every pending version and its data when a later migration fails, then permits a corrected retry', async () => {
    await new Store(db).init();
    const sixth = { version: latest+1, name: 'test-upgrade', sql: 'CREATE TABLE migration_probe(value text); INSERT INTO migration_probe(value) VALUES (\'retained only on commit\')' };
    await expect(migrate(db, [...migrations, sixth, { version: latest+2, name: 'test-failure', sql: 'SELECT missing_column FROM migration_probe' }])).rejects.toThrow(new RegExp(`migration ${latest+2} failed`,'i'));
    expect((await db.query("SELECT to_regclass('public.migration_probe') AS table_name"))[0].table_name).toBeNull();
    expect((await db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version).toBe(latest);
    await migrate(db, [...migrations, sixth]);
    expect((await db.query('SELECT value FROM migration_probe'))[0].value).toBe('retained only on commit');
    await expect(new Store(db).init()).rejects.toThrow(/newer/i);
  });
  it('rejects edited applied SQL and invalid migration ordering before applying new work', async () => {
    await new Store(db).init();
    await expect(migrate(db, [{ ...migrations[0], sql: migrations[0].sql + '\n-- edited' }, ...migrations.slice(1)])).rejects.toThrow(/checksum/i);
    await expect(migrate(db, [...migrations, { version: latest+2, name: 'skipped-version', sql: 'SELECT 1' }])).rejects.toThrow(/consecutive/i);
    expect((await db.query('SELECT max(version) AS version FROM schema_migrations'))[0].version).toBe(latest);
  });
});
