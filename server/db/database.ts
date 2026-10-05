import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, parameters?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}
export interface Database extends Sql {
  kind: string;
  transaction<T>(callback: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export async function openDatabase(dataDir?: string, connectionString?: string): Promise<Database> {
  if (connectionString) {
    const pool = new pg.Pool({ connectionString, max: 4, application_name: 'relay', connectionTimeoutMillis: 5000 });
    const sqlFor = (client: pg.Pool | pg.PoolClient): Sql => ({
      async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await client.query<T>(sql, values)).rows; },
      async exec(sql) { await client.query(sql); },
    });
    return { kind: 'PostgreSQL', ...sqlFor(pool), async transaction(callback) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const value = await callback(sqlFor(client)); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    }, async close() { await pool.end(); } };
  }
  const embedded = await PGlite.create(dataDir ?? 'memory://');
  return {
    kind: 'Embedded PostgreSQL',
    async query<T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) { return (await embedded.query<T>(sql, parameters)).rows; },
    async exec(sql) { await embedded.exec(sql); },
    async transaction(callback) {
      return embedded.transaction(async tx => callback({
        async query<T extends Record<string, unknown>>(sql: string, parameters: unknown[] = []) { return (await tx.query<T>(sql, parameters)).rows; },
        async exec(sql) { await tx.exec(sql); },
      }));
    },
    async close() { await embedded.close(); },
  };
}
