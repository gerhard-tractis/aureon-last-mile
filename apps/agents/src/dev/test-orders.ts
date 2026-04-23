// src/dev/test-orders.ts — Dev endpoint handlers for test order CRUD
import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestOrderSnapshot, type TestOrderSnapshot } from './snapshot';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateTestOrderInput {
  customer_name: string;
  customer_phone: string;
  delivery_date: string;
  delivery_window_start?: string;
  delivery_window_end?: string;
}

export { getTestOrderSnapshot, type TestOrderSnapshot };

// ── Dev driver UUID ───────────────────────────────────────────────────────────

async function getDevDriverId(db: SupabaseClient, operator_id: string): Promise<string> {
  const { data } = await db
    .from('drivers')
    .select('id')
    .eq('operator_id', operator_id)
    .eq('full_name', 'DEV Test Driver')
    .is('deleted_at', null)
    .maybeSingle();

  if (data) return (data as { id: string }).id;

  // Driver not found — upsert it with a deterministic UUID so FK constraints pass
  const hash = crypto.createHash('md5').update(`DEV_DRIVER_${operator_id}`).digest('hex');
  const driver_id = [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join('-');

  await db.from('drivers').upsert({
    id: driver_id,
    operator_id,
    fleet_type: 'own',
    full_name: 'DEV Test Driver',
    phone: '+56900000000',
  }, { onConflict: 'id', ignoreDuplicates: true });

  return driver_id;
}

// ── POST /dev/test-orders ─────────────────────────────────────────────────────

export async function createTestOrder(
  db: SupabaseClient,
  operator_id: string,
  input: CreateTestOrderInput,
): Promise<{ order_id: string; snapshot: TestOrderSnapshot }> {
  const uuid = crypto.randomUUID();
  const order_number = `TEST-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  // Fetch dev driver (bypasses deleted_at filter)
  const driver_id = await getDevDriverId(db, operator_id);

  // Insert order
  const { data: orderData, error: orderErr } = await db
    .from('orders')
    .insert({
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
      imported_via: 'MANUAL',
      imported_at: new Date().toISOString(),
      status: 'ingresado',
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
    .like('order_number', 'TEST-%')
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
  const { data: orders, error: ordersErr } = await db
    .from('orders')
    .select('id, customer_name, customer_phone, delivery_date, status, created_at')
    .eq('operator_id', operator_id)
    .like('order_number', 'TEST-%')
    .is('deleted_at', null);

  if (ordersErr) throw new Error(ordersErr.message);

  const rows = (orders ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { deleted_count: 0 };

  const orderIds = rows.map((r) => r.id as string);
  const now = new Date().toISOString();

  const softDeleteByOrder = async (table: string): Promise<void> => {
    for (const oid of orderIds) {
      await db.from(table).update({ deleted_at: now }).eq('order_id', oid).eq('operator_id', operator_id);
    }
  };

  // Cascade to session messages first
  for (const oid of orderIds) {
    const { data: sessions } = await db
      .from('customer_sessions').select('id').eq('order_id', oid).eq('operator_id', operator_id).is('deleted_at', null);
    for (const s of (sessions ?? []) as Array<Record<string, unknown>>) {
      await db.from('customer_session_messages').update({ deleted_at: now }).eq('session_id', s.id as string).eq('operator_id', operator_id);
    }
  }

  // Bottom-up soft-delete
  await softDeleteByOrder('customer_sessions');
  await softDeleteByOrder('order_reschedules');
  await softDeleteByOrder('wismo_notifications');
  await softDeleteByOrder('assignments');
  await softDeleteByOrder('dispatches');

  for (const oid of orderIds) {
    await db.from('orders').update({ deleted_at: now }).eq('id', oid).eq('operator_id', operator_id);
  }

  return { deleted_count: orderIds.length };
}
