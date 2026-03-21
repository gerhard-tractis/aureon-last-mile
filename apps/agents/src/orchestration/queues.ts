// src/orchestration/queues.ts — BullMQ Queue instances for all agent queues
import { Queue } from 'bullmq';
import { log } from '../lib/logger';

export type QueueName =
  | 'intake.ingest'
  | 'assignment.optimize'
  | 'coord.lifecycle'
  | 'wismo.client'
  | 'settle.reconcile'
  | 'whatsapp.outbound'
  | 'exception.handle'
  | 'legacy.worker';

interface QueueConfig {
  attempts: number;
  backoffDelay: number;
}

const QUEUE_CONFIGS: Record<QueueName, QueueConfig> = {
  'intake.ingest': { attempts: 3, backoffDelay: 60_000 },
  'assignment.optimize': { attempts: 2, backoffDelay: 120_000 },
  'coord.lifecycle': { attempts: 3, backoffDelay: 30_000 },
  'wismo.client': { attempts: 3, backoffDelay: 30_000 },
  'settle.reconcile': { attempts: 3, backoffDelay: 300_000 },
  'whatsapp.outbound': { attempts: 3, backoffDelay: 10_000 },
  'exception.handle': { attempts: 3, backoffDelay: 60_000 },
  'legacy.worker': { attempts: 3, backoffDelay: 60_000 },
};

export type Queues = Record<QueueName, Queue>;

let _queues: Queues | null = null;

export function createQueues(redisUrl: string): Queues {
  const connection = { url: redisUrl };
  const entries = (Object.entries(QUEUE_CONFIGS) as [QueueName, QueueConfig][]).map(
    ([name, cfg]) => [
      name,
      new Queue(name, {
        connection,
        defaultJobOptions: {
          attempts: cfg.attempts,
          backoff: { type: 'exponential', delay: cfg.backoffDelay },
        },
      }),
    ],
  );
  _queues = Object.fromEntries(entries) as Queues;
  log('info', 'queues_created', { count: entries.length });
  return _queues;
}

export function getQueues(): Queues {
  if (!_queues) throw new Error('Queues not initialized — call createQueues() first');
  return _queues;
}

export async function closeQueues(): Promise<void> {
  if (!_queues) return;
  await Promise.all(Object.values(_queues).map((q) => q.close()));
  _queues = null;
  log('info', 'queues_closed');
}
