# Spec-52: Pickup Route Vehicle, Receptionist-Triggered Reception & Package State Engine

> **Builds on:** [spec-47-pickup-route-and-consolidated-reception.md](spec-47-pickup-route-and-consolidated-reception.md)
> **Related:** [spec-01-epic4a-pickup-verification.md](spec-01-epic4a-pickup-verification.md), [spec-21-reception-visual-polish.md](spec-21-reception-visual-polish.md)

**Status:** backlog

_Date: 2026-08-10_

---

## Goal

Spec-47 shipped the route-level pickup model and it is live in production — but it is not being used, and the scan data it collects drives nothing. This spec closes three gaps that keep it from being the real workflow:

1. **The route is anchored to a vehicle.** A pickup route is created when the truck **leaves the hub**, and carries a real FK to the vehicle that performed it.
2. **The driver never closes the route.** The receptionist scanning the QR on arrival is what opens the reception batch and ends the trip — giving a machine-observed arrival time instead of a driver-remembered one.
3. **The pickup scan moves state.** A single missing trigger has left the entire package/order status pipeline inert since it was built.

### Production evidence motivating this spec

Measured against project `wfwlcpnkkxxzdvhvvsxb` on 2026-08-10:

| Observation | Value |
|---|---|
| `pickup_routes` rows | 8 — of which **7 are `PR-LEGACY-*`** backfill rows sharing one timestamp |
| Real routes ever started | **1** (`PR-2026-0001`, 2026-07-30) |
| `PR-2026-0001` status | still `in_progress` **11 days later** — driver never closed it |
| `vehicle_label` populated | **0 / 8** |
| Manifests at `status='completed'` | **0 / 15** — all frozen at `in_progress` |
| `packages` not at `ingresado` | **0 / 1000** — every package in prod is at the initial state |
| `pickup_scans` / `reception_scans` recorded | 171 / 143 |

Because the DB enforces one active route per driver, `PR-2026-0001` has also blocked its driver from starting any route since 2026-07-30.

### Root cause of the frozen pipeline — read this before designing anything

It is tempting to conclude from "314 scans, 0 packages moved" that nothing consumes scan data. **That is wrong.** Two of the three links already exist and work:

| Link | Status | Evidence |
|---|---|---|
| pickup scan → `packages.status = 'verificado'` | **MISSING** | no trigger on `pickup_scans` anywhere |
| reception scan → `packages.status = 'en_bodega'` | **EXISTS** | `trg_reception_scan_advance_package_status` / trigger `trg_reception_scan_advance_status`, `20260318000001_create_hub_reception_tables.sql:263-288` |
| packages → `orders.status` roll-up | **EXISTS** | `trg_recalculate_order_status` on `packages`, `20260313000003_epic5_functions_and_trigger.sql:89`; function's latest definition `20260810000001_spec51_fix_listo_para_despacho_pipeline_position.sql:61-149` |

The pipeline is frozen because of a **gate in the client-side validator**, not a missing consumer:

`apps/frontend/src/lib/reception/reception-scan-validator.ts:71-78` rejects any package whose status is in `PRE_VERIFICADO_STATUSES`, returning `scan_result: 'not_found'` with `"Paquete no verificado en retiro"`. Since nothing has ever set `verificado`, **every package is `ingresado`, so every reception scan is stored as `not_found`**, so the existing `en_bodega` trigger correctly never fires, so the order roll-up never has an input.

**One missing trigger at link one deadlocks the whole chain.** This spec adds that trigger; the two existing links then work as designed. This is why the state-engine scope below is far smaller than the symptom suggests.

## Non-Goals

- **QR signing.** The QR payload remains a raw `pickup_routes.id` UUID, resolved through RLS. The `PR-YYYY-NNNN` fallback code remains sequential and low-entropy. This is a real weakness (any authenticated user in the tenant who guesses a code can open a reception session) and deserves its own spec — but changing the payload format touches both driver and hub apps and is not bundled here.
- **`drivers` ↔ `users` merge.** `pickup_routes.driver_id` keeps pointing at `users`. The `drivers` table (3 rows, all `"DEV Test Driver"`, all `user_id NULL`) stays unjoined. Merging two identity tables mid-flight doubles the blast radius of this change.
- **Dispatcher pre-planning.** The schema supports a route created by someone other than the driver; no UI is built for it here.
- **Offline capture.** Today's flow is online-only; this spec does not make that worse and does not fix it.
- **Per-carga dwell timing** inside a route (when each individual carga was loaded).
- **Retroactive status backfill** of the 1000 existing packages from scan history.
- **Route optimization / sequencing** — drivers still choose which clients to visit in which order.
- **Changes to the in-manifest scan flow** (`/app/pickup/scan/[loadId]`, `review/`, `complete/`) — including the client signature step, which stays as-is.

## Prerequisites

- spec-01 — `manifests`, `pickup_scans`, package/order status pipeline
- spec-47 — `pickup_routes`, `route_receptions`, `reception_scans`, consolidated reception UI

---

## Architecture

### Route lifecycle

