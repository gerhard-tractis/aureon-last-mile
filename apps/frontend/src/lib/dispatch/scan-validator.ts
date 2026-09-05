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
 * `sectorizado` is the state every dock-sorted package is actually in
 * (`trg_dock_scan_advance_package_status`, latest def 20260506000001);
 * `retenido` (consolidation, needs re-sorting first) and `en_bodega` (never
 * sorted to an andén at all — spec-76 task 3, escalated decision: this used
 * to be allowed by mistake) are each excluded with their own message below
 * rather than falling into the generic WRONG_STATUS.
 */
export const DISPATCHABLE_STATUSES = [
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
  // spec-74 phase 2. `packages.loaded_at` — the per-BOX load fact phase 1
  // added. NULL/undefined means this specific package has never been
  // scanned in, regardless of what its order's `dispatches.stage` says
  // (see the ALREADY_STAGED check below — that column stays order-level
  // and over-claims for the rest of this phase).
  loaded_at: string | null;
  // spec-74 phase 2 review item 1. `packages.load_inferred` — true when
  // `loaded_at` was written by phase 1's one-time optimistic backfill
  // (20260901000001) rather than by a real scan. A backfilled row is an
  // ASSUMPTION standing in for missing history, not evidence this box was
  // physically scanned — so it must not gate a re-scan the way a genuine
  // `loaded_at` does (see the ALREADY_STAGED check below).
  load_inferred: boolean;
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
 * onto a different route. `ACTIVE_ROUTE_STATUSES` (`types.ts`) says which
 * route statuses count; a row with no `route_id`, or one whose route cannot
 * be resolved, owns nothing rather than blocking permissively — a package on
 * two trucks is a lost package, so an unresolved route still blocks (see the
 * fallback below).
 *
 * spec-77 phase 1b: a `force_split` row is the one exception ON TOP of that.
 * It is never soft-deleted (part of its order genuinely travelled with that,
 * now-`loaded` route), so without this it would block the RELEASED half
 * forever, even though `get_pre_route_snapshot` already says it is free.
 * This does not settle the LOADED half too — see the per-package check on
 * the `adopt` path below, which is what actually tells the two apart.
 */
function ownsTheOrder(row: DispatchRow): boolean {
  if (row.route_id == null) return false;
  if (row.stage === 'force_split') return false;
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
    .select(`id, status, order_id, loaded_at, load_inferred, ${ORDER_EMBED}`)
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
    // spec-74 phase 2 review item 5. An order number matches every bulto of
    // that order, not just one — `.limit(1)` with no ordering always
    // returned the SAME row, so scanning an order number twice could never
    // reach the second box. Ordered so an unloaded (or, after item 1,
    // inferred-only) row sorts first: `loaded_at` ascending with nulls
    // first puts a never-scanned box ahead of any timestamped one, and in
    // the common case sorts a backfilled/inferred row (an old, one-time
    // `MIN(staged_at)`) ahead of a genuinely-just-scanned one too.
    const { data: byOrder, error: orderError } = await supabase
      .from('packages')
      .select(`id, status, order_id, loaded_at, load_inferred, orders!inner(order_number, customer_name, delivery_address, customer_phone)`)
      .eq('operator_id', operatorId)
      .eq('orders.order_number', code)
      .is('deleted_at', null)
      .order('loaded_at', { ascending: true, nullsFirst: true })
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

  // spec-76 task 3 review, escalated decision. `en_bodega` gets its own
  // reason rather than falling into the generic WRONG_STATUS bucket below —
  // decision 5 names it as a distinct rejection and the crew needs the
  // actual cause ("no pasó por andén"), not a generic "estado incorrecto".
  if (found.status === 'en_bodega') {
    return {
      ok: false,
      message: 'Paquete en bodega — no pasó por andén',
      code: 'NOT_ON_DOCK',
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
    // spec-74 phase 2. This used to be `onThisRoute.stage !== 'planned'`,
    // refusing the SECOND bulto of a multi-bulto order: the first scan
    // flips the order's one `dispatches` row to `staged` (see stage-dispatch.ts),
    // and every remaining, genuinely-unscanned box in the order was then
    // refused as "already loaded" — the double-lock spec-74 exists to
    // remove (spec-74 Decision 5 / "Why it happens" #3 in the spec).
    //
    // The check is now per-PACKAGE: refuse only when THIS box's own
    // `loaded_at` is already set, i.e. it was itself already scanned.
    // `dispatches.stage` staying `staged` after the first bulto is this
    // phase's known, documented over-claim (phase 3 introduces
    // `partially_staged` to fix it) — it must not gate the scan any more.
    //
    // spec-74 phase 2 review item 1. `loaded_at` alone is not enough: phase
    // 1's migration backfilled `loaded_at` onto EVERY live package of every
    // pre-existing `staged`/`adopted` dispatch (flagged `load_inferred`),
    // so gating on `loaded_at` alone re-deadlocked every one of those
    // boxes — including the box that was physically on the andén in the
    // original QA repro. An inferred row is an assumption standing in for
    // missing history, not proof this box was scanned, so it must remain
    // re-scannable. Only a GENUINE scan (`loaded_at` set AND
    // `load_inferred` false) refuses a second one.
    if (found.loaded_at && !found.load_inferred) {
      return {
        ok: false,
        message: 'Paquete ya cargado en esta ruta',
        code: 'ALREADY_STAGED',
      };
    }
    action = { kind: 'stage', dispatchId: onThisRoute.id, currentStage: onThisRoute.stage };
  } else if (dispatches.some(ownsTheOrder)) {
    // spec-76 phase 4 (2f decision 5): "se nombra la ruta y se ofrece
    // verla". The owning row's own route_id, not a second query — the
    // dispatches select above already carries it.
    const conflicting = dispatches.find(ownsTheOrder);
    return {
      ok: false,
      message: 'Paquete ya asignado a otra ruta activa',
      code: 'ALREADY_IN_ROUTE',
      conflictingRouteId: conflicting?.route_id ?? null,
    };
  } else if (found.loaded_at && !found.load_inferred) {
    // spec-77 review (MEDIUM). `ownsTheOrder`'s `force_split` exception
    // (above) frees the RELEASED half of the order, but it cannot tell that
    // box apart from the one that already travelled — only this box's OWN
    // `loaded_at`/`load_inferred` can. Without this, the travelled box would
    // fall into `adopt` on a new route, `advancePackagesToEnCarga` would
    // match nothing, and the caller would 500 with an orphaned dispatch row
    // (pre-force_split this returned a clean ALREADY_IN_ROUTE).
    const forceSplit = dispatches.find((d) => d.stage === 'force_split');
    return {
      ok: false,
      message: 'Paquete ya asignado a otra ruta activa',
      code: 'ALREADY_IN_ROUTE',
      conflictingRouteId: forceSplit?.route_id ?? null,
    };
  } else {
    action = { kind: 'adopt' };
  }

  const order = Array.isArray(found.orders) ? found.orders[0] : found.orders;

  // The DTO keeps DispatchTrack's contact_* naming; the orders table calls the
  // same three fields customer_name / delivery_address / customer_phone.
  //
  // spec-74 phase 4: boxesTotal/boxesLoaded are also genuinely unknown here
  // (this DTO never queried the order's other packages) — omitted for the
  // same reason stage/status are, matching ScanResult.package's own Omit.
  const pkg: Omit<RoutePackage, 'stage' | 'status' | 'boxesTotal' | 'boxesLoaded'> = {
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
