# Spec-37: Pre-Ruta (Pre-Route Planning Tab)

> **Related:** [spec-12-distribution-sectorization-design.md](spec-12-distribution-sectorization-design.md), [spec-15-dispatch-module.md](spec-15-dispatch-module.md), [spec-35-distribution-dock-contents.md](spec-35-distribution-dock-contents.md)

**Status:** in progress

_Date: 2026-04-23_

---

## Goal

A load-awareness planning screen that lets the dispatcher see all received, unrouted orders grouped by **andén** (dock zone), so they can understand how work splits across trucks before creating draft routes. Pre-ruta sits chronologically before the existing route-creation flow and replaces the "stare at a spreadsheet to figure out truck count" step that operators currently do manually.

The screen is a **planning overview**, not a route editor. Its output is a seeded draft route on `/app/dispatch/{routeId}` — the same destination the existing `+ Nueva Ruta` button already reaches — so handoff to the existing draft editor is transparent.

Once the auto-router lands in a later spec, Pre-ruta becomes either the screen that kicks off the auto-routing run, or is superseded by it. No design decisions in this spec depend on that future.

## Non-Goals (V1)

- Automatic route generation / optimization — routing remains manual inside `/app/dispatch/{routeId}`.
- Order-level selection. Selection unit is the andén (matches "1 andén = 1 truck" operational reality). Multi-andén combines are supported via checkboxes.
- Comuna-level *"Crear ruta"* action. Comunas are drill-down only.
- Stranded / rezagados surfacing. Ops Control and Distribution already alert on these; duplicating would create noise.
- Time-window colored pills on andén cards. The *Franja* filter narrows the cohort; per-card breakdown is out of scope.
- Capacity / vehicle assignment. Happens downstream in the draft-route editor.
- Realtime subscription. React Query + focus refetch + mutation-triggered invalidation is sufficient.

## Prerequisites

- spec-12 (sectorization — establishes `packages.dock_zone_id` assignment)
- spec-15 (dispatch module — route creation UI that Pre-ruta hands off to)
- Andenes configured via `/app/distribution/settings` with at least one `dock_zones` row and `comunas[]` populated.

**Prior art to follow:** `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts` + `get_ops_control_snapshot` RPC — same pattern of a single RPC returning a nested snapshot consumed by a React Query hook. Use its structure as the template for `usePreRouteSnapshot` and `get_pre_route_snapshot`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ /app/dispatch                                                   │
│   Tabs:  [Pre-ruta (default)] [Abiertas] [En Ruta] [Completadas]│
│   KPIs:  Sin rutear | Rutas abiertas | Paquetes pend | ...      │
└──────────────────────┬──────────────────────────────────────────┘
                       │ PreRouteTab
                       ↓
┌─────────────────────────────────────────────────────────────────┐
│ PreRouteFilters (fecha, franja, totals)                         │
├─────────────────────────────────────────────────────────────────┤
│ UnmappedComunasBanner (extended from distribution)              │
├─────────────────────────────────────────────────────────────────┤
│ AndenCard * N                                                   │
│   └─ ComunaBreakdown (on expand)                                │
│        └─ OrderList (on comuna expand)                          │
├─────────────────────────────────────────────────────────────────┤
│ PreRouteSelectionBar (sticky, when ≥1 andén selected)           │
└──────────────────────┬──────────────────────────────────────────┘
                       │ POST /api/dispatch/routes { order_ids }
                       ↓
                /app/dispatch/{routeId}   (existing draft editor)