```
Truck departs hub
  └─ Driver selects VEHICLE (required) → route created (in_progress)
       └─ QR available IMMEDIATELY, for the whole trip
            ↓
Client A ─ add carga → scan packages ──┐
Client B ─ add carga → scan packages ──┤  pickup_scans(verified) → packages.status = verificado
Client B ─ add 2nd carga → scan ───────┘
            ↓
Truck returns to hub
  └─ RECEPTIONIST scans QR  ←── hub-side trigger ends the trip; the driver never closes
       │                        (fallback: explicit "Recibir sin QR" + confirmation)
       ├─ creates route_receptions (the ASN batch)
       ├─ pickup_routes.in_transit_at = ARRIVAL (machine-observed)
       ├─ freezes expected_count
       └─ LOCKS the route (no more cargas, no more pickup scans)
            ↓
Receptionist scans packages — flat, any order, never picks a carga
       └─ reception_scans(received) → packages.status = en_bodega
            ↓
Finalize → received_at = FINISH · route received · manifests completed
```

Three statuses do real work: `in_progress` (loading) → `in_transit` (at hub, unloading) → `received` (done), plus `cancelled`. `draft` is unused. One reverse edge exists: `in_transit → in_progress` via `reopen_pickup_route`, for a batch opened by mistake before any unloading. **There is no driver close step.**

### Why the receptionist is the trigger

The close button is the observed failure point: the one real route in production died at exactly that step. A driver has no operational reason to care about a timestamp that matters to the hub. The receptionist, by contrast, must scan the QR to do their job at all — so the state transition rides on an action that is already load-bearing.

The "Recibir sin QR" fallback exists because a QR can be damaged or a camera can fail, but it is deliberately a deliberate act — confirmation dialog, named route and plate — rather than a side effect of navigation. The trip must never end by accident.

This also improves the data. `in_transit_at` currently records *"when the driver remembered to tap a button"*. After this spec it records *"when the truck arrived at the hub"*, which is the number operations actually wants to measure.

**Accepted trade-off:** `expected_count` can no longer be frozen at a driver-controlled close. It is computed inside `open_route_reception` — distinct packages with a `verified` pickup scan at the moment of arrival — and frozen there. The route lock is what makes freezing at that moment safe: once the batch exists, no further pickup scans can change the expectation.

---

## Data Model

### New: `vehicles`

```sql
CREATE TABLE public.vehicles (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  plate        TEXT NOT NULL,
  vehicle_type TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX uniq_vehicles_operator_plate
  ON public.vehicles (operator_id, plate) WHERE deleted_at IS NULL;
```

RLS: `operator_id = public.get_operator_id()`, matching every other tenant table.

#### Why not reuse `fleet_vehicles`

`fleet_vehicles` was the obvious candidate and is the wrong table:

- **84 rows, 0 with a `plate_number`.** All 84 came from DispatchTrack.
- They are identified by strings like `"EASY.CL - ANDRES MELO"` — a *delivery* driver's van mirrored from a provider webhook, not a pickup truck the operator owns.
- It is a **sync mirror**, keyed `UNIQUE(operator_id, provider, external_vehicle_id)` with a `raw_data` JSONB of the webhook payload. Hand-created rows in a webhook-overwritten table is a collision waiting to happen.

`fleet_vehicles` stays exactly what it is: the DispatchTrack mirror for the delivery side. `vehicles` is operator-owned and never synced.

### Changed: `pickup_routes`

| Change | Detail |
|---|---|
| `+ vehicle_id UUID NOT NULL` | `REFERENCES public.vehicles(id)` |
| `+ cancellation_reason TEXT` | nullable; the column `cancel_pickup_route` persists into (today the parameter is discarded) |
| `vehicle_label` | retained, **deprecated**, no longer written. All 8 prod rows are `NULL`; nothing to migrate. |
| `in_transit_at` | semantics change: *driver tapped close* → **truck arrived at hub** |
| `uniq_pickup_routes_one_active_per_driver` | **replaced** — predicate narrowed to `WHERE status = 'in_progress'` (drops `draft`) |
| `uniq_pickup_routes_one_active_per_vehicle` | **new** — `ON (operator_id, vehicle_id) WHERE status = 'in_progress' AND deleted_at IS NULL` |

**Both constraints are kept.** An earlier draft replaced the driver index with the vehicle index and asserted "a driver cannot be in two trucks" as a soft guarantee. That is wrong: `useActivePickupRoute.ts` orders by `started_at DESC` and takes `.limit(1)` (lines 34-35), so a driver with two active routes would silently get the newest one with no error at all. Both invariants are enforced in the database.

### `draft` is removed from the active-route concept

The old index predicate was `status IN ('draft','in_progress')`. `draft` is never produced by any code path in the new flow — `start_pickup_route` creates routes directly as `in_progress`. It is therefore dropped from both index predicates, and correspondingly from `useActivePickupRoute.ts:32` (`.in('status', ['draft','in_progress'])` → `.eq('status','in_progress')`). The enum value itself is retained (dropping enum values is disruptive and it costs nothing to leave).

### Route lock — enforcement mechanism

The lock ("no more cargas, no more pickup scans once `in_transit`") needs an explicit mechanism because **`pickup_scans` are inserted directly from the client, not through an RPC** — `apps/frontend/src/hooks/pickup/usePickupScans.ts:72,75` are raw `supabase.from('pickup_scans').insert(...)`.

