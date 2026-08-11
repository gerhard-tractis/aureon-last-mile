// src/db.ts — PostgreSQL connection with exponential backoff
import { Pool } from 'pg';
import { log, sleep } from './logger';

export let pool: Pool;

/**
 * Supabase Cloud requires TLS; the self-hosted QA Postgres (spec-48, Docker,
 * port 5433) does not support it at all and rejects the handshake with
 * "server does not support SSL, but SSL was required".
 *
 * This was hardcoded to always use TLS, so the QA worker could never connect —
 * it crash-looped 1503 times before anyone noticed, because the catch block
 * below discarded the error and logged only a retry count.
 *
 * Default stays TLS-on so production behaviour is unchanged. Set
 * SUPABASE_DB_SSL=false for a self-hosted Postgres without TLS.
 */
export function sslConfig(): { rejectUnauthorized: boolean } | false {
  return process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false };
}

export async function initDb(): Promise<void> {
  pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
    database: process.env.SUPABASE_DB_NAME,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: sslConfig(),
    max: 5,
    idleTimeoutMillis: 30000,
  });

  let attempt = 0;
  while (attempt < 5) {
    try {
      await pool.query('SELECT 1');
      pool.on('error', (err) => {
        log('error', 'db_pool_error', { error: String(err) });
      });
      log('info', 'db_connected');
      return;
    } catch (err) {
      attempt++;
      const delay = Math.pow(2, attempt - 1) * 1000;
      // Log the reason. Swallowing it turned a one-line misconfiguration into
      // an invisible crash loop.
      log('warn', 'db_connect_retry', {
        attempt,
        delayMs: delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(delay);
    }
  }
  throw new Error('DB connection failed after 5 attempts');
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
  }
}
