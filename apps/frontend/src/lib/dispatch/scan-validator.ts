import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import type { ScanResult, RoutePackage } from './types';

interface ScanInput {
  code: string;
  routeId: string;
  operatorId: string;
}

/**
 * Package states a Despacho scan may load onto a route.
 *
 * `sectorizado` is the one that matters in practice: the only writer of
 * packages.dock_zone_id is trg_dock_scan_advance_package_status (latest def
 * 20260506000001), and the same UPDATE that stages a package on an andén sets
 * status = 'sectorizado'. That is the state every package is in when it reaches
 * Despacho, yet this validator required 'asignado' and nothing in the product
 * writes that any more — so every scan of a correctly sorted package was
 * refused. Migration 20260817000003 made exactly this correction to the
 * Pre-Ruta cohort; this is the same cohort, one screen later.
 *
 * `retenido` is deliberately excluded, for the same reason it is excluded
 * there: it marks a package parked in a consolidation andén, which has to be
 * re-sorted onto a real andén before it can go on a route. It gets its own
 * message rather than the generic one.
 */
export const DISPATCHABLE_STATUSES = [
  'en_bodega',
  'sectorizado',
  'asignado',
  'listo_para_despacho',
] as const;

const ORDER_EMBED = 'orders(order_number, customer_name, delivery_address, customer_phone)';

interface OrderRow {
  order_number: string | null;
  customer_name: string | null;
  delivery_address: string | null;
  customer_phone: string | null;
}

interface PackageRow {
  id: string;
  status: string;
  order_id: string;
  orders: OrderRow | OrderRow[] | null;
}

/**
 * Validates one Despacho scan.
 *
 * Takes the client rather than building one: this runs inside the
 * /api/dispatch/routes/[id]/scan route handler, and it used to call
 * createSPAClient() — the *browser* client, which on the server carries no
 * session at all. Every query went out as `anon` and came back
 * "42501 permission denied for table packages" under RLS, which the caller
 * then reported as "Código no encontrado". The handler's authenticated SSR
 * client is passed in instead.
 */
export async function validateScan(
  supabase: SupabaseClient<Database>,
  input: ScanInput,
): Promise<ScanResult> {
  const { code, operatorId } = input;

  // 1. Lookup by package label. `packages.barcode` does not exist — the column
  //    is `label` (UNIQUE per operator), which is what the reception scanner
  //    matches on too.
  const { data: pkgs, error: pkgError } = await supabase
    .from('packages')
    .select(`id, status, order_id, ${ORDER_EMBED}`)
    .eq('operator_id', operatorId)
    .eq('label', code)
    .is('deleted_at', null)
    .limit(1);

  // A failed query is not an absent package. Reporting it as NOT_FOUND is what
  // hid three separate broken queries behind "Código no encontrado".
  if (pkgError) return queryFailed(pkgError.message);

  let found = (pkgs?.[0] ?? null) as PackageRow | null;

  // 2. Fallback: the code is an order number rather than a package label.
  if (!found) {
    const { data: byOrder, error: orderError } = await supabase
      .from('packages')
      .select(`id, status, order_id, orders!inner(order_number, customer_name, delivery_address, customer_phone)`)
      .eq('operator_id', operatorId)
      .eq('orders.order_number', code)
      .is('deleted_at', null)
      .limit(1);

    if (orderError) return queryFailed(orderError.message);
    found = (byOrder?.[0] ?? null) as PackageRow | null;
  }

  if (!found) {
    return { ok: false, message: 'Código no encontrado', code: 'NOT_FOUND' };
  }

  // 3. Validate status.
  if (found.status === 'retenido') {
    return {
      ok: false,
      message: 'Paquete en andén de consolidación: reasígnalo a un andén de reparto antes de cargarlo',
      code: 'IN_CONSOLIDATION',
    };
  }

  if (!(DISPATCHABLE_STATUSES as readonly string[]).includes(found.status)) {
    return {
      ok: false,
      message: `Paquete en estado incorrecto (estado: ${found.status})`,
      code: 'WRONG_STATUS',
    };
  }

  // 4. Check not already dispatched in another active route.
  const { data: existing, error: existingError } = await supabase
    .from('dispatches')
    .select('id, route_id')
    .eq('operator_id', operatorId)
    .eq('order_id', found.order_id)
    .is('deleted_at', null)
    .limit(1);

  if (existingError) return queryFailed(existingError.message);

  if (existing && existing.length > 0) {
    return {
      ok: false,
      message: 'Paquete ya asignado a otra ruta activa',
      code: 'ALREADY_IN_ROUTE',
    };
  }

  const order = Array.isArray(found.orders) ? found.orders[0] : found.orders;

  // The DTO keeps DispatchTrack's contact_* naming; the orders table calls the
  // same three fields customer_name / delivery_address / customer_phone.
  const pkg: RoutePackage = {
    dispatch_id: '',              // filled after insert
    order_id: found.order_id,
    order_number: order?.order_number ?? code,
    contact_name: order?.customer_name ?? null,
    contact_address: order?.delivery_address ?? null,
    contact_phone: order?.customer_phone ?? null,
    package_status: 'en_carga',
  };

  return { ok: true, package: pkg };
}

function queryFailed(message: string): ScanResult {
  return {
    ok: false,
    message: `No se pudo validar el código: ${message}`,
    code: 'QUERY_FAILED',
  };
}