Enforcement is a **`BEFORE INSERT` trigger on `pickup_scans`**: join `manifests.pickup_route_id → pickup_routes.status` and `RAISE EXCEPTION` with `ERRCODE = '55000'` (`object_not_in_prerequisite_state`) when the route is not `in_progress`. The client surfaces this as `"La ruta ya fue recibida en bodega"`.

An RLS `WITH CHECK` was considered and rejected: it fails as a generic permission error, which is indistinguishable from a genuine auth problem in the driver UI.

`add_manifest_to_route` needs **no change** — `20260625000001:377-379` already raises on any status `<> 'in_progress'`.

### Unchanged and reused as-is

`route_receptions` **is** the ASN batch — already `UNIQUE(pickup_route_id)`, already carrying `expected_count` / `received_count` / `status` / `started_at` / `completed_at`. **No new reception table.** Only the moment of its creation changes.

Also unchanged: `reception_scans`, `pickup_scans`, `manifests.pickup_route_id`, `discrepancy_notes`, `reception_scan_result_enum` (already has `route_mismatch`).

### RPC changes

| RPC | Change |
|---|---|
| `start_pickup_route` | signature `(p_vehicle_id UUID)` replaces `(p_vehicle_label TEXT)`. Validates that the vehicle **(a)** belongs to the caller's operator, **(b)** has `active = true`, **(c)** has `deleted_at IS NULL`; raises if the vehicle **or** the driver already has an active route. Checks (a)–(c) are what make the migration's `active = false` placeholder unselectable — without them that is an unenforced comment. |
| `reopen_pickup_route` | **NEW** — see Receptionist section |
| `close_pickup_route` | **DROPPED** |
| `open_route_reception(p_route_id UUID)` | **NEW** — see contract below |
| `add_manifest_to_route` | **no change** — existing guard already covers it |
| `cancel_pickup_route` | **persist `p_reason`** into the new `cancellation_reason` column (today discarded, `20260625000001:484`) |
| `get_route_reception_snapshot` | extended to return `vehicle.plate` |
| `complete_route_reception` | unchanged |

#### `open_route_reception(p_route_id UUID)` contract

Called by the receptionist on QR scan. In one transaction:

1. Reject if route status is `received` or `cancelled`.
2. **If a `route_receptions` row already exists for this route → return it unchanged and stop.** Idempotent path: does **not** re-stamp `in_transit_at`, does **not** recompute `expected_count`.
3. Otherwise compute `expected_count` = `COUNT(DISTINCT ps.package_id)` over `pickup_scans` where `scan_result='verified'` on this route's manifests.
4. Insert `route_receptions` with `received_by = auth.uid()` (the receptionist), `delivered_by = route.driver_id` (`NOT NULL` per `20260625000001:72-73`), `status = 'pending'`, `started_at = NOW()`.
5. Set manifests on the route to `reception_status = 'awaiting_reception'`.
6. Set `pickup_routes.in_transit_at = NOW()`, `status = 'in_transit'` — which activates the route lock.

**Step 5 is not optional.** `trg_pickup_routes_status_sync`'s `→ in_transit` branch (`20260625000001:177-196`) does *two* things — flip manifests to `awaiting_reception` **and** create the batch. That entire branch is removed, so `open_route_reception` must take over **both** responsibilities or manifests will never reach `awaiting_reception`.

---

## The State Engine

Scope is deliberately minimal — see the root-cause table above. **One new trigger, one modified trigger, zero changes to the order roll-up.**

### New: `trg_pickup_scan_advance_package_status`

`AFTER INSERT ON public.pickup_scans` — when `NEW.scan_result = 'verified'` and `NEW.package_id IS NOT NULL`, advance the package to `verificado` and set `status_updated_at = NOW()`, subject to the forward-only guard below. Modelled directly on the existing `trg_reception_scan_advance_package_status` for consistency.

This is the link that unblocks the chain.

### Modified: `trg_reception_scan_advance_package_status`

**Not a new trigger.** `CREATE OR REPLACE` of the existing function, using its latest definition (`20260318000001:263-288`) as template per the `CLAUDE.md` rule. The only change is adding the forward-only guard. Its `status_updated_at = NOW()` write is preserved.

### Forward-only guard (shared by both)

Reuses the existing **`pipeline_position(p_status TEXT)`** helper (`20260810000001…:42-57`) rather than defining a new ordinal map. A write occurs only when `pipeline_position(new) > pipeline_position(current)`.

**Critical caveat:** `pipeline_position` returns `0` for any value not in its list. In `package_status_enum` that means `retorno_hub`, `cancelado`, `devuelto`, `dañado`, `extraviado` all rank 0 — so a naive "strictly higher rank wins" would **promote a `cancelado` or `extraviado` package to `verificado`**, exactly the bug the guard exists to prevent.

Therefore the guard is two-part, and both parts are mandatory:

```
TERMINAL_OR_EXCEPTION := ('cancelado','devuelto','dañado','extraviado','retorno_hub')

IF current_status = ANY(TERMINAL_OR_EXCEPTION) THEN RETURN NEW; END IF;   -- never overwrite
IF pipeline_position(new_status) <= pipeline_position(current_status) THEN RETURN NEW; END IF;
```

