// src/index.ts — Aureon Agent Suite entry point (Phase 2: orchestration + command bridge)
import * as Sentry from '@sentry/node';
import type { Server } from 'http';
import type { Queue } from 'bullmq';
import { log } from './lib/logger';
import { loadConfig } from './config';
import { initRedis, disconnectRedis } from './lib/redis-client';
import { initSupabase, supabase } from './lib/supabase-client';
import { startHealthServer } from './lib/health';
import { createQueues, closeQueues } from './orchestration/queues';
import { createWorkers, closeWorkers } from './orchestration/workers';
import type { Workers } from './orchestration/workers';
import { registerSchedulers } from './orchestration/schedulers';
import { createFlowProducer, closeFlowProducer } from './orchestration/flow-producer';
import { startCommandListener } from './orchestration/command-listener';
import { startBullBoard } from './orchestration/bull-board';
import { GroqProvider } from './providers/groq';
import { GlmOcrProvider } from './providers/glm-ocr';
import { IntakeAgent } from './agents/intake/intake-agent';
import { createIntakeHandler } from './agents/intake/intake-worker';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'production',
});

let shuttingDown = false;
let healthServer: Server | null = null;
let bullBoardServer: Server | null = null;
let workers: Workers | null = null;
let stopCommandListener: (() => void) | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'agents_stop', { signal });

  stopCommandListener?.();
  bullBoardServer?.close();
  healthServer?.close();

  if (workers) await closeWorkers(workers);
  await closeFlowProducer();
  await closeQueues();
  await disconnectRedis();

  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

async function main(): Promise<void> {
  log('info', 'agents_start', { version: '0.2.0' });

  const cfg = loadConfig();

  await initRedis(cfg.REDIS_URL);
  initSupabase(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  // Instantiate INTAKE agent
  const groq = new GroqProvider(cfg.GROQ_API_KEY);
  const glmOcr = new GlmOcrProvider(cfg.GLM_OCR_API_KEY, cfg.GLM_OCR_ENDPOINT);
  const intakeAgent = new IntakeAgent(groq, supabase, glmOcr);

  const queues = createQueues(cfg.REDIS_URL) as unknown as Record<string, Queue>;
  workers = createWorkers(cfg.REDIS_URL, {
    'intake.ingest': createIntakeHandler(intakeAgent),
  });
  createFlowProducer(cfg.REDIS_URL);

  await registerSchedulers(queues);

  stopCommandListener = startCommandListener(supabase, queues);

  bullBoardServer = startBullBoard(queues, {
    user: process.env.BULL_BOARD_USER ?? 'admin',
    password: process.env.BULL_BOARD_PASSWORD ?? 'changeme',
  });

  healthServer = startHealthServer();

  log('info', 'agents_ready', { version: '0.3.0' });
}

main().catch((err) => {
  Sentry.captureException(err);
  log('error', 'agents_fatal', { error: String(err) });
  process.exit(1);
});
