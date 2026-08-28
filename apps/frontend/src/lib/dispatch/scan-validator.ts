import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types';
import { ACTIVE_ROUTE_STATUSES, type ScanResult, type RoutePackage, type ScanAction, type DispatchStage } from './types';

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

interface DispatchRow {
  id: string;
  route_id: string | null;
  stage: DispatchStage;
  route: { status: string } | { status: string }[] | null;
}

const ACTIVE = new Set<string>(ACTIVE_ROUTE_STATUSES);

/**
 * Whether a dispatch row still owns its order, so the order may not be loaded
 * onto a different route.
 *
 * A row with no route_id owns nothing. A row on a completed or cancelled route
 * is history — that is what lets a package returned through `retorno_hub`
 * (spec-43) go out again. Anything else blocks, *including a row whose route
 * cannot be resolved*: guessing permissively there would re-open
 * double-routing, and a package on two trucks is a lost package.
 */
function ownsTheOrder(row: DispatchRow): boolean {
  if (row.route_id == null) return false;
  const route = Array.isArray(row.route) ? row.route[0] : row.route;
  if (!route?.status) return true;
  return ACTIVE.has(route.status);
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

  // 4. Decide what this scan does to the plan.
  //
  //    This used to ask "does a dispatch row exist for this order?" and refuse
  //    if one did — without filtering by route_id. Pre-ruta's
  //    create_seeded_route creates exactly such a row when it seeds a route, so
  //    every scan of a correctly pre-routed package was refused with
  //    "Paquete ya asignado a otra ruta activa". The plan made the load
  //    impossible, which is the defect spec-70 exists to fix.
  const { data: rows, error: rowsError } = await supabase
    .from('dispatches')
    .select('id, route_id, stage, route:routes!dispatches_route_id_fkey(status)')
    .eq('operator_id', operatorId)
    .eq('order_id', found.order_id)
    .is('deleted_at', null)
    .limit(50);

  if (rowsError) return queryFailed(rowsError.message);

  const dispatches = (rows ?? []) as DispatchRow[];
  const onThisRoute = dispatches.find((d) => d.route_id === input.routeId);

  let action: ScanAction;

  if (onThisRoute) {
    if (onThisRoute.stage !== 'planned') {
      return {
        ok: false,
        message: 'Paquete ya cargado en esta ruta',
        code: 'ALREADY_STAGED',
      };
    }
    action = { kind: 'stage', dispatchId: onThisRoute.id };
  } else if (dispatches.some(ownsTheOrder)) {
    return {
      ok: false,
      message: 'Paquete ya asignado a otra ruta activa',
      code: 'ALREADY_IN_ROUTE',
    };
  } else {
    action = { kind: 'adopt' };
  }

  const order = Array.isArray(found.orders) ? found.orders[0] : found.orders;

  // The DTO keeps DispatchTrack's contact_* naming; the orders table calls the
  // same three fields customer_name / delivery_address / customer_phone.
  const pkg: Omit<RoutePackage, 'stage' | 'status'> = {
    dispatch_id: '',              // filled after insert
    order_id: found.order_id,
    order_number: order?.order_number ?? code,
    contact_name: order?.customer_name ?? null,
    contact_address: order?.delivery_address ?? null,
    contact_phone: order?.customer_phone ?? null,
  };

  // `stage` and `status` are genuinely unknown here: the scan handler hasn't
  // decided stage vs adopt or written the DB yet. A fabricated value on this
  // DTO is the spec-38 type lie in miniature — the type now refuses to let
  // one back in (ScanResult.package Omits both), and the handler adds the
  // real values once it knows them.
  return { ok: true, package: pkg, packageId: found.id, action };
}

function queryFailed(message: string): ScanResult {
  return {
    ok: false,
    message: `No se pudo validar el código: ${message}`,
    code: 'QUERY_FAILED',
  };
}
