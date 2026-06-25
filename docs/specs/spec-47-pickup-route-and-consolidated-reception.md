# Spec-47: Pickup Route & Consolidated Hub Reception

> **Supersedes parts of:** [spec-08-hub-reception-design.md](spec-08-hub-reception-design.md), [spec-13d-pickup-reception.md](spec-13d-pickup-reception.md)
> **Related:** [spec-01-epic4a-pickup-verification.md](spec-01-epic4a-pickup-verification.md), [spec-21-reception-visual-polish.md](spec-21-reception-visual-polish.md)

**Status:** backlog

_Date: 2026-06-25_

---

## Goal

Replace today's **per-manifest** QR handoff with a **route-level** handoff. A truck doing one pickup trip may load multiple manifests from multiple retailers; from the hub's point of view it is a single arrival event. The hub receptionist must be able to scan **one QR** (or type one short route code) and immediately see a **consolidated, order-grouped list of every package on that truck**, then scan freely without opening individual manifests — because packages and cartons get mixed in transit and forcing a manifest-by-manifest reception is operationally unworkable.

This is the **pickup-side route**, distinct from the existing distribution `routes` table that powers `/app/dispatch`. The two concepts share a name in operator vocabulary but are different tables and different domains. We use the table name `pickup_routes` to make this unambiguous.

## Non-Goals

- Route optimization / sequencing of retailers — drivers still decide the order they visit retailers.
- Capacity / vehicle assignment at route start — vehicle is captured as free text or nullable FK; no validation.
- Multi-driver routes — exactly one driver per `pickup_routes` row.
- Changes to the verification scan flow inside a single manifest (`/app/pickup/scan/[loadId]`) — that screen stays as is; we only change what wraps it.
- Backwards compatibility with the manifest-level QR. Once shipped, the per-manifest "Confirmar Pickup → QR" flow is removed entirely.
- Receipt of legacy in-transit manifests that were created under the old flow before this spec ships — migration handles them once at deploy time (see Migration section); no dual-flow runtime support.

## Prerequisites

- spec-01 (pickup verification — `manifests`, `pickup_scans`, status pipeline)
- spec-08 (hub reception — `hub_receptions`, `reception_scans`, the `reception_status_enum`)

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ /app/pickup (driver landing)                                       │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │ Active route banner (if exists) — code, started_at, manifest │ │
│   │ count, "Ver ruta" button                                     │ │
│   └──────────────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────────────┐ │
│   │ [+ Iniciar ruta de retiro]   (disabled if active exists)     │ │
│   └──────────────────────────────────────────────────────────────┘ │
│   Manifest list (unchanged) — tapping a manifest enters scan flow  │
└────────────────────────────────────────────────────────────────────┘
                              │ start route
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ /app/pickup/route/active                                           │
│   Route header: code, started_at, status=in_progress               │
│   Linked manifests list (verified count / expected count each)     │
│   [+ Agregar manifiesto]   → opens manifest picker (links it)      │
│   [Cerrar ruta y entregar]  → flips status to in_transit, →QR page │
└────────────────────────────────────────────────────────────────────┘
                              │ close route
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ /app/pickup/route/[routeId]/qr                                     │
│   Big QR (payload = routeId)                                       │
│   Route code (large monospace) for manual entry fallback           │
│   Summary: N manifests, M packages verified                        │
└────────────────────────────────────────────────────────────────────┘