```

**Cohort rule (single source of truth):**
An order appears in Pre-ruta iff:

1. `orders.deleted_at IS NULL`
2. `orders.delivery_date = filter.date`
3. If filter.window set, `tsrange(delivery_window_start, delivery_window_end)` overlaps the chosen window band
4. Has at least one `packages` row with `deleted_at IS NULL`, `dock_zone_id IS NOT NULL`, and `status IN ('en_bodega','asignado','listo_para_despacho')`
5. Has **no** non-deleted `dispatches` row whose `route_id` points to a `routes` row in `status IN ('draft','planned','in_progress')`
6. `operator_id` matches the current operator

An order's **home andén** is `packages.dock_zone_id`. Per operational reality all packages of an order always share the same dock_zone_id, so no tie-breaking is needed. The RPC and pgTAP suite enforce this as an invariant (see test `order_with_split_dock_zones_fails_loudly` below) — if the invariant is ever violated, the RPC surfaces the order under the andén holding the first package (ordered by created_at) and a warning appears in the snapshot output, rather than silently double-counting.

---

## Data Model

No new tables. Reuses existing (names per `apps/frontend/src/lib/types.ts`):

- `orders` — `delivery_date`, `comuna_id` (authoritative for Pre-ruta grouping at the comuna level), `delivery_window_start`, `delivery_window_end`, `operator_id`, `deleted_at`
- `packages` — `order_id`, `dock_zone_id`, `status` (package_status_enum), `deleted_at`
- `dock_zones` — `id`, `name`, `is_active`, `is_consolidation`, `operator_id`
- `dock_zone_comunas` — junction table `(dock_zone_id, comuna_id)` defining andén membership. **There is no `comunas[]` array column on `dock_zones`.**
- `chile_comunas` — `id`, `name` (the comuna lookup table)
- `dispatches` — `route_id`, `order_id`, `status` (dispatch_status_enum; initial value `'pending'`), `deleted_at`
- `routes` — `id`, `status` (route_status_enum: `draft | planned | in_progress | completed | cancelled`), `operator_id`, `route_date`, `external_route_id`, `deleted_at`. **Table is `routes`, not `dispatch_routes`.**

### New migration — `get_pre_route_snapshot` RPC

```sql
-- supabase/migrations/<timestamp>_pre_route_snapshot.sql

