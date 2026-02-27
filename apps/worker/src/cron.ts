// src/cron.ts — Browser job creation 4x daily at 07:00, 10:00, 13:00, 16:00 CLT
import * as Sentry from '@sentry/node';
import cron from 'node-cron';
import { pool } from './db';
import { log } from './logger';

export function startCron(): void {
  cron.schedule('0 7,10,13,16 * * *', createBrowserJobs, { timezone: 'America/Santiago' });
  log('info', 'cron_registered', { schedule: '0 7,10,13,16 * * * (America/Santiago)' });
}

export async function createBrowserJobs(): Promise<void> {
  log('info', 'cron_browser_jobs_start');
  try {
    const { rows: clients } = await pool.query(
      `SELECT id, operator_id FROM tenant_clients WHERE is_active = true AND connector_type = 'browser'`,
    );
    log('info', 'cron_clients_found', { count: clients.length });

    // Round current CLT time to the nearest scheduled hour (7, 10, 13, 16) for dedup
    const nowClt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
    const currentHour = nowClt.getHours();
    const slots = [7, 10, 13, 16];
    const nearestSlot = slots.reduce((prev, curr) =>
      Math.abs(curr - currentHour) < Math.abs(prev - currentHour) ? curr : prev,
    );

    for (const client of clients) {
      // Check for existing job in the same time slot (nearest scheduled hour ±1h)
      const { rows: existing } = await pool.query(
        `SELECT id FROM jobs
         WHERE client_id = $1
           AND status IN ('pending', 'running', 'retrying', 'completed')
           AND scheduled_at >= (NOW() AT TIME ZONE 'America/Santiago')::date + ($2 || ' hours')::interval - interval '1 hour'
           AND scheduled_at < (NOW() AT TIME ZONE 'America/Santiago')::date + ($2 || ' hours')::interval + interval '1 hour'`,
        [client.id, nearestSlot],
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
