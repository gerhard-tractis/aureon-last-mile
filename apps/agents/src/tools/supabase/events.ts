// src/tools/supabase/events.ts — Audit event logger (fire-and-forget)
import type { SupabaseClient } from '@supabase/supabase-js';
import { log } from '../../lib/logger';

export interface AgentEventInput {
  operator_id: string;
  agent: string;
  event_type: string;
  job_id?: string;
  meta: Record<string, unknown>;
}

export async function logAgentEvent(db: SupabaseClient, event: AgentEventInput): Promise<void> {
  const { error } = await db.from('agent_events').insert({
    operator_id: event.operator_id,
    agent: event.agent,
    event_type: event.event_type,
    job_id: event.job_id ?? null,
    meta: event.meta,
  });
  if (error) {
    log('warn', 'agent_event_write_failed', { error: error.message });
  }
}
