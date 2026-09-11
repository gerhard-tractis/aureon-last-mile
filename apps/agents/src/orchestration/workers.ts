// src/orchestration/workers.ts — BullMQ Worker registrations with stub handlers
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { log } from '../lib/logger';

type WorkerName =
  | 'intake.ingest'
  | 'assignment.optimize'
  | 'coord.lifecycle'
  | 'wismo.client'
  | 'settle.reconcile'
  | 'whatsapp.outbound'
  | 'exception.handle'
  | 'legacy.worker'
  | 'geocode.enrich';

interface WorkerConfig {
  concurrency: number;
  limiter?: { max: number; duration: number };
}

const WORKER_CONFIGS: Record<WorkerName, WorkerConfig> = {
  'intake.ingest': { concurrency: 3 },
  'assignment.optimize': { concurrency: 1 },
  'coord.lifecycle': { concurrency: 5 },
  'wismo.client': { concurrency: 5 },
  'settle.reconcile': { concurrency: 1 },
  // Rate limit: 60 jobs/min global (per-phone limiting requires BullMQ Pro job groups)
  'whatsapp.outbound': { concurrency: 10, limiter: { max: 60, duration: 60_000 } },
  'exception.handle': { concurrency: 3 },
  'legacy.worker': { concurrency: 1 },
  // Concurrency 1: the batch itself is already 200 orders per cron tick,
  // resolved sequentially against a single shared MapTiler circuit breaker
  // and Redis quota counter (spec-58 fase 5). Running two of these jobs at
  // once in the same process would race both against each other for no
  // throughput gain -- the provider call latency is what limits speed, not
  // worker concurrency.
  'geocode.enrich': { concurrency: 1 },
};

export type Workers = Record<WorkerName, Worker>;

type QueueHandler = (job: Job) => Promise<void>;
export type HandlerMap = Partial<Record<WorkerName, QueueHandler>>;

export function createWorkers(redisUrl: string, handlers?: HandlerMap): Workers {
  const connection = { url: redisUrl };
  const entries = (Object.entries(WORKER_CONFIGS) as [WorkerName, WorkerConfig][]).map(
    ([name, cfg]) => {
      const stubHandler: QueueHandler = async (job: Job) => {
        log('info', 'job_received', { queue: name, jobId: job.id, jobName: job.name });
      };
      const handler = handlers?.[name] ?? stubHandler;
      const worker = new Worker(
        name,
        handler,
        {
          connection,
          concurrency: cfg.concurrency,
          ...(cfg.limiter ? { limiter: cfg.limiter } : {}),
        },
      );
      return [name, worker];
    },
  );
  const workers = Object.fromEntries(entries) as Workers;
  log('info', 'workers_created', { count: entries.length });
  return workers;
}

export async function closeWorkers(workers: Workers): Promise<void> {
  await Promise.all(Object.values(workers).map((w) => w.close()));
  log('info', 'workers_closed');
}
