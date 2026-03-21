// src/tools/supabase/packages.ts — Package CRUD tool
import type { SupabaseClient } from '@supabase/supabase-js';

export interface PackageInsert {
  operator_id: string;
  order_id: string;
  description: string;
  weight_kg?: number | null;
  volume_m3?: number | null;
  barcode?: string | null;
}

export interface PackageRow {
  id: string;
  [key: string]: unknown;
}

export async function upsertPackage(db: SupabaseClient, pkg: PackageInsert): Promise<PackageRow> {
  const { data, error } = await db
    .from('packages')
    .upsert({ ...pkg })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PackageRow;
}
