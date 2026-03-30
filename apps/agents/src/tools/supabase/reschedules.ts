// src/tools/supabase/reschedules.ts — Insert reschedule + update denormalised order fields
import type { SupabaseClient } from '@supabase/supabase-js';

export type RescheduleReason =
  | 'not_home'
  | 'time_preference'
  | 'address_change'
  | 'early_delivery'
  | 'other';

export interface InsertRescheduleParams {
  operator_id: string;
  order_id: string;
  reason: RescheduleReason;
  customer_note?: string;
  requested_date?: string;        // ISO date string YYYY-MM-DD
  requested_window_start?: string; // HH:mm
  requested_window_end?: string;   // HH:mm
  requested_address?: string;
  session_message_id?: string;
}

export interface OrderReschedule {
  id: string;
  operator_id: string;
  order_id: string;
  reason: string;
  status: string;
  requested_date: string | null;
  requested_window_start: string | null;
  requested_window_end: string | null;
  requested_address: string | null;
  customer_note: string | null;
  session_message_id: string | null;
  created_at: string;
}

export async function insertReschedule(
  db: SupabaseClient,
  params: InsertRescheduleParams,
): Promise<OrderReschedule> {
  const { data, error } = await db
    .from('order_reschedules')
    .insert({
      operator_id: params.operator_id,
      order_id: params.order_id,
      reason: params.reason,
      customer_note: params.customer_note ?? null,
      requested_date: params.requested_date ?? null,
      requested_window_start: params.requested_window_start ?? null,
      requested_window_end: params.requested_window_end ?? null,
      requested_address: params.requested_address ?? null,
      session_message_id: params.session_message_id ?? null,
    })
    .select('*')
    .single();

  if (error) throw new Error(`order_reschedules insert: ${error.message}`);
  // DB trigger (sync_order_reschedule_fields) handles updating orders.rescheduled_* fields
  return data as OrderReschedule;
}

export async function getPendingReschedules(
  db: SupabaseClient,
  operator_id: string,
): Promise<OrderReschedule[]> {
  const { data, error } = await db
    .from('order_reschedules')
    .select('*')
    .eq('operator_id', operator_id)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`order_reschedules list: ${error.message}`);
  return (data ?? []) as OrderReschedule[];
}
