// src/dev/test-orders.ts — Dev endpoint handlers for test order CRUD
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateTestOrderInput {
  customer_name: string;
  customer_phone: string;
  delivery_date: string;
  delivery_window_start?: string;
  delivery_window_end?: string;
}

export interface TestOrderSnapshot {
  order: unknown;
  assignment: unknown;
  dispatch: unknown;
  session: unknown;
  messages: unknown[];
  reschedules: unknown[];
  recent_agent_events: unknown[];
}

// ── Dev driver UUID ───────────────────────────────────────────────────────────

/**
 * Derives the deterministic dev driver UUID for an operator.
 * Formula: md5('DEV_DRIVER_' + operator_id) — matches the seed migration.
 * We look up the drivers table bypassing deleted_at filter.
 */
async function getDevDriverId(db: SupabaseClient, operator_id: string): Promise<string> {
  const { data, error } = await db
    .from('drivers')
    .select('id')
    .eq('operator_id', operator_id)
    .eq('full_name', 'DEV Test Driver')
    .single();

  if (error || !data) {
    // Fallback: compute UUID client-side using md5 logic
    const hash = crypto
      .createHash('md5')
      .update(`DEV_DRIVER_${operator_id}`)
      .digest('hex');
    // Format as UUID: 8-4-4-4-12
    return [
      hash.slice(0, 8),
      hash.slice(8, 12),
      hash.slice(12, 16),
      hash.slice(16, 20),
      hash.slice(20, 32),
    ].join('-');
  }
  return (data as { id: string }).id;
}

// ── Snapshot query ────────────────────────────────────────────────────────────

