// src/agents/intake/intake-worker.ts — BullMQ job handler factory for intake.ingest queue
import type { Job } from 'bullmq';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processIntakeSubmission } from './intake-agent';

export function createIntakeHandler(
  db: SupabaseClient,
  openrouterApiKey: string,
): (job: Job) => Promise<void> {
  return async (job: Job): Promise<void> => {
    const { submission_id, operator_id } = job.data as Record<string, unknown>;

    if (typeof submission_id !== 'string' || !submission_id) {
      throw new Error('intake job missing submission_id');
    }
    if (typeof operator_id !== 'string' || !operator_id) {
      throw new Error('intake job missing operator_id');
    }

    await processIntakeSubmission(db, openrouterApiKey, { submission_id, operator_id });
  };
}
