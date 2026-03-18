// src/index.ts — Aureon Agent Suite entry point (Phase 0: no queues)
import * as Sentry from '@sentry/node';
import { log } from './lib/logger';
import { loadConfig } from './config';
import { initRedis, disconnectRedis } from './lib/redis-client';
import { initSupabase } from './lib/supabase-client';
import { startHealthServer } from './lib/health';
import type http from 'http';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
});

let shuttingDown = false;
let healthServer: http.Server | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'agents_stop', { signal });
  healthServer?.close();
  await disconnectRedis();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
  log('info', 'agents_start', { version: '0.1.0' });

  const cfg = loadConfig();

  await initRedis(cfg.REDIS_URL);
  initSupabase(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  healthServer = startHealthServer();

  log('info', 'agents_ready', { version: '0.1.0' });
}

main().catch((err) => {
  Sentry.captureException(err);
  log('error', 'agents_fatal', { error: String(err) });
  process.exit(1);
});
