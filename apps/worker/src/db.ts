// src/db.ts — PostgreSQL connection with exponential backoff
import { Pool } from 'pg';
import { log, sleep } from './logger';

export let pool: Pool;

export async function initDb(): Promise<void> {
  pool = new Pool({
    host: process.env.SUPABASE_DB_HOST,
    port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
    database: process.env.SUPABASE_DB_NAME,
    user: process.env.SUPABASE_DB_USER,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
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
    } catch {
      attempt++;
      const delay = Math.pow(2, attempt - 1) * 1000;
      log('warn', 'db_connect_retry', { attempt, delayMs: delay });
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
