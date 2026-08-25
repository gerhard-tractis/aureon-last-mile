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
  package_status: PackageStatus;
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
 */
export type ScanAction =
  | { kind: 'stage'; dispatchId: string }
  | { kind: 'adopt' };

export type ScanResult = {
  ok: true;
  package: RoutePackage;
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
