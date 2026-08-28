import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { findExpectedLoadPosition, type ExpectedLoadPosition } from './expected-load-position';

/**
 * spec-71 phase 3 — stage mode's package-scan lookup, split out of
 * `useQuickSortFlow` (which was already at the project's 300-line file
 * ceiling before this phase) the same way `determineDockZone` and
 * `validateDockDestination` are already split out of it for the sectorize
 * path. Combines the package lookup (identical query to the sectorize
 * path's) with `findExpectedLoadPosition` so the hook's handler is just
 * "call this, set state".
 */

export interface StagePackageInfo {
  id: string;
  label: string;
  orderNumber: string;
  comunaName: string | null;
}

export type StagePackageScanResult =
  | { ok: true; pkg: StagePackageInfo; position: ExpectedLoadPosition }
  | { ok: false; reason: 'NOT_FOUND' | 'QUERY_FAILED' | 'NO_POSITION_ASSIGNED'; message: string };

export async function lookupStagePackageScan(
  supabase: SupabaseClient<Database>,
  input: { operatorId: string; barcode: string },
): Promise<StagePackageScanResult> {
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
    orders: { order_number: string; chile_comunas: { nombre: string } | null };
  };

  const expected = await findExpectedLoadPosition(supabase, { operatorId: input.operatorId, orderId: pkg.order_id });
  if (!expected.ok) {
    return { ok: false, reason: expected.code, message: expected.message };
  }

  return {
    ok: true,
    pkg: {
      id: pkg.id,
      label: pkg.label,
      orderNumber: pkg.orders.order_number,
      comunaName: pkg.orders.chile_comunas?.nombre ?? null,
    },
    position: expected.position,
  };
}

/**
 * Submits a confirmed position scan to the staging endpoint. The client-side
 * match (`scanCodesMatch` in the hook) already gated this call; the server
 * (`validatePositionScan`) is the write authority and re-validates fully.
 */
export async function submitPositionStageScan(input: {
  packageCode: string;
  positionCode: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/dispatch/load-positions/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: null }));
      return { ok: false, message: body?.message ?? 'No se pudo confirmar la posición — intente de nuevo' };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: 'Error de red — intente de nuevo' };
  }
}
