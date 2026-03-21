// src/agents/intake/intake-fallback.ts — Rules-based fallback when LLM is unavailable
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../../lib/logger';

export async function intakeFallback(
  db: SupabaseClient,
  submissionId: string,
  operatorId: string,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log('warn', 'intake_llm_fallback', { submissionId, operatorId, error: message });

  const { error: dbError } = await db
    .from('intake_submissions')
    .update({
      status: 'failed',
      validation_errors: [{ message: `LLM unavailable: ${message}` }],
    })
    .eq('id', submissionId)
    .eq('operator_id', operatorId)
    .not('deleted_at', 'is', null);

  if (dbError) {
    log('warn', 'intake_fallback_db_error', { submissionId, error: dbError.message });
  }
}
