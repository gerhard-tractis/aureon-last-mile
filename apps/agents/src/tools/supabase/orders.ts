// src/tools/supabase/orders.ts — Order CRUD tool
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrderInsert {
  operator_id: string;
  intake_submission_id: string;
  customer_name: string;
  delivery_address: string;
  customer_id?: string;
  generator_id?: string;
  phone?: string | null;
  notes?: string | null;
  priority?: number;
  agent_metadata?: Record<string, unknown>;
}

export interface OrderRow {
  id: string;
  [key: string]: unknown;
}

export async function upsertOrder(db: SupabaseClient, order: OrderInsert): Promise<OrderRow> {
  const { data, error } = await db
    .from('orders')
    .upsert({ ...order, status: 'pending' })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as OrderRow;
}

export async function updateOrderStatus(
  db: SupabaseClient,
  orderId: string,
  operatorId: string,
  status: string,
): Promise<void> {
  const { error } = await db
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('operator_id', operatorId)
    .select()
    .single();

  if (error) throw new Error(error.message);
}