A package already at `en_ruta` that gets re-scanned stays `en_ruta`. A `cancelado` package is never resurrected.

### Order roll-up — NO CHANGE

`trg_recalculate_order_status` already fires on `packages` status changes and derives both `orders.status` (MIN pipeline position) and `orders.leading_status` (MAX), including the `retorno_hub` / all-terminal / cancel branches. **This spec does not touch it.** Once packages start moving, orders roll up automatically.

Introducing a second roll-up rule on the scan triggers — as an earlier draft of this spec proposed — would create two competing writers on `orders.status` and would drop `leading_status`, `retorno_hub` and `parcialmente_entregado` handling. Explicitly rejected.

### Manifest closure

When `route_receptions` completes, its manifests are set `status = 'completed'` **and `completed_at = NOW()`**, alongside the existing `reception_status = 'received'` (both in the same `UPDATE`, which keeps `trg_manifest_reception_status` — `20260318000001:295-319` — benign since it is guarded by `IF NEW.reception_status IS NULL`).

Note this makes spec-52 a **second** writer of `manifests.status='completed'`. The first is the driver signature flow at `apps/frontend/src/app/app/pickup/complete/[loadId]/page.tsx:116-126`, which is a Non-Goal and stays. The prod symptom of 0/15 completed manifests therefore means drivers are not finishing the signature flow — not that no writer exists. Both writers are idempotent-safe because completion is terminal.

### Chain of custody falls out for free

A package with a pickup scan and no reception scan was loaded but never arrived. That gap **is** the discrepancy report — no extra bookkeeping, no new table.

---

## Screens

### Driver

**`/app/pickup`** — `StartRouteButton` becomes a sheet with one required field: vehicle. New `VehicleSelect` combobox lists active `vehicles` for the operator, with **inline "registrar patente"** for a truck not yet known. The fleet builds itself during the first week of use instead of requiring a setup project up front — which matters because target tenants run on paper and Excel today.

`ActiveRouteBanner` gains a persistent QR affordance. The QR is no longer a screen reached once at the end; it is one tap away for the entire trip, because the receptionist may need it the moment the truck backs into the dock.

**`/app/pickup/route/active`** — keeps `RouteManifestList` + `AddManifestSheet`, but is **not** unchanged. Removals: the `useClosePickupRoute` import (line 14), the `CloseRouteButton` import (line 17), the `closeMut` instantiation (line 33), `handleClose` (lines 67-77) and the fixed bottom action bar (lines 128-136). Line 85 reads `route.vehicle_label` and must switch to the vehicle plate.

**`CloseRouteButton` and `useClosePickupRoute` are deleted.** Nothing replaces them.

**`/app/pickup/route/[routeId]/qr`** — unchanged rendering; now reachable from the banner at any time rather than only as a post-close redirect.

### Receptionist

**`/app/reception`** — two changes, one of which is a regression fix, not an enhancement.

**`RouteQRScannerEntry`:**
1. **Status gate inverts.** Today it rejects anything not already `in_transit` (`"La ruta aún no está en tránsito"`, `RouteQRScannerEntry.tsx:81`; the separate already-received gate is at lines 71-77). It now **accepts `in_progress`** — the normal arriving-truck case — and rejects only `received` and `cancelled`.
2. **Stops reading the table directly.** Today it is a raw `supabase.from('pickup_routes').select()`. It becomes a call to `open_route_reception`, which does the status check, batch creation, arrival stamp and lock in one transaction.

Camera + typed-code dual entry and the `UUID_REGEX` branch are retained.

**`useIncomingRoutes` — MUST change or the hub loses forward visibility.** Its `status` parameter defaults to `'in_transit'` and is typed as the closed union `'in_transit' | 'received'` (`useIncomingRoutes.ts:33`), applied at `.eq('status', status)` (`:50`). `reception/page.tsx:19-22` calls it with `'in_transit'` for the "Rutas entrantes" tab and its KPIs, and again with `'received'` at lines 23-26 for "Completadas". Under the new model a route only reaches `in_transit` *after* the receptionist has scanned its QR — so trucks actually on their way would never appear, and "Rutas entrantes" would silently come to mean "trucks currently being unloaded."

The parameter type must **widen to include `'in_progress'`**.

Resolution — `reception/page.tsx:54-58` goes from three tabs to four, matching the new lifecycle:
- **"Rutas entrantes"** → `status = 'in_progress'`, ordered by `started_at`. Trucks out collecting, not yet arrived. This is the forward visibility the hub actually needs. **Read-only** — see below.
- **"En descarga"** → `status = 'in_transit'`, ordered by `in_transit_at`. Arrived, batch open, being unloaded.
- **"Completadas"** → `status = 'received'`. Unchanged.
- **"Retornos"** → unchanged (spec-43 territory).

KPIs follow: "Rutas entrantes" counts `in_progress`, "Paquetes esperados" continues to sum expected packages across `in_transit` batches (the only routes where a frozen expectation exists).

#### Opening a reception must stay deliberate

`IncomingRoutesList` links to `/app/reception/route/[routeId]`, and `reception/route/[routeId]/page.tsx:48` dereferences `snapshot.route_reception.id`, which does not exist for an `in_progress` route.