╔════════════════════════════════════════════════════════════════════╗
║                            HUB SIDE                                ║
╚════════════════════════════════════════════════════════════════════╝
┌────────────────────────────────────────────────────────────────────┐
│ /app/reception                                                     │
│   Tab: [Rutas entrantes] [En recepción] [Completadas]              │
│   List of pickup_routes in status=in_transit                       │
│   Scan QR button (camera) OR type code                             │
└────────────────────────────────────────────────────────────────────┘
                              │ scan or pick
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ /app/reception/route/[routeId]                                     │
│   Header: route code, driver, N manifests, M expected pkgs         │
│   Scanner input (always focused)                                   │
│   Consolidated list grouped by ORDER (not manifest)                │
│     Order #123 (retailer X)                                        │
│        ☐ PKG-A   ☐ PKG-B   ☑ PKG-C                                 │
│     Order #124 (retailer Y)                                        │
│        ☐ PKG-D   ☑ PKG-E                                           │
│   Progress: received/expected, discrepancy list                    │
│   [Finalizar recepción] (enabled when received==expected or after  │
│                          discrepancy note entered)                 │
└────────────────────────────────────────────────────────────────────┘
```

**Single-active-route rule:** at most one `pickup_routes` row with `status IN ('draft','in_progress')` per `(operator_id, driver_id)`. Enforced by a partial unique index.

**Verification-before-route is blocked:** the pickup scan page rejects a scan if the manifest is not linked to an `in_progress` pickup route. A driver who taps a manifest without an active route sees a "Inicia una ruta de retiro primero" prompt.

---

## Data Model

### New table: `pickup_routes`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID, PK, default gen_random_uuid() | QR payload |
| `operator_id` | UUID, FK operators, NOT NULL | RLS |
| `code` | TEXT, NOT NULL | Human-typable, format `PR-YYYY-NNNN`. Unique per operator. |
| `driver_id` | UUID, FK users, NOT NULL | Single driver per route |
| `vehicle_label` | TEXT, nullable | Free text for now (plate, alias) |
| `status` | `pickup_route_status_enum`, NOT NULL, default `'in_progress'` | See enum below |
| `started_at` | TIMESTAMPTZ, NOT NULL, default now() | |
| `in_transit_at` | TIMESTAMPTZ, nullable | Set when status → in_transit |
| `received_at` | TIMESTAMPTZ, nullable | Set when status → received |
| `cancelled_at` | TIMESTAMPTZ, nullable | Set when status → cancelled |
| `created_at` | TIMESTAMPTZ, NOT NULL, default now() | |
| `updated_at` | TIMESTAMPTZ, NOT NULL, default now() | `set_updated_at` trigger |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

**Indexes:**
- `(operator_id)`
- `(operator_id, code)` UNIQUE WHERE `deleted_at IS NULL`
- `(operator_id, driver_id)` UNIQUE WHERE `status IN ('draft','in_progress') AND deleted_at IS NULL` — enforces single-active rule
- `(operator_id, status)`
- `(deleted_at)`

**Code generation:** sequence per operator-year. Use `pickup_route_code_seq_<operator_id>_<year>` style? Simpler: a single sequence `pickup_routes_code_seq` (operator-scoped uniqueness handled by the unique index, not by sequence partitioning) and format `PR-${year}-${nextval.toString().padStart(4,'0')}`. Collisions across operators are fine because the unique index is `(operator_id, code)`.

### New enum: `pickup_route_status_enum`

Values: `draft`, `in_progress`, `in_transit`, `received`, `cancelled`.

| Status | Meaning |
|---|---|
| `draft` | Created but driver hasn't started verifying any manifest yet. Reserved for future; v1 inserts straight to `in_progress`. |
| `in_progress` | Driver actively picking up; manifests being linked and scanned. |
| `in_transit` | Driver closed the route; QR generated; truck moving to hub. |
| `received` | Hub finished reception (all expected packages scanned or discrepancies noted). |
| `cancelled` | Route abandoned before close. Manifests detach (`pickup_route_id` → NULL). |

### New table: `route_receptions`

Replaces the responsibility `hub_receptions` had per-manifest with a route-level row.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID, PK | |
| `pickup_route_id` | UUID, FK pickup_routes, NOT NULL, UNIQUE | One reception per route |
| `operator_id` | UUID, FK operators, NOT NULL | RLS |
| `received_by` | UUID, FK users, nullable | Set on first scan or on open |
| `delivered_by` | UUID, FK users, NOT NULL | Driver (denormalized from route for audit) |
| `status` | `hub_reception_status_enum` (reuse existing) | `pending`/`in_progress`/`completed` |
| `started_at` | TIMESTAMPTZ, nullable | Set when first reception scan occurs |
| `completed_at` | TIMESTAMPTZ, nullable | Set on confirmation |
| `expected_count` | INT, NOT NULL | Sum of verified pickup_scans across all linked manifests, frozen at route close |
| `received_count` | INT, NOT NULL, default 0 | Updated by trigger on reception_scans |
| `discrepancy_notes` | TEXT, nullable | |
| `created_at` / `updated_at` / `deleted_at` | standard | |

**Indexes:** `(operator_id)`, `(operator_id, status)`, `(pickup_route_id)` UNIQUE, `(deleted_at)`.

### Modified table: `manifests`

Add column:

| Column | Type | Notes |
|---|---|---|
| `pickup_route_id` | UUID, FK pickup_routes, nullable | Set when driver adds manifest to active route; cleared on route cancel |

Index `(pickup_route_id)`.

The existing `manifests.reception_status` column stays — its semantics are now driven by the **route**'s reception, not a per-manifest hub_receptions row:

- All manifests linked to a route flip to `awaiting_reception` together when the route → `in_transit`.
- All flip to `reception_in_progress` when the route's `route_receptions.status='in_progress'`.
- All flip to `received` when route_receptions completes.

### Modified table: `reception_scans`

Change FK:

| Column | Was | Now |
|---|---|---|
| `reception_id` | FK hub_receptions | FK route_receptions |

(Column name kept; only the referenced table changes via migration.)

### Removed table: `hub_receptions`

Dropped. The route_receptions row carries all the same information at the right grain. See Migration section for the one-shot data move.

### Triggers

1. **`trg_pickup_routes_set_manifest_reception_status`** — on `pickup_routes` UPDATE of `status`:
   - `→ in_transit`: set every linked manifest's `reception_status = 'awaiting_reception'`; create the `route_receptions` row (`status='pending'`, `expected_count` computed by counting distinct verified `pickup_scans.package_id` across all linked manifests).
   - `→ received`: set every linked manifest's `reception_status = 'received'`.
   - `→ cancelled`: detach manifests (`pickup_route_id = NULL`) and clear their `reception_status` if it was set by this route.

2. **`trg_route_receptions_status_sync`** — on `route_receptions` UPDATE of `status`:
   - `→ in_progress`: set linked manifests' `reception_status = 'reception_in_progress'`; stamp `started_at`.
   - `→ completed`: set linked manifests' `reception_status = 'received'`; stamp `completed_at`; flip `pickup_routes.status = 'received'`.

3. **`trg_reception_scans_route_received_count`** — on `reception_scans` INSERT with `scan_result='received'`:
   - Increment `route_receptions.received_count`.
   - Update `packages.status = 'en_bodega'` (unchanged behavior from spec-08).
   - Promote `route_receptions.status` from `pending` → `in_progress` if it was pending.

4. **Existing `trg_recalculate_order_status`** — unchanged; still fires off package status updates.

### RLS, audit, grants

Both new tables follow the architecture-mandated infrastructure: tenant RLS via `get_operator_id()`, `audit_trigger_func`, `set_updated_at`, SELECT/INSERT/UPDATE to `authenticated`, REVOKE from `anon`.

---

## RPCs

### `start_pickup_route(p_vehicle_label TEXT DEFAULT NULL) RETURNS pickup_routes`

Inserts a new row for the current operator and `auth.uid()` driver, generates the next `code`, returns the row. Raises if an active route already exists for the driver.

### `add_manifest_to_route(p_route_id UUID, p_manifest_id UUID) RETURNS manifests`

Sets `manifests.pickup_route_id = p_route_id`. Raises if the manifest is already on a different route, if the route is not `in_progress`, or if the manifest's `operator_id` differs.

### `close_pickup_route(p_route_id UUID) RETURNS route_receptions`

Validates the route has ≥1 linked manifest with ≥1 verified scan, flips `status='in_transit'`, lets the trigger create the `route_receptions` row, returns it (so the client can render the QR immediately).

### `cancel_pickup_route(p_route_id UUID, p_reason TEXT) RETURNS pickup_routes`

Flips status to `cancelled` (only allowed from `draft` or `in_progress`). Trigger detaches manifests.

### `get_route_reception_snapshot(p_route_id UUID) RETURNS jsonb`

Returns the consolidated reception view (route header + all linked manifests + every expected package grouped by order + every reception_scan so far + computed `received_count`/`expected_count`/discrepancy list). Single round-trip — same pattern as `get_ops_control_snapshot`. Consumed by the consolidated reception page via React Query.

### `complete_route_reception(p_route_id UUID, p_discrepancy_notes TEXT DEFAULT NULL) RETURNS route_receptions`

Flips `route_receptions.status='completed'`. Trigger cascades manifest statuses and flips `pickup_routes.status='received'`.

---

## Component Architecture

### Driver-side (pickup)

| Component | Path | Purpose |
|---|---|---|
| `ActiveRouteBanner` | `apps/frontend/src/components/pickup/ActiveRouteBanner.tsx` | Renders on pickup landing if active route exists |
| `StartRouteButton` | `apps/frontend/src/components/pickup/StartRouteButton.tsx` | Disabled if active route exists |
| `RouteManifestList` | `apps/frontend/src/components/pickup/RouteManifestList.tsx` | List of manifests linked to active route with verified/expected counts |
| `AddManifestSheet` | `apps/frontend/src/components/pickup/AddManifestSheet.tsx` | Bottom sheet picker that links an unassigned manifest to the route |
| `CloseRouteButton` | `apps/frontend/src/components/pickup/CloseRouteButton.tsx` | Disabled until ≥1 manifest with ≥1 verified scan |
| `RouteQRView` | `apps/frontend/src/components/pickup/RouteQRView.tsx` | Big QR + route code + summary |

| Page | Path |
|---|---|
| Pickup landing (modified) | `apps/frontend/src/app/app/pickup/page.tsx` |
| Active route view | `apps/frontend/src/app/app/pickup/route/active/page.tsx` |
| Route QR view | `apps/frontend/src/app/app/pickup/route/[routeId]/qr/page.tsx` |

| Hook | Path |
|---|---|
| `useActivePickupRoute` | `apps/frontend/src/hooks/pickup/useActivePickupRoute.ts` |
| `useStartPickupRoute` | `apps/frontend/src/hooks/pickup/useStartPickupRoute.ts` |
| `useAddManifestToRoute` | `apps/frontend/src/hooks/pickup/useAddManifestToRoute.ts` |
| `useClosePickupRoute` | `apps/frontend/src/hooks/pickup/useClosePickupRoute.ts` |

**Deleted:** `apps/frontend/src/app/app/pickup/handoff/[loadId]/page.tsx`, `apps/frontend/src/hooks/reception/useQRHandoff.ts`, `apps/frontend/src/components/reception/QRHandoff.tsx` and their tests.

### Hub-side (reception)

| Component | Path | Purpose |
|---|---|---|
| `IncomingRoutesList` | `apps/frontend/src/components/reception/IncomingRoutesList.tsx` | Routes in `in_transit` |
| `RouteQRScannerEntry` | `apps/frontend/src/components/reception/RouteQRScannerEntry.tsx` | Camera + code-input dual entry |
| `ConsolidatedScanList` | `apps/frontend/src/components/reception/ConsolidatedScanList.tsx` | Order-grouped package list with scan state |
| `RouteReceptionHeader` | `apps/frontend/src/components/reception/RouteReceptionHeader.tsx` | Route code, driver, counts, progress |
| `FinalizeReceptionButton` | `apps/frontend/src/components/reception/FinalizeReceptionButton.tsx` | With discrepancy-note modal when received < expected |

| Page | Path |
|---|---|
| Reception landing (modified) | `apps/frontend/src/app/app/reception/page.tsx` |
| Consolidated reception | `apps/frontend/src/app/app/reception/route/[routeId]/page.tsx` |

| Hook | Path |
|---|---|
| `useRouteReceptionSnapshot` | `apps/frontend/src/hooks/reception/useRouteReceptionSnapshot.ts` |
| `useReceptionScan` (modified) | `apps/frontend/src/hooks/reception/useReceptionScan.ts` — now writes against route_receptions |
| `useCompleteRouteReception` | `apps/frontend/src/hooks/reception/useCompleteRouteReception.ts` |

**Deleted:** the per-manifest reception scan page (`apps/frontend/src/app/app/reception/scan/[receptionId]/page.tsx`) is replaced by the route-level page. `ReceptionCard` is repurposed to render a route, not a single manifest.

---

## Migration

One migration file: `<timestamp>_spec47_pickup_routes_consolidated_reception.sql`. Steps in this exact order inside one transaction:

1. Create `pickup_route_status_enum`.
2. Create `pickup_routes` table + indexes + RLS + audit trigger + `set_updated_at`.
3. Create `route_receptions` table + indexes + RLS + audit trigger + `set_updated_at`.
4. Add `manifests.pickup_route_id` column + index.
5. **Backfill** (5A — chosen): for every existing `manifests` row with `reception_status IS NOT NULL` AND `pickup_route_id IS NULL`:
   - Create one `pickup_routes` row per manifest (code `PR-LEGACY-<seq>`, status mirrors manifest's reception lifecycle).
   - Set `manifests.pickup_route_id`.
   - For each existing `hub_receptions` row, create a matching `route_receptions` row (1:1).
   - Repoint `reception_scans.reception_id` to the new `route_receptions.id` (the column type doesn't change, only the values).
6. Alter `reception_scans.reception_id` FK from `hub_receptions(id)` to `route_receptions(id)`.
7. Drop `hub_receptions`.
8. Install the three new triggers.

Post-migration invariant test (pgTAP): every `manifests.reception_status IS NOT NULL` row has exactly one `pickup_route_id`, and every `reception_scans` row's `reception_id` points to a `route_receptions` row whose `pickup_route_id` matches the manifest's `pickup_route_id`.

---

## Error Handling

- **Driver tries to scan a manifest without an active route** → server-side `add_manifest_to_route` rejects; UI shows toast "Inicia una ruta de retiro primero" with CTA to start one.
- **Driver tries to close a route with zero verified packages** → `close_pickup_route` raises; button is already disabled client-side as a defense.
- **Two devices try to start a route for the same driver concurrently** → second insert fails on the partial unique index; UI surfaces "Ya tienes una ruta activa".
- **Receptionist scans a barcode that maps to a package outside this route** → `reception_scans` insert proceeds with `scan_result='not_found'` (existing pattern) and the package appears in the discrepancy list, not the expected list.
- **Receptionist tries to finalize with received < expected** → `complete_route_reception` requires `p_discrepancy_notes` to be non-null; UI gates the button behind a notes modal.
- **Code collision on insert** (sequence rolls back, retry) — uses `INSERT ... ON CONFLICT (operator_id, code) DO NOTHING RETURNING *` with retry up to 3x. Effectively never fires given the sequence, but bounded.

---

## Testing

### pgTAP (`packages/database/supabase/tests/`)

- `spec47_pickup_routes_rls.sql` — operator A cannot see operator B's routes.
- `spec47_single_active_route_per_driver.sql` — partial unique index rejects a second `in_progress` route for the same driver.
- `spec47_close_route_creates_route_reception.sql` — closing fires the trigger and creates `route_receptions` with correct `expected_count`.
- `spec47_close_route_zero_packages_fails.sql` — closing with zero verified scans raises.
- `spec47_reception_scan_increments_count.sql` — scan trigger increments `received_count` and promotes status to `in_progress`.
- `spec47_complete_route_cascades_manifest_status.sql` — completing flips all linked manifests to `received`.
- `spec47_cancel_route_detaches_manifests.sql` — cancelling clears `pickup_route_id` and `reception_status`.
- `spec47_migration_invariants.sql` — post-backfill, every reception_status-set manifest has a route; every reception_scan points to a route_reception matching its manifest's route.

### Component tests (Vitest + RTL)

One `.test.tsx` per new component, covering: rendering, disabled states, click handlers fire the right hook, error states render the right copy. Mirror existing patterns from `apps/frontend/src/components/reception/ReceptionScanner.test.tsx`.

### Hook tests

- `useActivePickupRoute.test.ts` — returns the active route, null when none, refetches on focus.
- `useStartPickupRoute.test.ts` — error path when active route exists.
- `useRouteReceptionSnapshot.test.ts` — shape of the snapshot, optimistic update on scan, invalidation on complete.

### Page-level integration tests

- `apps/frontend/src/app/app/pickup/route/active/page.test.tsx` — flow: start route, add manifest, close route, lands on QR page.
- `apps/frontend/src/app/app/reception/route/[routeId]/page.test.tsx` — flow: snapshot loads, scan a barcode → row checks off, scan unknown → discrepancy list grows, finalize → button gated by notes when short.

### Playwright (`apps/frontend/tests/e2e/`)

- `spec47-pickup-route-end-to-end.spec.ts` — full driver flow on tablet viewport.
- `spec47-consolidated-reception.spec.ts` — full hub flow including mixed packages from two manifests scanned in arbitrary order.

---

## Rollout

1. **Migration** ships in its own PR. After merge, deploy migration to staging; verify pgTAP suite green and existing in-transit manifests carry route assignments.
2. **Driver-side UI** ships next (new pages, hooks, route components). Old handoff page deleted in the same PR — the table flip in step 1 already broke its data path, so we cannot leave it half-alive.
3. **Hub-side UI** ships last (new reception pages, deletion of per-manifest reception page).
4. Each PR independently green CI + auto-merge per project rules.

Feature flag is **not** used: the migration is a one-shot table swap, so flag-toggling would not help. The phased PR sequence keeps each merge small and reversible by a follow-up revert PR.

---

## Implementation Plan

(Stories generated by `writing-plans` after spec is approved.)
