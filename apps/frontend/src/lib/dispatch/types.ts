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

// spec-70/74/77. The local plan/load axis on `dispatches`, distinct from
// `status`, which belongs to the routing provider. `partially_staged`
// (spec-74 phase 1 schema, phase 3 writer) sits between `planned` and
// `staged`: some but not all of the order's live packages are physically
// confirmed loaded. `adopted` never becomes `partially_staged` or `staged`
// — it is recomputed for completeness but the stage value itself is
// preserved forever (spec-74 phase 2 review item 3); an incomplete adopted
// order is caught by seal-route.ts reading packages.loaded_at directly, not
// by this column. `force_split` (spec-77 phase 1b) is reached only from
// `partially_staged`, only via `sealRoute`'s force path: the crew closed the
// route short, some of the order's boxes travel and some were released to
// the dock, and the row is never rewritten to `staged`/`planned` again —
// `recompute_dispatch_stage` never runs against it (the route is `loaded`,
// closed to further scans) and `force-seal-split.ts` is the only writer.
export type DispatchStage = 'planned' | 'partially_staged' | 'staged' | 'adopted' | 'force_split';

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
  /**
   * spec-74 phase 4. Count of this order's live (non-deleted) packages —
   * the load unit `dispatches.stage` cannot see (spec-74 Decision 1: the
   * plan unit is the order, the load unit is the box). Lets RouteBuilder
   * and PackageRow tell "1 of 3 bultos loaded" from "0 of 1", instead of
   * treating every order as one stop regardless of how many boxes it has.
   */
  boxesTotal: number;
  /**
   * spec-74 phase 4. Count of this order's live packages with
   * `packages.loaded_at` set — the per-box load fact spec-74 phase 1 added
   * and phases 2-3 now write on every scan (route-level and position-level
   * alike). `boxesTotal - boxesLoaded` is the outstanding-box count.
   */
  boxesLoaded: number;
}

export interface FleetVehicle {
  id: string;
  external_vehicle_id: string;
  plate_number: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  /**
   * spec-73 phase 4c. `fleet_vehicles.capacity_packages` — nullable,
   * manager-typed, no CHECK constraint (spec-73 Decision 2). `null` means
   * "not configured": `lib/dispatch/vehicle-capacity.ts`'s
   * `getVehicleFillStatus` treats it (and 0/negative) as unconfigured and
   * renders no fill bar for this vehicle.
   */
  capacity_packages: number | null;
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
  // spec-74 phase 4: boxesTotal/boxesLoaded are also genuinely unknown at
  // validation time (they describe the order's OTHER packages, which this
  // DTO never queried) — omitted for the same reason stage/status are.
  package: Omit<RoutePackage, 'stage' | 'status' | 'boxesTotal' | 'boxesLoaded'>;
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
    | 'ALREADY_STAGED' | 'IN_CONSOLIDATION' | 'QUERY_FAILED' | 'NOT_ON_DOCK';
  /** spec-76 2f. ALREADY_IN_ROUTE only — the conflicting `routes.id`, so 2f can name and link the route. */
  conflictingRouteId?: string | null;
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

// spec-72 phase 3. route_blocks.sequence_source — provenance, not
// correctness (Decision 2). 'optimizer' is reserved: nothing in this repo
// writes it yet (sidecar/or-tools/ stays unwired, per spec-72's Non-Goals).
export type SequenceSource = 'default' | 'manual' | 'optimizer';

/**
 * One row of the manager review list — one comuna-within-a-route block, in
 * `sequence_index` order, with the order/package counts spec-72 phase 3
 * asks the list to show. Counts are derived by joining this block's
 * `comuna_id` against the route's live dispatches/orders, exactly like
 * `route_blocks` itself has no membership table (spec-72's data-model
 * section, "counts are derived, never incremented").
 */
export interface RouteBlockView {
  id: string;                 // route_blocks.id
  comunaId: string;
  comunaName: string;
  sequenceIndex: number;
  sequenceSource: SequenceSource;
  orderCount: number;
  packageCount: number;
  /**
   * spec-72 phase 5 — this block's 1-based rank among its route's blocks by
   * EARLIEST `dispatches.actual_sequence` (Decision 4's "what happened"),
   * over live, non-orphan dispatches only. `null` means no dispatch in this
   * block has arrived yet (route not completed, or this block simply hasn't
   * been reached) — never a fabricated trailing rank.
   */
  actualRank: number | null;
  /**
   * `true` only when `actualRank` is known AND differs from this block's
   * planned rank — its 1-based position among the blocks that HAVE arrival
   * data, in `sequenceIndex` order. Not `sequenceIndex` itself (not
   * contiguous), and not a position in the full block list (that would count
   * un-arrived blocks `actualRank` never counted). `false` while `actualRank`
   * is `null` — "no data yet" is not "out of sequence".
   */
  outOfSequence: boolean;
}

/**
 * An order that cannot be shown inside any block. Two distinct causes, kept
 * separate because they mean different things operationally:
 *
 * - `noComuna`: `orders.comuna_id IS NULL` — `normalize_comuna_id` never
 *   matched a comuna for this order (spec-72's data-model section, already
 *   planned as the "sin comuna" bucket).
 * - `orphan`: `orders.comuna_id IS NOT NULL` but no LIVE `route_blocks` row
 *   on this route covers that comuna. This is the gap spec-72 phase 3's
 *   spec text calls out explicitly: an order adopted via
 *   `routes/[id]/scan`'s adopt branch, or any order on a route created by
 *   `createEmptyDraft` (which never calls `create_seeded_route`, so the
 *   route's block list can be permanently empty), lands here. A reader that
 *   trusts `route_blocks` as a complete manifest would silently drop this
 *   order — the thing spec-72's data-model section forbids.
 */
export interface UnblockedOrder {
  orderId: string;
  orderNumber: string;
  comunaName: string | null;  // null only for the noComuna case
  reason: 'noComuna' | 'orphan';
}

export interface RouteBlocksResult {
  blocks: RouteBlockView[];
  unblocked: UnblockedOrder[];
}

/**
 * spec-72 phase 4 (Decision 6) — one comuna's territory history, as returned
 * by `get_route_territory_history`. `driverName` is the most recent
 * non-cancelled route's driver among this operator's OTHER routes that
 * covered this comuna via a live `route_blocks` row; `runCount` is how many
 * of those non-cancelled routes that same driver ran (all-time, no time
 * window — see the migration's header comment). Only comunas THIS route
 * already has a live block for are covered — an order still sitting in
 * `RouteBlocksResult.unblocked` (orphan) is invisible to this lookup, which
 * is why every consumer must also surface that orphan count alongside this
 * data, per spec-72's "Notes for phases 4 and 5".
 */
export interface TerritoryHistoryEntry {
  comunaId: string;
  comunaName: string;
  driverName: string;
  runCount: number;
  lastRouteDate: string; // ISO date YYYY-MM-DD
}
