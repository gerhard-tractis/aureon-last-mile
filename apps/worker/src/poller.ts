// src/poller.ts — Poll loop: claim → execute → update
import * as Sentry from '@sentry/node';
import { pool } from './db';
import { connectors } from './connectors';
import { log, sleep } from './logger';
import { JobRecord } from './connectors/types';

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 30000);
const BETTERSTACK_HEARTBEAT_URL = process.env.BETTERSTACK_HEARTBEAT_URL;

const POLL_QUERY = `
  SELECT id, job_type, client_id, operator_id, retry_count, max_retries, priority, scheduled_at
  FROM jobs
  WHERE status IN ('pending', 'retrying')
    AND (scheduled_at IS NULL OR scheduled_at <= now())
  ORDER BY priority DESC, scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
`;

export async function startPollLoop(): Promise<void> {
  log('info', 'poll_loop_start', { intervalMs: POLL_INTERVAL_MS });
  while (true) {
    await pollOnce();
    await sendHeartbeat();
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function pollOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<JobRecord>(POLL_QUERY);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      log('debug', 'poll_no_jobs');
      return;
    }
    const job = rows[0];
    await client.query(
      `UPDATE jobs SET status = 'running', started_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [job.id],
    );
    await client.query('COMMIT');
    log('info', 'job_claimed', { jobId: job.id, jobType: job.job_type });
    await executeJob(job);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    log('error', 'poll_error', { error: String(err) });
    Sentry.captureException(err);
  } finally {
    client.release();
  }
}

async function executeJob(job: JobRecord): Promise<void> {
  const startMs = Date.now();
  const executor = connectors[job.job_type];
  if (!executor) {
    log('warn', 'unknown_job_type', { jobId: job.id, jobType: job.job_type });
    await pool.query(
      `UPDATE jobs SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
      [`Unknown job_type: ${job.job_type}`, job.id],
    );
    return;
  }
  try {
    const result = await executor(job);
    const durationMs = Date.now() - startMs;
    if (result.success) {
      await pool.query(
        `UPDATE jobs SET status = 'completed', completed_at = NOW(), result = $1, updated_at = NOW() WHERE id = $2`,
        [JSON.stringify(result.result ?? {}), job.id],
      );
      log('info', 'job_completed', { jobId: job.id, jobType: job.job_type, durationMs });
    } else {
      await handleJobFailure(job, result.errorMessage ?? 'Connector returned failure');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Sentry.withScope((scope) => {
      scope.setContext('job', {
        id: job.id,
        job_type: job.job_type,
        client_id: job.client_id,
        operator_id: job.operator_id,
        retry_count: job.retry_count,
      });
      Sentry.captureException(err);
    });
    await handleJobFailure(job, msg);
  }
}

async function handleJobFailure(job: JobRecord, errorMessage: string): Promise<void> {
  const newRetryCount = job.retry_count + 1;
  if (job.retry_count < job.max_retries) {
    const backoffSeconds = Math.pow(2, newRetryCount) * 60;
    await pool.query(
      `UPDATE jobs SET status = 'retrying', retry_count = $1, error_message = $2,
        scheduled_at = NOW() + ($3 || ' seconds')::interval, updated_at = NOW() WHERE id = $4`,
      [newRetryCount, errorMessage, backoffSeconds, job.id],
    );
    log('warn', 'job_retrying', { jobId: job.id, retryCount: newRetryCount, backoffSeconds });
  } else {
    await pool.query(
      `UPDATE jobs SET status = 'failed', retry_count = $1, error_message = $2, updated_at = NOW() WHERE id = $3`,
      [newRetryCount, errorMessage, job.id],
    );
    log('error', 'job_failed_permanent', {
      jobId: job.id,
      jobType: job.job_type,
      retryCount: newRetryCount,
    });
  }
}

async function sendHeartbeat(): Promise<void> {
  if (!BETTERSTACK_HEARTBEAT_URL) return;
  try {
    await fetch(BETTERSTACK_HEARTBEAT_URL);
  } catch {
    log('warn', 'heartbeat_failed');
  }
}
