// src/dev/state-editor.ts — Dev endpoint handler for test order state editing
import type { SupabaseClient } from '@supabase/supabase-js';
import { getTestOrderSnapshot, type TestOrderSnapshot } from './test-orders';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EditableTable = 'orders' | 'assignments' | 'dispatches' | 'reset_session';

export interface StateEditInput {
  table: EditableTable;
  fields: Record<string, unknown>;
}

export interface StateEditResult {
  snapshot: TestOrderSnapshot;
}

// ── Allowed fields per table ──────────────────────────────────────────────────

const ALLOWED_ORDER_FIELDS = new Set([
  'delivery_date',
  'delivery_window_start',
  'delivery_window_end',
  'customer_phone',
  'customer_name',
]);

const ALLOWED_ASSIGNMENT_FIELDS = new Set(['status']);

const ALLOWED_DISPATCH_FIELDS = new Set(['estimated_at', 'status']);

// ── Safety check ──────────────────────────────────────────────────────────────

async function verifyTestOrder(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from('orders')
    .select('id, order_number, operator_id')
    .eq('id', order_id)
    .eq('operator_id', operator_id)
    .single();

  if (error || !data) {
    throw new Error(`Order not found: ${order_id}`);
  }

  const order = data as Record<string, unknown>;
  if (
    typeof order.order_number !== 'string' ||
    !order.order_number.startsWith('TEST-')
  ) {
    throw new Error(`Order ${order_id} is not a test order`);
  }

  return order;
}

// ── Table-specific update handlers ────────────────────────────────────────────

async function updateOrderFields(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_ORDER_FIELDS.has(key)) {
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  if (rejected.length > 0) {
    throw new Error(`Fields not allowed on orders: ${rejected.join(', ')}`);
  }

  if (Object.keys(allowed).length === 0) {
    throw new Error('No valid fields to update on orders');
  }

  const { error } = await db
    .from('orders')
    .update(allowed)
    .eq('id', order_id)
    .eq('operator_id', operator_id);

  if (error) throw new Error(error.message);
}

async function updateAssignmentFields(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_ASSIGNMENT_FIELDS.has(key)) {
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  if (rejected.length > 0) {
    throw new Error(`Fields not allowed on assignments: ${rejected.join(', ')}`);
  }

  if (Object.keys(allowed).length === 0) {
    throw new Error('No valid fields to update on assignments');
  }

  // Fetch latest assignment
  const { data: assignment, error: fetchErr } = await db
    .from('assignments')
    .select('id')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (!assignment) throw new Error(`No active assignment found for order ${order_id}`);

  const a = assignment as Record<string, unknown>;
  const { error } = await db
    .from('assignments')
    .update(allowed)
    .eq('id', a.id as string)
    .eq('operator_id', operator_id);

  if (error) throw new Error(error.message);
}

async function updateDispatchFields(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const allowed: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (ALLOWED_DISPATCH_FIELDS.has(key)) {
      allowed[key] = value;
    } else {
      rejected.push(key);
    }
  }

  if (rejected.length > 0) {
    throw new Error(`Fields not allowed on dispatches: ${rejected.join(', ')}`);
  }

  if (Object.keys(allowed).length === 0) {
    throw new Error('No valid fields to update on dispatches');
  }

  // Fetch latest dispatch
  const { data: dispatch, error: fetchErr } = await db
    .from('dispatches')
    .select('id')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchErr) throw new Error(fetchErr.message);
  if (!dispatch) throw new Error(`No active dispatch found for order ${order_id}`);

  const d = dispatch as Record<string, unknown>;
  const { error } = await db
    .from('dispatches')
    .update(allowed)
    .eq('id', d.id as string)
    .eq('operator_id', operator_id);

  if (error) throw new Error(error.message);
}

async function resetSession(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Find active session
  const { data: session } = await db
    .from('customer_sessions')
    .select('id')
    .eq('order_id', order_id)
    .eq('operator_id', operator_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) return; // No active session — nothing to reset

  const s = session as Record<string, unknown>;
  const session_id = s.id as string;

  // Soft-delete all messages for this session
  await db
    .from('customer_session_messages')
    .update({ deleted_at: now })
    .eq('session_id', session_id)
    .eq('operator_id', operator_id);

  // Soft-delete the session
  await db
    .from('customer_sessions')
    .update({ deleted_at: now })
    .eq('id', session_id)
    .eq('operator_id', operator_id);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function editTestOrderState(
  db: SupabaseClient,
  operator_id: string,
  order_id: string,
  input: StateEditInput,
): Promise<StateEditResult> {
  // Safety: verify test order before any mutation
  await verifyTestOrder(db, operator_id, order_id);

  switch (input.table) {
    case 'orders':
      await updateOrderFields(db, operator_id, order_id, input.fields);
      break;
    case 'assignments':
      await updateAssignmentFields(db, operator_id, order_id, input.fields);
      break;
    case 'dispatches':
      await updateDispatchFields(db, operator_id, order_id, input.fields);
      break;
    case 'reset_session':
      await resetSession(db, operator_id, order_id);
      break;
    default: {
      const _exhaustive: never = input.table;
      throw new Error(`Unknown table: ${String(_exhaustive)}`);
    }
  }

  const snapshot = await getTestOrderSnapshot(db, operator_id, order_id);
  return { snapshot };
}