CREATE OR REPLACE FUNCTION public.get_pre_route_snapshot(
  p_operator_id uuid,
  p_delivery_date date,
  p_window_start time DEFAULT NULL,
  p_window_end   time DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
  -- Returns:
  -- {
  --   generated_at: timestamp,
  --   totals: { order_count, package_count, anden_count },
  --   andenes: [
  --     { id, name, comunas_list: [name,...],
  --       order_count, package_count,
  --       comunas: [
  --         { id, name, order_count, package_count,
  --           orders: [{ id, order_number, customer_name, delivery_address,
  --                      delivery_window_start, delivery_window_end, package_count }] }
  --       ]
  --     }
  --   ],
  --   unmapped_comunas: [{ id, name, order_count, package_count }]
  -- }
$$;
```

Implementation uses CTEs:

1. `ready_packages` — `packages` with `dock_zone_id IS NOT NULL`, `status IN (…ready…)`, `deleted_at IS NULL`, operator-scoped.
2. `routed_order_ids` — order ids that appear in a non-deleted `dispatches` row whose `routes.status IN ('draft','planned','in_progress')`. Excluded from the cohort.
3. `ready_orders` — `orders` matching date+window filters, `deleted_at IS NULL`, operator-scoped, having at least one row in `ready_packages`, and not in `routed_order_ids`.
4. `order_home_anden` — resolves each order to one dock_zone_id: the `dock_zone_id` of the `ready_packages` row with the earliest `created_at` per order. When an order's packages span more than one dock_zone_id, the boolean `has_split_dock_zone` is emitted on that order's row in the snapshot (per-order) AND aggregated up to the andén as `has_split_dock_zone_warnings: true` (boolean, present on `PreRouteAnden`). The top-level `totals` also exposes `split_dock_zone_order_count` so the UI can surface a single global warning if needed.
5. `unmapped` — orders whose `comuna_id` has no matching row in `dock_zone_comunas` for an active, non-consolidation dock zone owned by the operator. These go under `unmapped_comunas`, not andenes.
6. Aggregations roll up order → comuna → andén and are shaped into the final JSON.

The RPC is read-only, uses `SECURITY INVOKER` (respects RLS), and filters by `p_operator_id` in every CTE (belt-and-braces with RLS).

`totals.anden_count` = number of andenes that have at least one order in the current cohort (not total configured andenes).

### Extension to `POST /api/dispatch/routes`

Existing endpoint today accepts no body, inserts a `routes` row with `status='draft'` and a `draft_<uuid>` placeholder `external_route_id`, and returns `{ id, status, route_date, created_at }` (see `apps/frontend/src/app/api/dispatch/routes/route.ts`). Extend to accept an optional body:

```ts
// apps/frontend/src/app/api/dispatch/routes/route.ts
type CreateRouteBody = { order_ids?: string[] };
```

When `order_ids` is present and non-empty:

1. Validate every id belongs to the current `operator_id` (else 400 `{ code: 'INVALID_ORDER_IDS', invalid_ids: […] }`).
2. Validate every id is **not** already associated with a `dispatches` row on a `routes.status IN ('draft','planned','in_progress')` (else 400 `{ code: 'ORDERS_ALREADY_ROUTED', routed_ids: […] }` — prevents the race where the user clicks stale data).
3. Insert the `routes` row as today (`status='draft'`).
4. Insert one `dispatches` row per order in the same transaction with `route_id` set, `status = 'pending'` (confirmed initial enum value), `provider = 'dispatchtrack'` to mirror the route, `external_dispatch_id = null`.
5. Return the existing response shape — `{ id, status, route_date, created_at }` — unchanged. Callers that need only the id already destructure that field.

On any validation failure the transaction must not create the route. Use a single `rpc`-backed helper (`create_seeded_route`) or a Postgres-function wrapper to achieve true atomicity — the current two-step insert is not sufficient when order_ids are present. Write tests for partial-failure rollback (see Chunk 5).

Empty body (or empty `order_ids`) preserves today's behavior exactly.

---

## Components

**Page (modified)**
- `apps/frontend/src/app/app/dispatch/page.tsx` — adds `Pre-ruta` tab as default, new *Sin rutear* KPI. Keeps under 300 LOC by lifting each tab's contents into its own component (existing tabs get extracted too as part of this work — `DispatchOpenTab.tsx`, `DispatchInProgressTab.tsx`, `DispatchCompletedTab.tsx`). Tab navigation state lives in URL via `?tab=`.

**New directory: `apps/frontend/src/components/dispatch/pre-route/`**
- `PreRouteTab.tsx` — top-level orchestrator. Composes filters + banner + list + selection bar. Delegates selection and expansion state to a dedicated `usePreRouteSelection` hook (see Hooks) to keep this file comfortably under 300 LOC.
- `PreRouteFilters.tsx` — date picker (defaults today) + window selector (*Todas* / *Mañana* ≤12h / *Tarde* 12–17h / *Noche* >17h) + right-aligned totals chip. Filter values persisted to URL params.
- `AndenCard.tsx` — one card per anden. Props: `anden`, `isSelected`, `isExpanded`, `onToggleSelect`, `onToggleExpand`, `onCreateRoute`. Renders checkbox, name, comuna list summary, counts, chevron, *Crear ruta* button. Click targets separated: checkbox, body (expand), button.
- `ComunaBreakdown.tsx` — list of comuna rows inside an expanded anden. Each row is itself expandable to reveal `OrderList`.
- `OrderList.tsx` — read-only list of orders (order number, customer name, delivery address, window, package count). No selection, no actions.
- `PreRouteSelectionBar.tsx` — sticky bar rendered when `selectedAndenIds.size > 0`. Shows combined order+bultos totals, *Crear ruta con selección* primary button, *Limpiar* secondary. `aria-live="polite"`.
- Extends (not reuses as-is) `components/distribution/UnmappedComunasBanner.tsx`: current prop shape is `{ unmappedComunas: string[] }` with hard-coded copy. Pre-ruta needs per-comuna counts and a CTA linking to `/app/distribution/settings`. Extension: add an optional `variant: 'pre-route' | 'distribution'` (default `distribution`) and support a richer prop `items?: { id, name, order_count, package_count }[]`. Existing distribution usage is unchanged. New test cases cover the pre-route variant.

**New directory: `apps/frontend/src/hooks/dispatch/pre-route/`**
- `usePreRouteSnapshot.ts` — React Query. Key: `['dispatch', 'pre-route', operatorId, date, windowStart, windowEnd]`. Calls `supabase.rpc('get_pre_route_snapshot', …)`. `staleTime: 30s`, `refetchOnWindowFocus: true`. Mirrors `useOpsControlSnapshot`.
- `useCreateRouteFromSelection.ts` — React Query mutation. POST to `/api/dispatch/routes` with `{ order_ids }`. `onSuccess`: invalidates `['dispatch', 'pre-route']` and `['dispatch', 'routes']`, returns the created route (shape `{ id, status, route_date, created_at }`) — callers destructure `.id` for navigation.
- `usePreRouteSelection.ts` — local React state hook that owns the selection Set and expansion Map. Returns `{ selectedAndenIds, toggleSelect, clearSelection, expandedAndenIds, toggleAndenExpansion, expandedComunaIds, toggleComunaExpansion, allSelected, toggleSelectAll }`. Pure UI state, no network.

**Types (added to `apps/frontend/src/lib/types.ts`)**

```ts
export type PreRouteOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  delivery_address: string;
  delivery_window_start: string | null;
  delivery_window_end: string | null;
  package_count: number;
  has_split_dock_zone: boolean; // invariant violation; expected false in practice
};