**An earlier draft resolved this by calling `open_route_reception` on mount. That is rejected as unsafe.** "Rutas entrantes" now lists trucks *still out collecting*, so a single accidental tap would stamp a false `in_transit_at`, freeze `expected_count` mid-trip, and activate the `pickup_scans` lock — hard-blocking the driver from scanning the rest of their route. It also violates the principle stated under "Why the receptionist is the trigger": **the trip must never end by accident.**

Resolution:
- **`in_progress` rows are read-only.** Tapping one routes to **`/app/reception/route/[routeId]/preview`**, a new page rendering a new **`RoutePreviewCard`** component (code, driver, vehicle plate, cargas so far, packages scanned) with **no** reception session and no side effect.
- That page carries an explicit **`ReceiveWithoutQRButton`** — the manual fallback for a damaged or unscannable QR — behind a confirmation dialog naming the route code and vehicle plate. Only this action, or a QR scan, calls `open_route_reception`.
- **`in_transit` rows** navigate straight into the open session at `/app/reception/route/[routeId]` as today.

#### `reopen_pickup_route(p_route_id UUID)` — NEW

A reception opened by mistake currently has no way back: nothing reverts `in_transit → in_progress`, and `cancel_pickup_route` accepts only `draft`/`in_progress` (`20260625000001:475-477`), so the route cannot even be cancelled to free the vehicle. The driver would be locked out for the rest of the shift.

This RPC reverts the route to `in_progress`, deletes the empty `route_receptions` row, clears `in_transit_at`, and returns manifests to `reception_status = NULL`.

**Guards, in order:**
1. Raises if any `reception_scans` exist for the batch — once real unloading has started, the correct path is to finish and record a discrepancy, not to rewind. (This also keeps the `route_receptions` delete safe against the `reception_scans` FK at `20260625000001:761-763`.)
2. **Pre-checks both active-route unique indexes before reverting.** Returning to `in_progress` re-enters the predicate of `uniq_pickup_routes_one_active_per_driver` *and* `uniq_pickup_routes_one_active_per_vehicle`. If the driver or the vehicle has since started a replacement route — plausible, since being locked out is the reason to reopen — a raw revert raises an opaque `23505`. The RPC checks first and raises a named error: `"El conductor / vehículo ya tiene una ruta activa; cancélela antes de reabrir."`

**Callable by:** receptionist and operations roles. Not the driver — reopening is a hub-side correction.

**`/app/reception/route/[routeId]`** — otherwise unchanged, deliberately. `ReceptionScanner` is a flat input; **the receptionist never picks a carga.** Packages come off in whatever order they ended up in, each scan is matched against every package on the route, and the engine attributes it. This already works — `useReceptionScan.ts:43` passes `manifestId=''` on purpose. `ConsolidatedScanList` shows per-carga progress as **readout only**. `FinalizeReceptionButton` requires discrepancy notes whenever `matched_count <> expected_count` **or** `unexpected_count > 0` (see the notes rule below — the second condition is not a count mismatch in the plain sense). Line 124 passes `vehicle_label` to `RouteReceptionHeader` and must switch to the plate.

### `reception-scan-validator.ts` — required changes

The edge cases below cannot be implemented without changing the validator, which today (a) does not scope by route at all, querying `packages` by `operator_id` + `label` only (lines 51-57), (b) has no `route_mismatch` in its `ReceptionScanResult` union (line 3), and (c) rejects any pre-`verificado` package outright (lines 71-78).

Changes:
- accept a `routeId` and resolve the package's route membership (see join below)
- add `route_mismatch` to `ReceptionScanResult` (the DB enum already has it, added `20260513000002:14`)
- replace the blanket `PRE_VERIFICADO_STATUSES` rejection with the discriminator table below

#### Route membership join — there is no FK for this

**`orders` has no foreign key to `manifests`.** The only linkage is a soft string match on a nullable column:

```
packages.order_id → orders
orders.external_load_id = manifests.external_load_id
  AND orders.operator_id = manifests.operator_id      -- REQUIRED: external_load_id alone is not unique
manifests.pickup_route_id = :routeId
```

`manifests.external_load_id` is `NOT NULL` and unique only as `UNIQUE(operator_id, external_load_id)` (`20260310100000:56,72`). **`orders.external_load_id` is nullable** (`20260223000001:316`) — a package on such an order has no computable route membership and falls through every discriminator row. Defined behaviour: **`not_found`**, message `"Paquete sin carga asociada"`. It cannot be attributed to any route, so accepting it would corrupt the count.

The only other package↔manifest path is *through* `pickup_scans.manifest_id` (`20260310100000:87`), which is unusable here: discriminator **row 7** is defined by the *absence* of a pickup scan.

**Note the coexistence:** `get_route_reception_snapshot` derives its expected-package set from pickup scans (`20260625000001:539-545`), while this validator derives membership from manifests. The two definitions can disagree — a package on a route's manifest that was never pickup-scanned is *member but not expected*. That is exactly discriminator **row 7**, and it is intentional, but both definitions now exist and implementers must not assume they are interchangeable.

### Housekeeping

`apps/frontend/src/app/app/pickup/page.tsx` is **356 lines**, over the 300-line limit in `CLAUDE.md`. Since it is being edited for the vehicle picker, its tab/filter logic is extracted into `PickupManifestTabs`. Scoped to the file already being touched — not a refactor sweep.

