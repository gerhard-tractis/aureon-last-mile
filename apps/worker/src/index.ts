// src/index.ts — Aureon Automation Worker entry point
import * as Sentry from '@sentry/node';
import { initDb, closeDb } from './db';
import { startPollLoop } from './poller';
import { startCron } from './cron';
import { log } from './logger';

Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'worker_stop', { signal });
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function main(): Promise<void> {
  log('info', 'worker_start', { version: '0.2.0' });
  await initDb();
  startCron();
  startPollLoop().catch((err) => {
    Sentry.captureException(err);
    log('error', 'poll_loop_fatal', { error: String(err) });
    process.exit(1);
  });
}

main().catch((err) => {
  Sentry.captureException(err);
  log('error', 'worker_fatal', { error: String(err) });
  process.exit(1);
});
