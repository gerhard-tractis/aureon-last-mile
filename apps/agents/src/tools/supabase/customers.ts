// src/tools/supabase/customers.ts — Customer lookup tool (multi-tenant)
import type { SupabaseClient } from '@supabase/supabase-js';

export interface Customer {
  id: string;
  name: string;
  rut: string | null;
  phone: string | null;
}

export async function getCustomersByOperator(
  db: SupabaseClient,
  operatorId: string,
): Promise<Customer[]> {
  const { data, error } = await db
    .from('tenant_clients')
    .select('id, name, rut, phone')
    .eq('operator_id', operatorId)
    .is('deleted_at', null);

  if (error) throw new Error(error.message);
  return (data ?? []) as Customer[];
}
