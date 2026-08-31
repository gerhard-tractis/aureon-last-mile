// apps/frontend/src/lib/dispatch/types.ts

// spec-70 phase 1 extended route_status_enum. `in_progress` is retained rather
// than renamed: the DispatchTrack webhooks still write it, and `in_transit` is
// the new machine's name for the same thing.
export type RouteStatus =
  | 'draft' | 'planned' | 'loading' | 'loaded'
  | 'dispatched' | 'in_transit' | 'in_progress'
  | 'completed' | 'cancelled';

/**
 * Route states in which a route still owns its orders, so an order sitting on
 * one may not be loaded onto a different route. `completed` and `cancelled` are
 * absent on purpose — that is what lets a failed delivery come back through
 * `retorno_hub` and be routed again (spec-43).
 */
export const ACTIVE_ROUTE_STATUSES = [
  'draft', 'planned', 'loading', 'loaded', 'dispatched', 'in_transit', 'in_progress',
] as const satisfies readonly RouteStatus[];

// spec-70. The local plan/load axis on `dispatches`, distinct from `status`,
// which belongs to the routing provider.
export type DispatchStage = 'planned' | 'staged' | 'adopted';

/**
 * How the Despacho tabs partition the lifecycle.
 *
 * These three groups must stay disjoint and must cover every RouteStatus, or a
 * route falls into no tab and becomes invisible. That is not hypothetical:
 * spec-70 phase 1 remapped live DispatchTrack routes from `planned` to
 * `dispatched` while the tabs still asked for `['draft','planned']` and
 * `['in_progress']`, and every dispatched route vanished from the screen.
 * `route-status-groups.test.ts` asserts the partition.
 */
export const OPEN_ROUTE_STATUSES = [
  'draft', 'planned', 'loading', 'loaded',
] as const satisfies readonly RouteStatus[];

export const ON_ROAD_ROUTE_STATUSES = [
  'dispatched', 'in_transit', 'in_progress',
] as const satisfies readonly RouteStatus[];

export const FINISHED_ROUTE_STATUSES = [
  'completed', 'cancelled',
] as const satisfies readonly RouteStatus[];

/**
 * Route states in which a stop may still be staged onto the route — the same
 * set `scan/route.ts`'s `LOADING_WALK` and `seal/route.ts`'s `SEALABLE_FROM`
 * key off, kept here once so RouteBuilder's "can I still scan / can I seal"
 * checks cannot drift from what the API actually accepts. `loaded` and beyond
 * are absent on purpose: once sealed, a stop appearing out of nowhere is an
 * exception (adoption), not a silent append.
 */
export const LOADABLE_ROUTE_STATUSES = [
  'draft', 'planned', 'loading',
] as const satisfies readonly RouteStatus[];

export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo_para_despacho' | 'en_ruta' | 'entregado' | 'cancelado';

export interface DispatchRoute {
  id: string;
  operator_id: string;
  external_route_id: string | null;
  route_date: string;           // ISO date YYYY-MM-DD
  driver_name: string | null;
  vehicle_id: string | null;
  truck_identifier: string | null;
  status: RouteStatus;
  planned_stops: number;
  completed_stops: number;
  created_at: string;
}

export interface RoutePackage {
  dispatch_id: string;          // dispatches.id
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  /**
   * spec-70 phase 4. dispatches.status (dispatch_status_enum:
   * pending/delivered/failed/partial) — the provider's delivery outcome, not
   * a package status. Fixes the spec-38/spec-70-#8 type lie: this used to be
   * called `package_status` and be typed `PackageStatus`, so a row holding
   * e.g. `'partial'` (not a `PackageStatus` value at all) was carried under a
   * type that claimed it couldn't be that. The rows this hook returns are
   * orders planned or staged onto the route, not packages — see
   * `useRoutePackages.ts` and `PackageRow.tsx`.
   */
  status: DispatchStatus;
  /**
   * spec-70 phase 3. dispatches.stage — lets RouteBuilder tell "on the plan"
   * from "physically staged" and show the live pending count (decision 4).
   */
  stage: DispatchStage;
}

export interface FleetVehicle {
  id: string;
  external_vehicle_id: string;
  plate_number: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
}

/**
 * What the scan handler must do to record this stop, decided by the validator
 * because only it has looked at the plan.
 *
 * `stage` updates the row Pre-ruta already created. `adopt` inserts a new one:
 * the package is physically present but was never planned onto this route, and
 * refusing it would send operators back to paper while silently treating it as
 * planned would erase the fact that the plan was wrong.
 *
 * spec-74 phase 2 review item 3. `currentStage` carries the dispatch row's
 * `stage` AS IT STOOD when this scan was validated — not what the write
 * should set it to. `stageDispatch` needs it to decide that: without it, a
 * sibling bulto scanned after the order was `adopted` (never planned onto
 * this route at all) silently rewrote the row to `staged`, erasing the
 * "never planned" fact `adopted_reason` exists to preserve. Only `planned`
 * becomes `staged` this phase; `adopted` must stay `adopted`.
 */
export type ScanAction =
  | { kind: 'stage'; dispatchId: string; currentStage: DispatchStage }
  | { kind: 'adopt' };

export type ScanResult = {
  ok: true;
  // spec-38/spec-70: the validator hasn't staged or written the DB yet, so it
  // cannot honestly claim `stage` or `status` — the scan handler knows both
  // only after it decides stage vs adopt and performs the write, and adds
  // them itself. Omit rather than a fabricated placeholder value.
  package: Omit<RoutePackage, 'stage' | 'status'>;
  /**
   * spec-71 phase 3. `packages.id` — deliberately absent from `package`
   * above (that DTO is keyed by `dispatch_id`/`order_id` for the route-scan
   * response), but the position-scan path needs the actual package row to
   * write `dock_scans.package_id` (the per-package staging audit trail).
   */
  packageId: string;
  action: ScanAction;
} | {
  ok: false;
  message: string;
  code:
    | 'NOT_FOUND' | 'WRONG_STATUS' | 'ALREADY_IN_ROUTE'
    | 'ALREADY_STAGED' | 'IN_CONSOLIDATION' | 'QUERY_FAILED';
}

// dispatches.status comes from dispatch_status_enum (DB-level). Keep these values verbatim.
export type DispatchStatus = 'pending' | 'delivered' | 'failed' | 'partial';

export interface RouteDispatchSummary {
  dispatch_id: string;
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  status: DispatchStatus;
}

/**
 * What `POST /routes/[id]/scan` actually returns.
 *
 * Not `RoutePackage`: the endpoint's `package_status` field is genuinely
 * `packages.status` (a real `PackageStatus`, written by the update the scan
 * handler just performed) — a different fact from `RoutePackage.status`
 * (`dispatches.status`, the DispatchTrack outcome). Reusing `RoutePackage`
 * here would recreate the exact type lie phase 4 removed, just moved one
 * field over.
 */
export interface ScanApiResponse {
  dispatch_id: string;
  order_id: string;
  order_number: string;
  contact_name: string | null;
  contact_address: string | null;
  contact_phone: string | null;
  stage: DispatchStage;
  package_status: PackageStatus;
}