export type PreRouteComuna = {
  id: string;
  name: string;
  order_count: number;
  package_count: number;
  orders: PreRouteOrder[];
};

export type PreRouteAnden = {
  id: string;
  name: string;
  comunas_list: string[]; // for the subtitle
  order_count: number;
  package_count: number;
  comunas: PreRouteComuna[];
  order_ids: string[]; // flattened, for the create-route call
  has_split_dock_zone_warnings: boolean;
};

export type PreRouteSnapshot = {
  generated_at: string;
  totals: {
    order_count: number;
    package_count: number;
    anden_count: number;
    split_dock_zone_order_count: number;
  };
  andenes: PreRouteAnden[];
  unmapped_comunas: { id: string; name: string; order_count: number; package_count: number }[];
};
```

---

## UX Details

**Filters**
- Date picker defaults to today (server-local; operators are single-timezone per current deployment, so no TZ conversion). Changing it updates `?date=YYYY-MM-DD`.
- Window selector: `todas | manana | tarde | noche`. Stored as `?window=…`. Backend maps to start/end times using half-open intervals to avoid the boundary-ambiguity problem:
  - `manana` → `[00:00, 12:00)`
  - `tarde` → `[12:00, 17:00)`
  - `noche` → `[17:00, 24:00)`
  A window overlap (not strict containment) is used so an order's `tsrange(delivery_window_start, delivery_window_end)` matches if it intersects the selected band.
- Totals chip at right updates live with the snapshot.

**Expansion**
- Andén cards collapsed by default. Click body or chevron → reveal `ComunaBreakdown`.
- Comuna rows collapsed by default. Click row → reveal `OrderList`.
- Expansion state is session-local (React state), not URL-persisted.

**Selection**
- Andén checkbox toggles inclusion. Clicking the checkbox never triggers expansion.
- *"Seleccionar todos"* master checkbox appears above the list when there are ≥2 andenes (acts on currently-rendered andenes only).
- `PreRouteSelectionBar` becomes visible the instant any andén is selected; shows combined totals; primary action *"Crear ruta con selección"*, secondary *"Limpiar"*.
- Per-card *"Crear ruta"* button always creates a route for exactly that card's `order_ids`, regardless of current selection — the button acts locally, not on the checkbox state.
- **Multi-andén intent note (UX label):** when two or more andenes are selected, the selection-bar action reads *"Crear ruta combinada ({n} andenes)"*. The secondary line makes the tradeoff explicit: *"Una sola ruta con órdenes de varios andenes. Úsalo solo cuando haga falta completar capacidad."* — this reinforces the "1 andén = 1 truck" default and signals that multi-andén routes are the exception.

**Route-creation handoff**
1. Button click → `useCreateRouteFromSelection.mutate({ order_ids })`.
2. On success → invalidate cache → `router.push('/app/dispatch/' + id)`.
3. On 400 with "already-routed" detail → toast with the offending order numbers, refetch pre-route snapshot so stale orders disappear.
4. On other errors → toast and stay on the tab.

**Empty states**
- No matching orders: *"No hay órdenes listas para rutear con estos filtros."*
- No andenes configured: link out to `/app/distribution/settings`.

**Unmapped comunas banner**
- Shown only when `unmapped_comunas.length > 0`. Copy: *"{n} órdenes en comunas sin andén asignado: {names}. [Asignar andén]"*. Link goes to `/app/distribution/settings`.

**Responsive**
- Page stays within existing dispatch `max-w-5xl`.
- At <768px, andén card header wraps: name+comunas on first line, counts+checkbox+button on second. Selection bar becomes full-width, stacks total + action vertically.

**Accessibility**
- Andén cards: row-body is `<button>` (expand); checkbox is a `<label><input type="checkbox"></label>` sibling, not nested; *Crear ruta* button is a `<button>` sibling.
- Selection bar announces count via `aria-live="polite"`.
- Keyboard: Tab traverses checkbox → row → button → next andén. Enter/Space toggles whatever has focus.

---

## Testing Strategy (TDD)

Every chunk writes tests first, then implementation. Standard Aureon convention.

### Database / RPC — pgTAP

`supabase/tests/pre_route_snapshot.test.sql`:

- `returns_zero_when_no_orders_match_date` — empty result for a day with no orders.
- `groups_orders_by_dock_zone` — 3 orders across 2 andenes produce 2 andén rows with correct counts.
- `excludes_orders_in_active_routes` — an order with a dispatch on a `draft` route is not listed; `completed` / `cancelled` routes don't exclude.
- `excludes_packages_not_ready_state` — packages in `ingresado` or `verificado` don't make the order eligible.
- `excludes_packages_without_dock_zone` — null `dock_zone_id` packages ignored.
- `respects_window_filter` — an order with window 9–11h is included for *Mañana*, excluded for *Tarde*.
- `operator_isolation` — other operator's orders never appear.
- `excludes_soft_deleted` — `orders.deleted_at IS NOT NULL` and `packages.deleted_at IS NOT NULL` both excluded.
- `unmapped_comunas_populated` — orders whose `comuna_id` has no row in `dock_zone_comunas` for an active non-consolidation dock zone appear under `unmapped_comunas`, not under andenes.
- `order_with_split_dock_zones_fails_loudly` — seed an order with packages in two different dock_zone_ids (invariant violation). Assert: order appears under exactly one andén (the one holding the package with min(created_at)), total count is 1 not 2, and the andén's `has_split_dock_zone_warnings` flag is true. This guards the invariant the application relies on.

### Hooks — Vitest + RTL

- `usePreRouteSnapshot.test.tsx` — calls rpc with correct args; returns parsed snapshot; surfaces loading/error.
- `useCreateRouteFromSelection.test.tsx` — POSTs correct body; invalidates the two query keys; returns route id; handles 400 response shape.

### Components — Vitest + RTL

- `AndenCard.test.tsx` — renders counts; expand chevron toggles state; checkbox fires `onToggleSelect`; *Crear ruta* fires `onCreateRoute` with this card's ids only; clicking checkbox does not expand; clicking body does not select.
- `ComunaBreakdown.test.tsx` — renders per-comuna counts; row click reveals `OrderList`.
- `OrderList.test.tsx` — renders fields; no action UI.
- `PreRouteSelectionBar.test.tsx` — hidden when selection empty; shows summed totals when ≥1 selected; *Crear ruta con selección* fires with merged ids; *Limpiar* clears.
- `PreRouteFilters.test.tsx` — defaults to today; date change updates URL; window change updates URL; summary chip reflects snapshot totals.
- `PreRouteTab.test.tsx` (integration) — mock snapshot → filter → select 2 andenes → click selection-bar action → assert navigation to `/app/dispatch/{id}` with merged `order_ids`.

### API route

`apps/frontend/src/app/api/dispatch/routes/route.test.ts`:

- With empty body → creates empty draft (regression check for current behavior).
- With empty `order_ids` array → treated as empty body, creates empty draft.
- With `order_ids` → creates route and dispatches atomically; dispatches have `status='pending'`, correct `route_id`, correct `order_id`, `provider='dispatchtrack'`.
- With an `order_id` from a different operator → 400 `INVALID_ORDER_IDS` with `invalid_ids[]`, **no `routes` row created**, **no `dispatches` rows created** (partial-failure rollback).
- With an `order_id` already on an active-status route → 400 `ORDERS_ALREADY_ROUTED` with `routed_ids[]`, **no writes**.
- Simulated DB failure on the `dispatches` insert mid-transaction → verify the `routes` row was also rolled back (atomicity test).

### Manual smoke (not automated in v1)

- Open `/app/dispatch`, confirm Pre-ruta is default; select one anden, click *Crear ruta*; land on draft editor with seeded orders; return — those orders no longer in Pre-ruta.

---

## Implementation Plan

Chunks are independent enough to be landed as separate PRs if wanted. Each chunk ships as its own auto-merged PR per project rules.

### Chunk 1 — Database RPC and types

- Write `supabase/tests/pre_route_snapshot.test.sql` (all cases above, initially failing).
- Write migration `<timestamp>_pre_route_snapshot.sql` implementing `get_pre_route_snapshot`.
- Run pgTAP locally via `npx supabase test db`.
- Regenerate types: `npx supabase gen types typescript --project-id … > apps/frontend/src/lib/types.ts` (or the project's existing script).
- Add `PreRouteSnapshot` / `PreRouteAnden` / `PreRouteComuna` / `PreRouteOrder` to `apps/frontend/src/lib/types.ts`.

### Chunk 2 — Hook

- Write `usePreRouteSnapshot.test.tsx` (failing).
- Implement `apps/frontend/src/hooks/dispatch/pre-route/usePreRouteSnapshot.ts`.

### Chunk 3 — Read-only components (no route creation yet)

- Write tests for `OrderList`, `ComunaBreakdown`, `AndenCard` (without selection/action).
- Implement `OrderList.tsx`, `ComunaBreakdown.tsx`, `AndenCard.tsx` — checkbox and *Crear ruta* button stubbed (no handlers).
- Write tests for `PreRouteFilters`.
- Implement `PreRouteFilters.tsx` with URL-param persistence.

### Chunk 4 — Tab-content composition (not yet mounted)

- Write tests for `PreRouteTab` (without route creation — buttons are stubbed handlers that assert the correct args are produced).
- Implement `usePreRouteSelection.ts` with its own tests.
- Implement `PreRouteTab.tsx` using the selection hook.
- **Do NOT modify `page.tsx` in this chunk** — the tab is built and tested in isolation, but not yet registered in the dispatch page. Rationale: avoids an intermediate user-facing state where the tab is visible with non-functional *Crear ruta* buttons. See Rollout.

### Chunk 5 — Selection bar, route creation, and page mount (single atomic PR)

- Write tests for `PreRouteSelectionBar`; implement `PreRouteSelectionBar.tsx`.
- Wire selection bar inside `PreRouteTab`.
- Write API route tests (all cases in Testing — API route section), then extend `POST /api/dispatch/routes` to accept `order_ids` with true transactional atomicity (introduce a `create_seeded_route` Postgres function or use a single RPC call; do not rely on two sequential inserts).
- Write `useCreateRouteFromSelection.test.tsx`; implement the mutation hook.
- Wire *Crear ruta* per card and *Crear ruta combinada* in bar to the mutation → navigation.
- **Only now** modify `apps/frontend/src/app/app/dispatch/page.tsx`:
  - Extract existing tab contents into `DispatchOpenTab`, `DispatchInProgressTab`, `DispatchCompletedTab` (pure mechanical lift).
  - Mount Pre-ruta as default tab (tab state via `?tab=`).
  - Add *Sin rutear* KPI (sourced from `snapshot.totals.order_count`).
- This PR is the first one that changes user-facing behavior.

### Chunk 6 — Polish and verify

- *Sin rutear* KPI uses neutral styling (same as other KPIs) — a red/orange treatment would alarm users on normal queue volumes. Consider emphasis only if the count crosses an operator-configurable threshold; out of scope for v1.
- Extend `UnmappedComunasBanner` to support the pre-route variant (new tests, new prop shape as described in Components).
- Empty state and error toast handling (400 `ORDERS_ALREADY_ROUTED` → show toast, refetch snapshot so stale rows disappear).
- Manual smoke per "Manual smoke" section.
- Update `docs/sprint-status.yaml` with the new spec entry.

## Rollout

- No feature flag — ships enabled once merged.
- **Chunks 1–4 are user-invisible**: migrations, types, hooks, and components exist in the repo but nothing mounts them. Each auto-merges on CI-green per project rules without changing the dispatch UI.
- **Chunk 5 is the user-visible switch** — it introduces the API-route extension, the mutation hook, and `page.tsx` changes in one atomic PR. If any part of chunk 5 needs to roll back, it reverts cleanly without leaving a half-built tab on main.
- Chunk 6 is pure polish post-launch and can ship separately.

## Out-of-scope / Future

- Auto-routing integration (separate future spec).
- Capacity-aware hints per andén (driven by fleet vehicle config).
- Stranded / rezagados treatment on Pre-ruta — revisit only if Ops Control alerts prove insufficient in practice.
- Per-comuna or per-order route creation — revisit if operator feedback demands granularity below the andén.
- Real-time subscription to package status changes — current polling + focus refetch is expected to be sufficient.
