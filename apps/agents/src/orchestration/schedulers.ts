// src/orchestration/schedulers.ts — BullMQ cron job registrations
import type { Queue } from 'bullmq';
import { log } from '../lib/logger';

const TZ = 'America/Santiago';

interface ScheduleDef {
  queue: string;
  schedulerId: string;
  pattern: string;
  jobName: string;
}

const SCHEDULES: ScheduleDef[] = [
  { queue: 'intake.ingest', schedulerId: 'email-parse-cron', pattern: '*/15 * * * *', jobName: 'email_parse' },
  { queue: 'assignment.optimize', schedulerId: 'batch-assign-cron', pattern: '0 6,14 * * *', jobName: 'batch_assign' },
  { queue: 'settle.reconcile', schedulerId: 'eod-reconcile-cron', pattern: '0 22 * * *', jobName: 'eod_reconcile' },
  { queue: 'legacy.worker', schedulerId: 'browser-cron', pattern: '0 7,10,13,16 * * *', jobName: 'browser' },
];

export async function registerSchedulers(queues: Record<string, Queue>): Promise<void> {
  await Promise.all(
    SCHEDULES.map((s) =>
      queues[s.queue].upsertJobScheduler(
        s.schedulerId,
        { pattern: s.pattern, tz: TZ },
        { name: s.jobName, data: {} },
      ),
    ),
  );
  log('info', 'schedulers_registered', { count: SCHEDULES.length });
}
