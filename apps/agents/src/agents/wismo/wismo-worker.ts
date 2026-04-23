// src/agents/wismo/wismo-worker.ts — BullMQ job handler factory for wismo.client queue
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processWismoJob, type WismoProactiveJob, type WismoClientJob } from './wismo-agent';
import { log } from '../../lib/logger';

const PROACTIVE_TYPES = new Set<string>([
  'proactive_early_arrival',
  'proactive_pickup',
  'proactive_eta',
  'proactive_delivered',
  'proactive_failed',
]);

export function createWismoHandler(
  db: SupabaseClient,
): (job: Job) => Promise<void> {
  return async (job: Job): Promise<void> => {
    const { type, operator_id, order_id } = job.data as Record<string, unknown>;

    if (typeof type !== 'string' || !type) throw new Error('wismo job missing type');
    if (typeof operator_id !== 'string' || !operator_id) throw new Error('wismo job missing operator_id');
    if (typeof order_id !== 'string' || !order_id) throw new Error('wismo job missing order_id');

    log('info', 'wismo_job_start', { type, operator_id, order_id, jobId: job.id });

    if (PROACTIVE_TYPES.has(type)) {
      await processWismoJob({ payload: job.data as WismoProactiveJob, supabase: db });
    } else if (type === 'client_message') {
      const { customer_phone } = job.data as Record<string, unknown>;
      if (typeof customer_phone !== 'string' || !customer_phone) {
        throw new Error('client_message job missing customer_phone');
      }
      await processWismoJob({ payload: job.data as WismoClientJob, supabase: db });
    } else {
      log('warn', 'wismo_unknown_job_type', { type, jobId: job.id });
    }

    log('info', 'wismo_job_done', { type, operator_id, order_id, jobId: job.id });
  };
}
