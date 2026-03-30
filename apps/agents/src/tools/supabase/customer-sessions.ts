// src/tools/supabase/customer-sessions.ts — CRUD for customer_sessions + customer_session_messages
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CustomerSession {
  id: string;
  operator_id: string;
  order_id: string;
  customer_phone: string;
  customer_name: string | null;
  status: 'active' | 'closed' | 'escalated';
  escalated_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerSessionMessage {
  id: string;
  operator_id: string;
  session_id: string;
  role: 'user' | 'system';
  body: string;
  external_message_id: string | null;
  wa_status: string | null;
  template_name: string | null;
  action_taken: string | null;
  created_at: string;
}

export async function createOrGetSession(
  db: SupabaseClient,
  params: {
    operator_id: string;
    order_id: string;
    customer_phone: string;
    customer_name?: string;
  },
): Promise<CustomerSession> {
  // Try to find existing active session
  const { data: existing, error: findErr } = await db
    .from('customer_sessions')
    .select('*')
    .eq('operator_id', params.operator_id)
    .eq('order_id', params.order_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (findErr) throw new Error(`customer_sessions fetch: ${findErr.message}`);
  if (existing) return existing as CustomerSession;

  // Create new session
  const { data, error } = await db
    .from('customer_sessions')
    .insert({
      operator_id: params.operator_id,
      order_id: params.order_id,
      customer_phone: params.customer_phone,
      customer_name: params.customer_name ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`customer_sessions insert: ${error.message}`);
  return data as CustomerSession;
}

export async function getSessionHistory(
  db: SupabaseClient,
  session_id: string,
  operator_id: string,
): Promise<CustomerSessionMessage[]> {
  const { data, error } = await db
    .from('customer_session_messages')
    .select('*')
    .eq('session_id', session_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`session_messages fetch: ${error.message}`);
  return (data ?? []) as CustomerSessionMessage[];
}

export async function logSessionMessage(
  db: SupabaseClient,
  params: {
    operator_id: string;
    session_id: string;
    role: 'user' | 'system';
    body: string;
    external_message_id?: string;
    wa_status?: string;
    template_name?: string;
    action_taken?: string;
  },
): Promise<CustomerSessionMessage> {
  const { data, error } = await db
    .from('customer_session_messages')
    .insert({
      operator_id: params.operator_id,
      session_id: params.session_id,
      role: params.role,
      body: params.body,
      external_message_id: params.external_message_id ?? null,
      wa_status: params.wa_status ?? null,
      template_name: params.template_name ?? null,
      action_taken: params.action_taken ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`session_messages insert: ${error.message}`);
  return data as CustomerSessionMessage;
}

export async function closeSession(
  db: SupabaseClient,
  session_id: string,
  operator_id: string,
): Promise<void> {
  const { error } = await db
    .from('customer_sessions')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .eq('id', session_id)
    .eq('operator_id', operator_id);

  if (error) throw new Error(`customer_sessions close: ${error.message}`);
}

export async function escalateSession(
  db: SupabaseClient,
  session_id: string,
  operator_id: string,
): Promise<void> {
  const { error } = await db
    .from('customer_sessions')
    .update({ status: 'escalated', escalated_at: new Date().toISOString() })
    .eq('id', session_id)
    .eq('operator_id', operator_id);

  if (error) throw new Error(`customer_sessions escalate: ${error.message}`);
}