### Every `vehicle_label` read site

Deprecating the column means all five live readers switch to the joined `vehicles.plate`, or they render permanently blank:

| File | Line(s) |
|---|---|
| `hooks/reception/useIncomingRoutes.ts` | 9, 19, 44, 62 |
| `components/reception/IncomingRoutesList.tsx` | 40 |
| `hooks/reception/useRouteReceptionSnapshot.ts` | 9 |
| `app/app/reception/route/[routeId]/page.tsx` | 124 |
| `app/app/pickup/route/active/page.tsx` | 85 |

**Net delta:**
- **removed:** `CloseRouteButton`, `useClosePickupRoute`
- **added:** `VehicleSelect`, `PickupManifestTabs`, `RoutePreviewCard`, `ReceiveWithoutQRButton`, page `/app/reception/route/[routeId]/preview`, `useOpenRouteReception`, `useReopenRouteReception`
- **modified:** `useIncomingRoutes` (widened status union, four tabs), `reception-scan-validator.ts` (route membership + 7-row discriminator), `IncomingRoutesList` (status-dependent navigation), `RouteReceptionHeader` (plate, `8/10 esperados · 1 inesperado`), `FinalizeReceptionButton` (mismatch notes), `useRouteReceptionSnapshot` (typed interface must carry `unexpected_count` and the plate — the RPC itself needs no change, since `get_route_reception_snapshot` returns `to_jsonb(rr.*)` at `20260625000001:520-522` and the new column flows through automatically), `lib/types.ts` (regenerated RPC signatures — `types.ts:1818,1825` currently declare `close_pickup_route` and the old `start_pickup_route`)

---

## Edge Cases

### Reception scan discriminator

An earlier draft listed "not on this route → rejected" and "no driver pickup scan → accepted" as separate rows, which describe the same observable input with opposite outcomes. The discriminator is **route membership, not scan history**, evaluated in this order:

| # | Condition | Result | Rationale |
|---|---|---|---|
| 1 | label matches no package for this operator | `not_found` | genuinely unknown barcode |
| 2 | package already scanned in this batch | `duplicate` | existing behaviour, unchanged |
| 3 | `orders.external_load_id IS NULL` (no computable membership) | `not_found` — `"Paquete sin carga asociada"` | cannot be attributed to any route |
| 4 | package status ∈ `ALREADY_RECEIVED_STATUSES` | `not_found` — `"Paquete ya fue recibido en bodega"` | **survives from today** unchanged (`reception-scan-validator.ts:80-87`, constant at lines 20-25). Prevents double-receiving a package from a prior route. Note this is a **12-value list, not an ordinal range** — it includes `cancelado`, `devuelto`, `dañado`, `extraviado`, which are rank 0 under `pipeline_position` and therefore *not* "beyond" `en_bodega`. Reference the constant; do not re-derive it from rank. |
| 5 | package belongs to a manifest on **another** route | `route_mismatch` | wrong truck — rejected, no count change |
| 6 | on **this** route, **with** a `verified` pickup scan | `received` | the normal path |
| 7 | on **this** route, **without** a `verified` pickup scan | `received`, flagged **unexpected** | physically present; refusing it would force the receptionist to lie to the system |

Row 7 replaces today's blanket `"Paquete no verificado en retiro"` rejection. Row 4 is retained deliberately — an earlier draft dropped it by implication, which would have allowed a package received on a previous route to be counted again.

#### Over-count is now a normal outcome

Row 7 counts toward `received_count` while `expected_count` was frozen at arrival, so **`received_count > expected_count` is expected behaviour**, not an anomaly. Today nothing handles this: `complete_route_reception` requires notes only when `received < expected` (`20260625000001:589-593`), and `FinalizeReceptionButton` mirrors that.

Required:
- `route_receptions` gains **`unexpected_count INT NOT NULL DEFAULT 0`**, incremented by the existing `trg_reception_scans_route_count` trigger (`20260625000001:289`, body at `:267-283`) via `CREATE OR REPLACE`.

**How the trigger identifies a row-7 scan.** It cannot read one off the row: `reception_scans` has no unexpected flag, and rows 6 and 7 both write `scan_result = 'received'`. The trigger therefore **re-derives it server-side**:

```sql
-- unexpected := this package has no verified pickup scan on this route
NOT EXISTS (
  SELECT 1 FROM public.pickup_scans ps
  JOIN public.manifests m ON m.id = ps.manifest_id
  WHERE ps.package_id = NEW.package_id
    AND m.pickup_route_id = <route of NEW.reception_id>
    AND ps.scan_result = 'verified'
)
```

Note this uses `pickup_scans.manifest_id` directly (`20260310100000:87`) and so does **not** duplicate the validator's `external_load_id` join — the two are asking different questions (*was it scanned at pickup?* vs *does it belong to this route?*).

A `reception_scans.was_unexpected` column written by the client was considered and rejected: it would make the count client-attested, and the count feeds a discrepancy report.
#### The notes rule must not let discrepancies cancel out

A naive `received_count <> expected_count` check is **wrong**, because row-7 packages increment `received_count` as well as `unexpected_count`, so the two error modes offset:

