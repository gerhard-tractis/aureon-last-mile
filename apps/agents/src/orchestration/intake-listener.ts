// src/orchestration/intake-listener.ts — Supabase Realtime → intake.ingest BullMQ bridge
// Watches intake_submissions INSERTs and enqueues OCR jobs immediately.
// On startup, recovers any 'received' submissions missed while service was down.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Queue } from 'bullmq';
import { log } from '../lib/logger';

interface IntakeRow {
  id: string;
  operator_id: string;
  status: string;
}

export function startIntakeListener(supabase: SupabaseClient, intakeQueue: Queue): () => void {
  // Recover submissions that arrived while the service was offline
  void recoverPending(supabase, intakeQueue);

  const channel = supabase
    .channel('intake_submissions_listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'intake_submissions' },
      (payload: { new: IntakeRow }) => {
        const row = payload.new;
        if (row.status === 'received') {
          void enqueue(intakeQueue, row.id, row.operator_id);
        }
      },
    )
    .subscribe();

  log('info', 'intake_listener_started');

  return () => {
    void channel.unsubscribe();
    log('info', 'intake_listener_stopped');
  };
}

async function enqueue(queue: Queue, submissionId: string, operatorId: string): Promise<void> {
  try {
    await queue.add(
      'process_intake',
      { submission_id: submissionId, operator_id: operatorId },
      { removeOnComplete: 100, removeOnFail: 500 },
    );
    log('info', 'intake_job_enqueued', { submissionId, operatorId });
  } catch (err) {
    log('error', 'intake_job_enqueue_failed', { submissionId, error: String(err) });
  }
}

async function recoverPending(supabase: SupabaseClient, intakeQueue: Queue): Promise<void> {
  const { data, error } = await supabase
    .from('intake_submissions')
    .select('id, operator_id')
    .eq('status', 'received')
    .is('deleted_at', null);

  if (error) {
    log('warn', 'intake_recovery_failed', { error: error.message });
    return;
  }

  if (!data || data.length === 0) return;

  log('info', 'intake_recovery_enqueuing', { count: data.length });
  for (const row of data) {
    await enqueue(intakeQueue, row.id as string, row.operator_id as string);
  }
}
