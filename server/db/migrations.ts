import { createHash } from 'node:crypto';
import { AppError } from '../core/errors.js';
import type { Database } from './database.js';
import { schema } from './schema.js';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Versions 1–3 were historical markers, not immutable migration bodies. Version
 * 4 reconciles those installations once. Append new migrations; never edit one
 * that has shipped, including its imported SQL. */
export const migrations: readonly Migration[] = [
  { version: 4, name: 'legacy-schema-reconciliation', sql: schema },
  { version: 5, name: 'execution-wait-accounting', sql: `
    ALTER TABLE tasks ADD COLUMN approval_wait_ms bigint NOT NULL DEFAULT 0 CHECK (approval_wait_ms >= 0);
    ALTER TABLE tasks ADD COLUMN resource_wait_ms bigint NOT NULL DEFAULT 0 CHECK (resource_wait_ms >= 0);
    ALTER TABLE tasks ADD COLUMN execution_wait_kind text CHECK (execution_wait_kind IN ('approval','resource'));
    ALTER TABLE tasks ADD COLUMN execution_wait_started_at timestamptz;
    ALTER TABLE tasks ADD CONSTRAINT execution_wait_marker CHECK ((execution_wait_kind IS NULL) = (execution_wait_started_at IS NULL));
  ` },
  { version: 6, name: 'versioned-model-evaluations', sql: `
    CREATE TABLE model_evaluations (
      id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
      task_id text NOT NULL UNIQUE REFERENCES tasks(id),
      protocol text NOT NULL CHECK(protocol='relay-capability-eval-v2'),
      identity jsonb NOT NULL CHECK(jsonb_typeof(identity)='object'),
      report jsonb, status text NOT NULL CHECK(status IN ('running','completed','failed','interrupted')),
      created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
      CHECK((status='completed')=(report IS NOT NULL)),
      CHECK(report IS NULL OR (jsonb_typeof(report)='object' AND octet_length(report::text)<=65536))
    );
    CREATE INDEX model_evaluations_user_created ON model_evaluations(user_id,created_at DESC);
  ` },
  {version:7,name:'approved-scoped-memory',sql:`
    CREATE TABLE memory_notes (
      id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),workspace_id text REFERENCES workspaces(id),
      title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
      content text NOT NULL CHECK(char_length(content) BETWEEN 1 AND 4096),
      enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX memory_notes_user_updated ON memory_notes(user_id,updated_at DESC,id);
  `},
  {version:8,name:'durable-owner-schedules',sql:`
    CREATE TABLE task_schedules (
      id text PRIMARY KEY,user_id text NOT NULL REFERENCES users(id),name text NOT NULL,objective text NOT NULL,
      options jsonb NOT NULL,session_version integer NOT NULL,grant_snapshot jsonb NOT NULL,
      interval_minutes integer CHECK(interval_minutes BETWEEN 15 AND 525600),
      missed_policy text NOT NULL CHECK(missed_policy IN ('skip','once')),next_run_at timestamptz,
      enabled boolean NOT NULL DEFAULT false,archived_at timestamptz,last_error text,revision integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX task_schedules_due ON task_schedules(next_run_at) WHERE enabled AND archived_at IS NULL;
    CREATE TABLE schedule_runs (
      id text PRIMARY KEY,schedule_id text NOT NULL REFERENCES task_schedules(id),user_id text NOT NULL REFERENCES users(id),
      scheduled_at timestamptz NOT NULL,task_id text UNIQUE REFERENCES tasks(id),schedule_revision integer NOT NULL,
      status text NOT NULL CHECK(status IN ('claimed','dispatched','skipped','interrupted','failed')),reason text,
      created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(schedule_id,scheduled_at)
    );
    CREATE INDEX schedule_runs_user_created ON schedule_runs(user_id,created_at DESC);
  `},
  {version:9,name:'isolated-executable-model-evaluations',sql:`
    ALTER TABLE model_evaluations DROP CONSTRAINT model_evaluations_protocol_check;
    ALTER TABLE model_evaluations ADD CONSTRAINT model_evaluations_protocol_check
      CHECK(protocol IN ('relay-capability-eval-v2','relay-code-eval-v1'));
  `},
  {version:10,name:'unfinished-task-deadline-index',sql:`
    CREATE INDEX tasks_pending_deadlines ON tasks(created_at,id)
      WHERE status NOT IN ('completed','failed','cancelled')
        AND options->'budget'->>'maxElapsedSeconds' IS NOT NULL;
  `},
  {version:11,name:'managed-workspace-git-provenance',sql:`
    ALTER TABLE workspaces ADD COLUMN git jsonb;
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_git_object CHECK (git IS NULL OR jsonb_typeof(git)='object');
  `},
];
const checksum = (migration: Migration) => createHash('sha256')
  .update(JSON.stringify([migration.version, migration.name, migration.sql.replace(/\r\n/g, '\n')])).digest('hex');

/** DDL and its ledger commit together. One transaction also prevents a failed
 * multi-version upgrade from leaving earlier pending versions half-installed. */
export async function migrate(db: Database, plan: readonly Migration[] = migrations): Promise<void> {
  if (!plan.length || plan.some((item, index) => item.version !== index + 4 || !item.name || !item.sql.trim())) {
    throw new AppError('MIGRATION_PLAN', 'Migration definitions must be consecutive starting at version 4.', 500);
  }
  const latest = plan.at(-1)!.version;
  await db.transaction(async tx => {
    // Same fixed transaction lock for every Relay release, including fresh DBs.
    // PGlite serializes transactions; native PostgreSQL also needs this lock.
    await tx.exec("SET LOCAL lock_timeout = '5s'");
    await tx.query('SELECT pg_advisory_xact_lock(1380273236, 1)');
    await tx.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS name text;
      ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text;`);
    const applied = await tx.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
    if (applied.some(row => Number(row.version) > latest)) {
      throw new AppError('SCHEMA_TOO_NEW', 'This database belongs to a newer Relay version. Use a compatible release; downgrade was refused.', 409);
    }
    if (applied.some((row, index) => Number(row.version) !== index + 1)) {
      throw new AppError('MIGRATION_HISTORY', 'Database migration history has gaps or invalid versions. Restore a verified backup or inspect the history before upgrading.', 409);
    }
    for (const migration of plan) {
      const saved = applied.find(row => Number(row.version) === migration.version);
      if (saved && (saved.name !== migration.name || saved.checksum !== checksum(migration))) {
        throw new AppError('MIGRATION_CHANGED', `Migration ${migration.version} checksum or identity changed. Use the original release or a verified backup.`, 409);
      }
    }
    for (const migration of plan) {
      if (applied.some(row => Number(row.version) === migration.version)) continue;
      try {
        await tx.exec(migration.sql);
        await tx.query('INSERT INTO schema_migrations(version,name,checksum) VALUES ($1,$2,$3)', [migration.version, migration.name, checksum(migration)]);
      } catch {
        // SQL errors can contain values from private rows. Keep startup errors
        // actionable without publishing query text or data in logs.
        throw new AppError('MIGRATION_FAILED', `Database migration ${migration.version} failed. The upgrade was rolled back. Preserve the database and inspect a private copy before retrying.`, 500);
      }
    }
  });
}
