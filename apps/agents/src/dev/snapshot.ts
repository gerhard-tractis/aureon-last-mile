// src/dev/snapshot.ts — Test order snapshot query
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TestOrderSnapshot {
  order: unknown;
  assignment: unknown;
  dispatch: unknown;
  session: unknown;
  messages: unknown[];
  reschedules: unknown[];
  recent_agent_events: unknown[];
}

export async function getTestOrderSnapshot(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
): Promise<TestOrderSnapshot> {
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .eq('operator_id', operator_id)
    .single();

  if (orderErr || !order) throw new Error(`Order not found: ${order_id}`);

  const orderRow = order as Record<string, unknown>;
  if (typeof orderRow.external_id !== 'string' || !orderRow.external_id.startsWith('TEST-')) {
    throw new Error(`Order ${order_id} is not a test order`);
  }

  const { data: assignment } = await db
    .from('assignments')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: dispatch } = await db
    .from('dispatches')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: session } = await db
    .from('customer_sessions')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .maybeSingle();

  const messages: unknown[] = [];
  if (session) {
    const sessionRow = session as Record<string, unknown>;
    const { data: msgs } = await db
      .from('customer_session_messages')
      .select('*')
      .eq('session_id', sessionRow.id as string)
      .eq('operator_id', operator_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (msgs) messages.push(...(msgs as unknown[]));
  }

  const { data: reschedules } = await db
    .from('order_reschedules')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const { data: agentEvents } = await db
    .from('agent_events')
    .select('*')
    .eq('operator_id', operator_id)
    .order('created_at', { ascending: false })
    .limit(20);

  return {
    order,
    assignment: assignment ?? null,
    dispatch: dispatch ?? null,
    session: session ?? null,
    messages,
    reschedules: reschedules ?? [],
    recent_agent_events: agentEvents ?? [],
  };
}
