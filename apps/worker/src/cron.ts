// src/cron.ts — Daily browser job creation at 06:00 CLT
import * as Sentry from '@sentry/node';
import cron from 'node-cron';
import { pool } from './db';
import { log } from './logger';

export function startCron(): void {
  cron.schedule('0 6 * * *', createDailyBrowserJobs, { timezone: 'America/Santiago' });
  log('info', 'cron_registered', { schedule: '0 6 * * * (America/Santiago)' });
}

export async function createDailyBrowserJobs(): Promise<void> {
  log('info', 'cron_daily_jobs_start');
  try {
    const { rows: clients } = await pool.query(
      `SELECT id, operator_id FROM tenant_clients WHERE is_active = true AND connector_type = 'browser'`,
    );
    log('info', 'cron_clients_found', { count: clients.length });

    for (const client of clients) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM jobs
         WHERE client_id = $1
           AND status IN ('pending', 'running', 'retrying', 'completed')
           AND created_at >= (NOW() AT TIME ZONE 'America/Santiago')::date
           AND created_at < ((NOW() AT TIME ZONE 'America/Santiago')::date + interval '1 day')`,
        [client.id],
      );
      if (existing.length > 0) {
        log('debug', 'cron_job_exists_skip', { clientId: client.id });
        continue;
      }
      await pool.query(
        `INSERT INTO jobs (id, operator_id, client_id, job_type, status, priority, scheduled_at, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'browser', 'pending', 5, NOW(), NOW())`,
        [client.operator_id, client.id],
      );
      log('info', 'cron_job_created', { clientId: client.id, operatorId: client.operator_id });
    }
  } catch (err) {
    Sentry.captureException(err);
    log('error', 'cron_daily_jobs_error', { error: String(err) });
  }
}
