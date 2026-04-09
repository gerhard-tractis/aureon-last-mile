// src/lib/conversations/queries.ts
import { createSPAClient } from '@/lib/supabase/client';
import type { ConversationSession, SessionMessage, ConversationFilters } from './types';

export async function fetchSessions(
  operatorId: string,
  filters: ConversationFilters,
): Promise<ConversationSession[]> {
  const supabase = createSPAClient();

  let query = supabase
    .from('customer_sessions')
    .select('*, orders!inner(order_number)')
    .eq('operator_id', operatorId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });

  if (filters.statuses.length > 0) {
    query = query.in('status', filters.statuses);
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom);
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo + 'T23:59:59Z');
  }
  if (filters.search) {
    query = query.or(
      `customer_name.ilike.%${filters.search}%,orders.order_number.ilike.%${filters.search}%`,
    );
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    order_number: (row.orders as { order_number: string })?.order_number ?? '',
  })) as ConversationSession[];
}

export async function fetchMessages(sessionId: string): Promise<SessionMessage[]> {
  const supabase = createSPAClient();
  const { data, error } = await supabase
    .from('customer_session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as SessionMessage[];
}