> 10 expected · 10 received, of which 1 unexpected → `received_count == expected_count` → no notes demanded — yet one expected package never arrived *and* one package that belongs on another truck did.

That is the single most likely real-world shape (a package mis-loaded at one client while another is left behind) and exactly what the discrepancy report exists to catch. The correct rule separates the populations:

```
matched_count := received_count - unexpected_count   -- packages that were expected AND arrived

notes required when  matched_count <> expected_count  OR  unexpected_count > 0
```

- `complete_route_reception` enforces the rule above.
- `FinalizeReceptionButton` prompts on the same condition — under-count, over-count, and the offsetting case alike.

#### What the receptionist sees

Since `expected_count` and `received_count` now measure different populations, the header must not present them as a single fraction. `RouteReceptionHeader` renders **`8/10 esperados · 1 inesperado`** — matched against expected, with the unexpected set called out separately whenever `unexpected_count > 0`. The "Paquetes esperados" KPI on `/app/reception` continues to mean expected packages across open `in_transit` batches.

### Other cases

| Case | Handling |
|---|---|
| Two receptionists scan the same QR | `open_route_reception` idempotent — second caller receives the existing batch, no re-stamp |
| Receptionist opens route from "Rutas entrantes" list instead of QR | Read-only detail view, **no side effect**. Opening a batch requires the explicit "Recibir sin QR" action behind its confirmation dialog. |
| Reception opened by mistake, before any unloading | `reopen_pickup_route` reverts it and unblocks the driver |
| Reception opened by mistake, after unloading started | Refused — finish the batch and record a discrepancy instead |
| Driver scans after arrival | Rejected by the `BEFORE INSERT` trigger on `pickup_scans`, `ERRCODE 55000` |
| Truck never returns | Ops cancels via `cancel_pickup_route`, **reason now persisted**; frees the vehicle |
| Vehicle already on an active route | `start_pickup_route` raises `23505` |
| Route cancelled with cargas attached | Existing behaviour retained — manifests detached (`pickup_route_id = NULL`) |
| Driver has no vehicle registered | Inline plate creation in `VehicleSelect`; no dead end |

---

## Migration

`vehicle_id` is `NOT NULL`, so the three open production routes must be resolved in the same migration.

1. **Placeholder vehicle** per operator: `plate = 'SIN-REGISTRO'`, `active = false` — so it can never be selected for a new route.
2. **`PR-LEGACY-000006` / `PR-LEGACY-000007`** (`in_transit`, one manifest each, `awaiting_reception`): assign the placeholder, **leave `in_transit`** so a receptionist can still complete them through the normal flow.
3. **`PR-2026-0001`** (`in_progress` since 2026-07-30, manifest `45019456`, never advanced): assign the placeholder, then **cancel** — writing `cancellation_reason = 'ruta abandonada — migración spec-52'` into the new column — and detach its manifest. This unblocks its driver, who has been unable to start a route for 11 days.
4. **Remaining 5 `received` legacy routes:** assign the placeholder; terminal, no other change.

**Packages are not retro-statused.** Backfilling 1000 rows from scan history would fabricate transition timestamps for events that cannot be reconstructed. The state engine starts clean from migration forward. Existing packages advance naturally the next time they are scanned, and the forward-only guard makes that safe.

---

## Testing

TDD per `CLAUDE.md` — tests first, at every layer.

### Existing tests that this spec BREAKS — must be updated, not just added to

`vehicle_id NOT NULL` plus dropping `close_pickup_route` breaks the following. All insert `pickup_routes` directly or call the dropped RPC:

| File | Breakage |
|---|---|
| `tests/spec47_close_route_zero_packages_fails.sql:38` | calls dropped `close_pickup_route` — **rewrite** against `open_route_reception` |
| `tests/spec47_single_active_route_per_driver.sql:26,34,45,51` | inserts without `vehicle_id`; tests the old index predicate |
| `tests/spec47_close_route_creates_route_reception.sql:44` | calls dropped RPC — rewrite for `open_route_reception` |
| `tests/spec47_cancel_route_detaches_manifests.sql` | inserts without `vehicle_id` |
| `tests/spec47_complete_route_cascades_manifest_status.sql` | inserts without `vehicle_id` |
| `tests/spec47_reception_scan_increments_count.sql` | inserts without `vehicle_id` |
| `tests/spec47_pickup_routes_rls.sql:62` | inserts without `vehicle_id` |
| `hooks/pickup/useClosePickupRoute.test.ts` | **delete** with its hook |
| `components/pickup/CloseRouteButton.test.tsx` | **delete** with its component |
| `app/app/pickup/route/active/page.test.tsx:19,48-49` | mocks the deleted hook; asserts `vehicle_label` |
| `hooks/pickup/useStartPickupRoute.test.ts:40` | asserts `{ p_vehicle_label: 'AAA-111' }` — RPC signature changed |
| `docs/qa-test-scope.md:63` | QA row 2.6 is written around `close_pickup_route` — **update** (coordinate with spec-51 QA work) |

Frontend tests asserting on `vehicle_label`, which stops being written:

