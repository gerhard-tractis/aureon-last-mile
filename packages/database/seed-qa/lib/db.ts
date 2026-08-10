/**
 * spec-51 — database access for the QA seed generator.
 *
 * Every connection goes through the guards in ./guards.ts. There is no code
 * path here that reaches a database without them.
 */

import { Client } from 'pg';
import {
  assertLocalQaTarget,
  assertNoCloudEnv,
  assertNotProductionData,
  type TargetConfig,
} from './guards';
import { ENUM_QUERY, findEnumDrift, formatEnumDrift } from './enums';

export interface SeedClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: SeedClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Read the target from the environment, defaulting to the QA stack.
 * Defaults match infra/supabase-qa/docker-compose.yml.
 */
export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): TargetConfig {
  return {
    host: env.SEED_QA_HOST ?? 'localhost',
    port: Number(env.SEED_QA_PORT ?? 5433),
    database: env.SEED_QA_DATABASE ?? 'postgres',
    user: env.SEED_QA_USER ?? 'postgres',
    password: env.POSTGRES_PASSWORD ?? env.SEED_QA_PASSWORD,
  };
}

function wrap(client: Client): SeedClient {
  const api: SeedClient = {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query(sql, params as never[]);
      return result.rows as T[];
    },

    async transaction<T>(fn: (tx: SeedClient) => Promise<T>): Promise<T> {
      await client.query('BEGIN');
      try {
        const value = await fn(api);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },

    async close() {
      await client.end();
    },
  };

  return api;
}

/**
 * Connect to the QA database, refusing anything that is not it.
 *
 * Order matters: config and environment are checked before the socket opens,
 * and the production-data check runs before any write.
 */
export async function connect(env: NodeJS.ProcessEnv = process.env): Promise<SeedClient> {
  assertNoCloudEnv(env);

  const target = targetFromEnv(env);
  assertLocalQaTarget(target);

  const client = new Client(target);
  await client.connect();

  try {
    const rows = await client.query<{ id: string }>('SELECT id FROM public.operators');
    assertNotProductionData(rows.rows.map((r) => r.id));
  } catch (error) {
    await client.end();
    throw error;
  }

  return wrap(client);
}

/**
 * Compare the database's enums against EXPECTED_ENUMS and throw on drift.
 *
 * Runs before any scenario. A string comparison against an enum fails quietly,
 * so this is the difference between a loud startup error and data that looks
 * fine but never matches.
 */
export async function assertEnumsMatch(db: SeedClient): Promise<void> {
  const rows = await db.query<{ enum_name: string; values: string[] }>(ENUM_QUERY);

  const actual: Record<string, string[]> = {};
  for (const row of rows) actual[row.enum_name] = row.values;

  const drift = findEnumDrift(actual);
  if (drift.length > 0) {
    throw new Error(formatEnumDrift(drift));
  }
}