export async function getTestOrderSnapshot(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
): Promise<TestOrderSnapshot> {
  // Fetch the order (verify it is a test order)
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .eq('operator_id', operator_id)
    .single();

  if (orderErr || !order) {
    throw new Error(`Order not found: ${order_id}`);
  }

  const orderRow = order as Record<string, unknown>;
  if (
    typeof orderRow.external_id !== 'string' ||
    !orderRow.external_id.startsWith('TEST-')
  ) {
    throw new Error(`Order ${order_id} is not a test order`);
  }

  // Fetch latest assignment
  const { data: assignment } = await db
    .from('assignments')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch latest dispatch
  const { data: dispatch } = await db
    .from('dispatches')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Fetch active session
  const { data: session } = await db
    .from('customer_sessions')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .maybeSingle();

  // Fetch session messages
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

  // Fetch reschedules
  const { data: reschedules } = await db
    .from('order_reschedules')
    .select('*')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  // Fetch recent agent events
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

// ── POST /dev/test-orders ─────────────────────────────────────────────────────

export async function createTestOrder(
  db: SupabaseClient,
  operator_id: string,
  input: CreateTestOrderInput,
): Promise<{ order_id: string; snapshot: TestOrderSnapshot }> {
  const uuid = crypto.randomUUID();
  const external_id = `TEST-${uuid}`;
  const order_number = `TEST-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  // Fetch dev driver (bypasses deleted_at filter)
  const driver_id = await getDevDriverId(db, operator_id);

  // Insert order
  const { data: orderData, error: orderErr } = await db
    .from('orders')
    .insert({
      external_id,
      order_number,
      customer_name: input.customer_name,
      customer_phone: input.customer_phone,
      delivery_address: 'DEV Test Address 123',
      comuna: 'Santiago',
      delivery_date: input.delivery_date,
      delivery_window_start: input.delivery_window_start ?? null,
      delivery_window_end: input.delivery_window_end ?? null,
      retailer_name: 'DEV Test Retailer',
      raw_data: {},
      imported_via: 'manual',
      imported_at: new Date().toISOString(),
      status: 'confirmed',
      operator_id,
    })
    .select()
    .single();

  if (orderErr || !orderData) {
    throw new Error(orderErr?.message ?? 'Failed to create order');
  }

  const order = orderData as Record<string, unknown>;
  const order_id = order.id as string;

  // Insert assignment — roll back order on failure
  const { data: assignData, error: assignErr } = await db
    .from('assignments')
    .insert({
      order_id,
      operator_id,
      driver_id,
      status: 'pending',
    })
    .select()
    .single();

  if (assignErr || !assignData) {
    // Soft-delete the order we just created
    await db
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', order_id)
      .eq('operator_id', operator_id);
    throw new Error(assignErr?.message ?? 'Failed to create assignment');
  }

  // Insert dispatch — roll back order + assignment on failure
  const { data: dispatchData, error: dispatchErr } = await db
    .from('dispatches')
    .insert({
      order_id,
      operator_id,
      provider: 'dispatchtrack',
      status: 'pending',
      raw_data: {},
    })
    .select()
    .single();

  if (dispatchErr || !dispatchData) {
    const assign = assignData as Record<string, unknown>;
    await db
      .from('assignments')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', assign.id as string)
      .eq('operator_id', operator_id);
    await db
      .from('orders')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', order_id)
      .eq('operator_id', operator_id);
    throw new Error(dispatchErr?.message ?? 'Failed to create dispatch');
  }

  const snapshot = await getTestOrderSnapshot(db, operator_id, order_id);
  return { order_id, snapshot };
}

// ── GET /dev/test-orders ──────────────────────────────────────────────────────

export async function listTestOrders(
  db: SupabaseClient,
  operator_id: string,
): Promise<{ orders: unknown[] }> {
  const { data, error } = await db
    .from('orders')
    .select('id, customer_name, customer_phone, delivery_date, status, created_at')
    .eq('operator_id', operator_id)
    .is('deleted_at', null);

  if (error) {
    throw new Error((error as { message: string }).message);
  }

  return { orders: data ?? [] };
}

// ── POST /dev/test-orders/purge ───────────────────────────────────────────────

export async function purgeTestOrders(
  db: SupabaseClient,
  operator_id: string,
): Promise<{ deleted_count: number }> {
  // 1. Get all test order IDs
  const { data: orders, error: ordersErr } = await db
    .from('orders')
    .select('id, customer_name, customer_phone, delivery_date, status, created_at')
    .eq('operator_id', operator_id)
    .is('deleted_at', null);

  if (ordersErr) throw new Error(ordersErr.message);

  const rows = (orders ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { deleted_count: 0 };

  const orderIds = rows.map((r) => r.id as string);
  const now = new Date().toISOString();

  // Helper: soft-delete rows in a related table by order_id IN (ids)
  async function softDeleteByOrderIds(table: string): Promise<void> {
    for (const oid of orderIds) {
      await db
        .from(table)
        .update({ deleted_at: now })
        .eq('order_id', oid)
        .eq('operator_id', operator_id);
    }
  }

  // Fetch active session IDs to cascade to messages
  const sessionIds: string[] = [];
  for (const oid of orderIds) {
    const { data: sessions } = await db
      .from('customer_sessions')
      .select('id')
      .eq('order_id', oid)
      .eq('operator_id', operator_id)
      .is('deleted_at', null);
    if (sessions) {
      for (const s of sessions as Array<Record<string, unknown>>) {
        sessionIds.push(s.id as string);
      }
    }
  }

  // Soft-delete messages for those sessions
  for (const sid of sessionIds) {
    await db
      .from('customer_session_messages')
      .update({ deleted_at: now })
      .eq('session_id', sid)
      .eq('operator_id', operator_id);
  }

  // Soft-delete related tables bottom-up
  await softDeleteByOrderIds('customer_sessions');
  await softDeleteByOrderIds('order_reschedules');
  await softDeleteByOrderIds('wismo_notifications');
  await softDeleteByOrderIds('assignments');
  await softDeleteByOrderIds('dispatches');

  // Finally soft-delete the orders themselves
  for (const oid of orderIds) {
    await db
      .from('orders')
      .update({ deleted_at: now })
      .eq('id', oid)
      .eq('operator_id', operator_id);
  }

  return { deleted_count: orderIds.length };
}