| File | Line(s) |
|---|---|
| `hooks/reception/useIncomingRoutes.test.ts` | 40, 73 |
| `hooks/reception/useRouteReceptionSnapshot.test.ts` | 32 |
| `components/reception/IncomingRoutesList.test.tsx` | 12 |
| `app/app/reception/route/[routeId]/page.test.tsx` | 37 |
| `app/app/reception/page.test.tsx` | 8, 13 |

(`tests/pre_route_snapshot.test.sql` was listed in an earlier draft and is **not** affected — it contains no reference to `pickup_routes`.)

### New pgTAP (`packages/database/supabase/tests/`)

- forward-only: re-scanning an `en_ruta` package leaves it `en_ruta`
- forward-only: a `cancelado` package is **not** promoted to `verificado` (the rank-0 trap)
- forward-only: same for `extraviado`, `devuelto`, `dañado`, `retorno_hub`
- new pickup trigger: `verified` scan moves `ingresado` → `verificado` and sets `status_updated_at`
- **integration:** pickup scan → `verificado` → reception scan now passes the validator → `en_bodega` → existing `trg_recalculate_order_status` rolls the order up. This is the chain the spec exists to close; it must be asserted end to end.
- `open_route_reception`: idempotent (same `route_receptions.id`, `in_transit_at` **not** re-stamped)
- `open_route_reception`: freezes `expected_count` from `verified` pickup scans
- `open_route_reception`: sets manifests to `awaiting_reception` (the responsibility inherited from the removed trigger branch)
- route lock: `pickup_scans` insert rejected with `55000` once `in_transit`
- `uniq_pickup_routes_one_active_per_vehicle` raises on second active route per vehicle
- `uniq_pickup_routes_one_active_per_driver` still raises on second active route per driver
- `cancel_pickup_route` persists into `cancellation_reason`
- manifest reaches `status='completed'` **and** `completed_at` on reception completion
- `start_pickup_route` rejects an inactive, soft-deleted, or other-operator vehicle
- `reopen_pickup_route` reverts an empty batch and restores the driver's ability to scan
- `reopen_pickup_route` **raises** once any `reception_scans` exist
- `reopen_pickup_route` raises a **named** error (not a bare `23505`) when the driver or vehicle already has a replacement active route
- `unexpected_count` derivation: a package with a `verified` pickup scan on the route does **not** increment it; one without does
- `unexpected_count` increments on a row-7 scan
- `complete_route_reception` demands notes on under-count, on over-count, **and on the offsetting case** (10 expected · 10 received · 1 unexpected must still demand notes — the regression this rule exists to prevent)
- `complete_route_reception` accepts without notes only when `matched_count = expected_count AND unexpected_count = 0`
- RLS: `vehicles` isolated per `operator_id`
- migration: the 3 open prod routes land in their specified end states

### Hooks / lib

- `useStartPickupRoute` passes `vehicleId`
- `useOpenRouteReception` — success, idempotent replay, rejected `received` route
- `useIncomingRoutes` — `in_progress` for entrantes, `in_transit` for en descarga, `received` for completadas
- `reception-scan-validator` — one test per row of the 7-row discriminator table, including the NULL `external_load_id` fall-through
- `useReopenRouteReception` — success and blocked-by-scans paths

### Components

- `VehicleSelect` — lists active only, inline plate creation, required validation
- `RouteQRScannerEntry` — accepts `in_progress`, rejects `received` / `cancelled`
- `ActiveRouteBanner` — QR reachable while `in_progress`
- `IncomingRoutesList` — `in_progress` rows navigate to `/preview` and cause **no** side effect; `in_transit` rows go to the open session
- `RoutePreviewCard` — renders route detail with no reception session created
- `ReceiveWithoutQRButton` — no RPC call until the confirmation dialog is accepted; dialog names route code and plate
- `FinalizeReceptionButton` — prompts for notes on under-count, over-count, **and the offsetting case** (`matched_count = expected_count` but `unexpected_count > 0`)
- `RouteReceptionHeader` — shows plate, and the unexpected count when non-zero

### E2E

Depart hub with vehicle → 2 clients / 3 cargas → scan packages → arrive → receptionist scans QR → scan packages flat and out of carga order → finalize. Assert: packages `en_bodega`, orders rolled up, manifests `completed`, route `received`, `in_transit_at` ≈ QR scan time, `received_at` ≈ finalize time.

---

## Open Follow-ups (not in this spec)

- **Signed QR tokens** — replace the raw-UUID payload and the sequential `PR-YYYY-NNNN` code with a possession proof.
- **`drivers` ↔ `users` reconciliation** — two disjoint driver identities.
- **Spec-number drift** — `docs/architecture/phased-rollout-strategy.md:219-221` assigns spec-48/49/50 to Ops Control visibility, late-order alerts and DispatchTrack reconciliation, but `docs/specs/` has spec-48 as the VPS QA environment and spec-49 as the Easy webhook guide URL. The same table also double-claims **spec-47** as "Ops Control preset architecture" while `docs/specs/spec-47` is Pickup Route & Consolidated Reception. Four numbers claimed by two different things; spec-50 is reserved but unwritten. Needs reconciling before anyone builds off that table.
- **`docs/specs/spec-47` status line** — still says `backlog` despite being merged and live in production.
- **Dispatcher pre-planning UI** on top of the existing schema support.
