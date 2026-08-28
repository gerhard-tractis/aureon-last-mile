import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { determineDockZone, type DockZone, type ZoneMatchResult } from './sectorization-engine';

/**
 * spec-71 phase 3 review item 6 — split out of `useQuickSortFlow`
 * (`handleSectorizePackageScan`), the same way `lookupStagePackageScan`
 * (`lib/dispatch/stage-package-scan.ts`) already splits the stage path's
 * package lookup out of its own handler. Mirrors that split's shape:
 * everything here is pure data access (package lookup, the zone match,
 * the best-effort sibling count), leaving the hook's handler as only the
 * state transition plus the one step that cannot move — `createBatch`,
 * a React Query mutation bound to the hook.
 */

export interface SectorizePackageInfo {
  id: string;
  label: string;
  orderId: string;
  orderNumber: string;
  comunaName: string | null;
}

export type SectorizePackageScanResult =
  | { ok: true; pkg: SectorizePackageInfo; matchResult: ZoneMatchResult; siblingCount: number }
  | { ok: false; reason: 'NOT_FOUND' | 'QUERY_FAILED'; message: string };

export async function lookupSectorizePackageScan(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; barcode: string; zones: DockZone[]; today: string },
): Promise<SectorizePackageScanResult> {
  const { data, error: dbError } = await supabase
    .from('packages')
    .select(
      'id, label, status, order_id, orders!inner(order_number, comuna_id, delivery_date, chile_comunas(nombre))',
    )
    .eq('operator_id', input.operatorId)
    .eq('label', input.barcode)
    .is('deleted_at', null)
    .limit(1);

  if (dbError) {
    return { ok: false, reason: 'QUERY_FAILED', message: 'Error de red — intente de nuevo' };
  }

  if (!data || data.length === 0) {
    return { ok: false, reason: 'NOT_FOUND', message: 'Código no encontrado' };
  }

  const pkg = data[0] as {
    id: string;
    label: string;
    order_id: string;
    orders: {
      order_number: string;
      comuna_id: string | null;
      delivery_date: string;
      chile_comunas: { nombre: string } | null;
    };
  };
  const order = pkg.orders;

  const matchResult = determineDockZone(
    { comunaId: order.comuna_id, delivery_date: order.delivery_date },
    input.zones,
    input.today,
  );

  // Fase 5.3 — "Falta N paquete(s) de esta orden". Siblings still
  // `en_bodega`, scoped to this operator/order. Own try/catch:
  // informational only, must not fail the whole lookup the operator
  // otherwise already earned a destination for.
  let siblingCount = 0;
  try {
    const { count } = await supabase
      .from('packages')
      .select('id', { count: 'exact', head: true })
      .eq('operator_id', input.operatorId)
      .eq('order_id', pkg.order_id)
      .eq('status', 'en_bodega')
      .neq('id', pkg.id)
      .is('deleted_at', null);
    siblingCount = count ?? 0;
  } catch {
    // best-effort; the incomplete-order notice just won't show this time
  }

  return {
    ok: true,
    pkg: {
      id: pkg.id,
      label: pkg.label,
      orderId: pkg.order_id,
      orderNumber: order.order_number,
      comunaName: order.chile_comunas?.nombre ?? null,
    },
    matchResult,
    siblingCount,
  };
}
