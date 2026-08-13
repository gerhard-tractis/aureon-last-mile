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
3. **The pickup scan moves state on the server, under a guard.** Today it is moved by an *unguarded client-side write*, which can resurrect cancelled and lost packages.

### Production evidence motivating this spec

Measured against project `wfwlcpnkkxxzdvhvvsxb`, **re-measured and corrected 2026-08-11**:

| Observation | Value |
|---|---|
| `pickup_routes` rows | 8 — of which **7 are `PR-LEGACY-*`** backfill rows sharing one timestamp |
| Real routes ever started | **1** (`PR-2026-0001`, 2026-07-30) |
| `PR-2026-0001` status | still `in_progress` **11 days later** — driver never closed it |
| `vehicle_label` populated | **0 / 8** |
| Manifests at `status='completed'` | **0 / 15** — all frozen at `in_progress` |
| `pickup_scans` recorded | 171 (160 `verified`, 9 `not_found`, 2 `duplicate`) |
| `reception_scans` recorded | 143 |

> ### ⚠️ Correction — the original version of this spec was wrong about the pipeline
>
> The first draft claimed **"0 / 1000 packages have left `ingresado`; 314 scans moved nothing; the pipeline has been deadlocked since it was built."** That was a **measurement error**: the Supabase REST API caps responses at 1000 rows (`max_rows = 1000`, `packages/database/supabase/config.toml`), and a single page was mistaken for the whole table.
>
> Actual figures: **59,334 packages** — 59,174 `ingresado`, **17 `verificado`**, **142 `en_bodega`**, 1 `sectorizado`. Orders: 45,230 `entregado`. The ~159 packages past `ingresado` correspond closely to the 160 `verified` pickup scans.
>
> **The status pipeline works and has been working.** All three links function:
>
> | Link | Reality |
> |---|---|
> | pickup scan → `verificado` | **exists in the CLIENT** — `apps/frontend/src/hooks/pickup/usePickupScans.ts:86-96`, shipped `65b39e0` on 2026-03-18. `packageIds` is populated for single-package matches too (`scan-validator.ts:72`), so it fires on every verified scan. |
> | reception scan → `en_bodega` | exists — `trg_reception_scan_advance_package_status`, `20260318000001:263-288` |
> | packages → `orders.status` roll-up | exists — `trg_recalculate_order_status`, `20260313000003:89` |
>
> The claim that reception scans were all stored as `not_found` (via the `PRE_VERIFICADO_STATUSES` gate at `reception-scan-validator.ts:71-78`) was also wrong — 142 packages reached `en_bodega`, so those scans were stored as `received` and the trigger fired.

### The real problem with link one

The pickup→`verificado` write is **client-side and unguarded**:

```ts
// usePickupScans.ts:86-96
if (result.scanResult === 'verified' && result.packageIds.length > 0) {
  await supabase.from('packages')
    .update({ status: 'verificado', status_updated_at: ... })
    .in('id', result.packageIds);
}
```

It has no forward-only check, so scanning a `cancelado`, `extraviado`, `devuelto`, `dañado` or `retorno_hub` package at pickup **silently resurrects it to `verificado`**. It is also unscoped by `operator_id` beyond RLS, and it writes package state from the browser rather than from the scan record.

This spec replaces it with a `SECURITY DEFINER` trigger on `pickup_scans` carrying the forward-only guard (see The State Engine). **The client write MUST be deleted in the same release** — otherwise the trigger blocks the resurrection and the client performs it one statement later, and the guard buys nothing.

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

Scope is deliberately minimal. **One new trigger, one modified trigger, one client-side write deleted, zero changes to the order roll-up.**

### New: `trg_pickup_scan_advance_package_status`

`AFTER INSERT ON public.pickup_scans` — when `NEW.scan_result = 'verified'` and `NEW.package_id IS NOT NULL`, advance the package to `verificado` and set `status_updated_at = NOW()`, subject to the forward-only guard below. Modelled directly on the existing `trg_reception_scan_advance_package_status` for consistency.

This does not *add* a missing link — it **moves an existing client-side link onto the server and puts a guard on it**. See the correction box above.

### Deleted: the client-side write in `usePickupScans.ts:86-96`

Must land in the same release as the trigger. If the trigger ships alone, the guard is inert: it refuses to promote a `cancelado` package, and the client's `.update()` promotes it on the very next statement. If the client write ships removed without the trigger, packages stop advancing at pickup entirely. **They are one change.**

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
- `route_receptions` gains **`unexpected_count INT NOT NULL DEFAULT 0`**, incremented by the existing counting trigger via `CREATE OR REPLACE` of its **function**, `public.trg_reception_scans_route_received_count()` (`20260625000001:267-283`) — not the trigger `trg_reception_scans_route_count` (`:289`), which is only the binding.

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
| `tests/spec47_close_route_creates_route_reception.sql:44` | inserts without `vehicle_id`; and creates the batch via a **raw `status` flip**, not the RPC — so removing the trigger branch breaks it too. Rewrite for `open_route_reception`. |
| `tests/spec47_complete_route_cascades_manifest_status.sql:55` | same raw-status-flip dependency — `route_receptions` row will not exist |
| `tests/spec47_reception_scan_increments_count.sql:54` | same; raises `'route_receptions row missing after route close'` |
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
- ~~**Spec-number drift**~~ — **resolved 2026-08-11.** The rollout map's three unbuilt Ops-Control items moved to spec-53/54/55; the merged on-disk specs keep 47/48/49; spec-50 stays reserved.
- ~~**`docs/specs/spec-47` status line**~~ — **resolved 2026-08-11**, corrected to `in progress` (awaiting user confirmation for `completed`).
- **Dispatcher pre-planning UI** on top of the existing schema support.
- **The forward-only guard is not globally authoritative — and must not be described as if it were.** `spec52_may_advance_status` protects exactly two paths: the `pickup_scans` and `reception_scans` triggers. Seven other code paths write `packages.status` directly and bypass it entirely:
  - `hooks/distribution/useRedirectBatchScan.ts` (`retenido`)
  - `hooks/distribution/useConsolidation.ts`
  - `app/api/dispatch/routes/[id]/scan/route.ts`
  - `app/api/dispatch/routes/[id]/route.ts`
  - `app/api/dispatch/routes/[id]/packages/[pkgId]/route.ts`
  - `app/api/dispatch/routes/[id]/dispatch/route.ts`
  - `app/api/dispatch/routes/[id]/close/route.ts`

  These are deliberate later-stage transitions (dispatch/distribution), not scan-driven, so they are out of spec-52's scope and are **not** known to be buggy. But nothing stops one of them regressing a package, and a reader who sees "forward-only guard" in the migration could reasonably assume the invariant holds table-wide. It does not. Making it table-wide would mean a `BEFORE UPDATE` trigger on `packages` — a much larger blast radius that deserves its own spec and its own audit of all seven call sites.

---
---

# Implementation Plan

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anchor pickup routes to a vehicle, move the end-of-trip trigger from the driver to the receptionist, and add the one missing trigger that unblocks the package/order status pipeline.

**Architecture:** Seven database migrations applied bottom-up (additive first, breaking changes atomic with their test fixups) across Tasks 1-6 and 11, then seven frontend tasks (7-13). Each task ends green — a task that breaks an existing test fixes it in the same commit.

**Tech Stack:** Postgres/Supabase (migrations + pgTAP), Next.js App Router, React Query, Vitest, Tailwind/shadcn.

## Conventions for every task

| Thing | Value |
|---|---|
| Migrations dir | `packages/database/supabase/migrations/` |
| Migration naming | `YYYYMMDDHHMMSS_spec52_<slug>.sql` — this plan reserves `20260812000001`–`20260812000007` (latest existing is `20260810000002`, so ordering is monotonic) |
| pgTAP dir | `packages/database/supabase/tests/` |
| Frontend tests | colocated `*.test.ts(x)`, Vitest |
| Run one frontend test | `npx vitest run <path> --reporter=verbose` (from `apps/frontend`) |
| Run full CI locally | `npx turbo run lint type-check test:run build` |
| Run a pgTAP file | `psql "$DATABASE_URL" -f packages/database/supabase/tests/<file>.sql` |

**Important — pgTAP is not run by CI.** `.github/workflows/ci.yml` runs only lint, type-check, `test:run`, build. pgTAP files must be run manually against a local/branch database. **Never assume a green PR means the SQL is correct** — and per `deploy.yml`, the migration job is path-filtered, so also confirm the "Verify Production Migrations" drift job actually ran.

**Two generated type files** must both be refreshed when an RPC signature changes: `packages/database/src/database.types.ts` and `apps/frontend/src/lib/types.ts` (`:1818,1825` declare the RPCs this spec changes).

> ⚠️ **Do NOT run `npm run generate-types` while implementing this spec.** It is `supabase gen types typescript --project-id $SUPABASE_PROJECT_REF` — i.e. it generates against **production**, which will not contain any spec-52 migration until after deploy. Running it would overwrite both files with stale types and silently revert your work. Generate against a local `supabase db reset` or a branch database instead, and hand-apply the diff.

**Rule for every commit:** `npx turbo run lint type-check test:run build` passes before you commit. A task that deletes a hook deletes its test in the same commit.

---

## Chunk 1: Database

### Task 1: `vehicles` table

Purely additive. Nothing references it yet.

**Files:**
- Create: `packages/database/supabase/migrations/20260812000001_spec52_vehicles_table.sql`
- Create: `packages/database/supabase/tests/spec52_vehicles_rls.sql`

- [ ] **Step 1: Write the failing pgTAP test**

`spec52_vehicles_rls.sql` — model it on the existing `spec47_pickup_routes_rls.sql`. Assert: (a) the table exists, (b) operator A cannot select operator B's vehicle, (c) the partial unique index rejects a duplicate plate for the same operator but allows the same plate after soft-delete.

- [ ] **Step 2: Run it, confirm it fails**

`psql "$DATABASE_URL" -f packages/database/supabase/tests/spec52_vehicles_rls.sql`
Expected: fails — relation `public.vehicles` does not exist.

- [ ] **Step 3: Write the migration**

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

CREATE INDEX idx_vehicles_operator_active
  ON public.vehicles (operator_id) WHERE active AND deleted_at IS NULL;

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY vehicles_operator_isolation ON public.vehicles
  FOR ALL USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

COMMENT ON TABLE public.vehicles IS
  'Operator-owned pickup fleet (spec-52). Distinct from fleet_vehicles, which mirrors DispatchTrack delivery vehicles and carries no plate data.';
```

Copy the `updated_at` trigger pattern from a neighbouring migration.

- [ ] **Step 4: Re-run the test — expect PASS**
- [ ] **Step 5: Commit** — `feat(spec-52): add operator-owned vehicles table`

---

### Task 2: forward-only guard + the missing pickup trigger

**Moves the pickup→`verificado` write from the client onto the server, under a forward-only guard.** Pairs with Task 2b, which deletes the client write — see the correction box near the top of this spec. The pipeline is not deadlocked; the write is simply unguarded and in the wrong place.

**Files:**
- Create: `20260812000002_spec52_package_state_engine.sql`
- Create: `packages/database/supabase/tests/spec52_state_engine.sql`

- [ ] **Step 1: Write the failing tests** — five cases:
  1. `verified` pickup scan moves a package `ingresado → verificado` and sets `status_updated_at`
  2. a package at `en_ruta` re-scanned stays `en_ruta` (rank guard)
  3. a package at `cancelado` scanned stays `cancelado` (**the rank-0 trap** — `pipeline_position` returns 0 for it, so a naive `>` comparison would promote it)
  4. same for `extraviado`, `devuelto`, `dañado`, `retorno_hub`
  5. **integration:** pickup scan → `verificado` → reception scan → `en_bodega` → `orders.status` rolls up via the *existing* `trg_recalculate_order_status`

- [ ] **Step 2: Run, confirm cases 1 and 5 fail** (2–4 vacuously pass today because nothing moves at all — note this in the test comments so a later reader doesn't mistake them for coverage)

- [ ] **Step 3: Write the migration**

```sql
-- Shared guard. Returns true when p_new may overwrite p_current.
CREATE OR REPLACE FUNCTION public.spec52_may_advance_status(
  p_current TEXT, p_new TEXT
) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_current IN ('cancelado','devuelto','dañado','extraviado','retorno_hub')
      THEN false                                    -- terminal/exception: never overwrite
    ELSE pipeline_position(p_new) > pipeline_position(p_current)
  END;
$$;

COMMENT ON FUNCTION public.spec52_may_advance_status IS
  'Forward-only guard (spec-52). The terminal check MUST precede the rank comparison: pipeline_position returns 0 for cancelado/devuelto/dañado/extraviado/retorno_hub, so a bare > would resurrect them.';

CREATE OR REPLACE FUNCTION public.trg_pickup_scan_advance_package_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.scan_result = 'verified' AND NEW.package_id IS NOT NULL THEN
    UPDATE public.packages
       SET status = 'verificado', status_updated_at = NOW()
     WHERE id = NEW.package_id
       AND public.spec52_may_advance_status(status::text, 'verificado');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pickup_scan_advance_status
  AFTER INSERT ON public.pickup_scans
  FOR EACH ROW EXECUTE FUNCTION public.trg_pickup_scan_advance_package_status();
```

Then `CREATE OR REPLACE` the **existing** `trg_reception_scan_advance_package_status`, using its definition at `20260318000001:263-288` as the template (per the `CLAUDE.md` rule), adding `AND public.spec52_may_advance_status(status::text, 'en_bodega')` to its `WHERE`. Keep its `status_updated_at` write.

**Do not touch `recalculate_order_status`.** It already handles the roll-up.

- [ ] **Step 4: Re-run — all five pass**
- [ ] **Step 5: Commit** — `feat(spec-52): add pickup scan state trigger and forward-only guard`

### Task 2b: delete the client-side `verificado` write

**Must land in the same PR as Task 2.** The guard is inert while this code exists — the trigger refuses to promote a `cancelado` package and the client promotes it one statement later.

**Files:**
- Modify: `apps/frontend/src/hooks/pickup/usePickupScans.ts:86-96` — delete the `.from('packages').update({ status: 'verificado' })` block entirely
- Modify: `apps/frontend/src/hooks/pickup/usePickupScans.test.ts` — any test asserting the client performs that update must be replaced

- [ ] **Step 1: Update the test first** — assert the hook inserts the `pickup_scans` row and does **not** issue a `packages` update. It should fail against current code.
- [ ] **Step 2: Run it, confirm it fails**
- [ ] **Step 3: Delete the block.** Keep the `pickup_scans` insert and `playFeedback` untouched.
- [ ] **Step 4: `npx turbo run lint type-check test:run build` green**
- [ ] **Step 5: Commit** — `fix(spec-52)!: move verificado write server-side under the forward-only guard`

**Behavioural note for the release:** after this pair lands, a package's advance to `verificado` is driven by the `pickup_scans` row rather than a separate client call. Any package at a terminal status (`cancelado`, `devuelto`, `dañado`, `extraviado`, `retorno_hub`) will **stop** being silently promoted — that is the intended fix, and it will look like a behaviour change to anyone who relied on re-scanning to revive a cancelled parcel. There is no evidence anyone does, but it is worth saying in the release note.

---

### Task 3: vehicle FK, cancellation reason, indexes — and every test that breaks

**Atomic.** `vehicle_id NOT NULL` breaks **seven** pgTAP files; they are fixed in this commit or the suite is red.

**Files:**
- Create: `20260812000003_spec52_pickup_routes_vehicle.sql`
- Modify (**all seven** insert `pickup_routes` directly and break under `NOT NULL`): `tests/spec47_pickup_routes_rls.sql:62`, `spec47_single_active_route_per_driver.sql:26,34,45,51`, `spec47_cancel_route_detaches_manifests.sql`, `spec47_complete_route_cascades_manifest_status.sql`, `spec47_reception_scan_increments_count.sql`, `spec47_close_route_creates_route_reception.sql:44`, `spec47_close_route_zero_packages_fails.sql:25`
- Create: `tests/spec52_vehicle_constraints.sql`

> `spec47_close_route_zero_packages_fails.sql` is rewritten later in Task 5, but it must still be made to compile **here** — Task 3's "whole suite green" claim is otherwise false at this commit.

- [ ] **Step 1: Write the failing test** (`spec52_vehicle_constraints.sql`): `start_pickup_route` rejects an inactive vehicle, a soft-deleted vehicle, and another operator's vehicle; both unique indexes raise on a second active route.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Migration** — backfill first, then constrain:
  1. insert a per-operator placeholder `('SIN-REGISTRO', active=false)` for every operator that owns a `pickup_routes` row
  2. `ALTER TABLE public.pickup_routes ADD COLUMN vehicle_id UUID REFERENCES public.vehicles(id)`, `ADD COLUMN cancellation_reason TEXT`
  3. `UPDATE` all existing routes to the placeholder
  4. `ALTER COLUMN vehicle_id SET NOT NULL`
  5. drop `uniq_pickup_routes_one_active_per_driver`; recreate it with predicate `WHERE status = 'in_progress' AND deleted_at IS NULL` (drops `draft`); add `uniq_pickup_routes_one_active_per_vehicle` with the same predicate
  6. `CREATE OR REPLACE start_pickup_route(p_vehicle_id UUID)` — validates the vehicle belongs to `get_operator_id()`, is `active`, and `deleted_at IS NULL`; keeps the existing `PR-YYYY-NNNN` allocation and 3-retry collision logic. **Narrow its internal active-route re-check** from `status IN ('draft','in_progress')` (`20260625000001:337`) to `'in_progress'`, or it reports "driver already has an active route" for a case the new index no longer covers. **`DROP FUNCTION` the old `(p_vehicle_label TEXT)` signature** — Postgres would otherwise keep both as overloads — and drop its now-dangling `COMMENT ON FUNCTION public.start_pickup_route(TEXT)` (`:350`).
  7. `CREATE OR REPLACE cancel_pickup_route` writing `p_reason` into `cancellation_reason`
- [ ] **Step 4: Fix all seven existing pgTAP files** — add `vehicle_id` to every direct `INSERT INTO public.pickup_routes`, creating a vehicle fixture per file. Update `spec47_single_active_route_per_driver.sql` for the narrowed predicate.
- [ ] **Step 5: Run the whole pgTAP suite — all green**
- [ ] **Step 6: Commit** — `feat(spec-52): anchor pickup routes to a vehicle FK`

---

### Task 4: production route reconciliation

Separate migration so it can be reasoned about and rolled back independently of the schema change.

**Files:**
- Create: `packages/database/supabase/migrations/20260812000004_spec52_reconcile_open_routes.sql`
- Create: `packages/database/supabase/tests/spec52_migration_reconciliation.sql`

- [ ] **Step 1: Write the assertion test** — it must **seed its own fixtures matching the migration's predicates**, not the production rows. On a clean database `PR-2026-0001` and `PR-LEGACY-*` do not exist, so prod-keyed assertions would pass vacuously and prove nothing. Seed: one route `in_progress` with `started_at < '2026-08-01'` (expect cancelled + reason + manifest detached), one `in_progress` with a recent `started_at` (expect untouched), one `in_transit` (expect untouched).

> The prod-row outcomes (`PR-LEGACY-00000[67]` still `in_transit`, `PR-2026-0001` cancelled) are a **manual post-deploy verification**, not a pgTAP assertion.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Migration** — idempotent and **keyed on data, not on hardcoded UUIDs** (the prod IDs are not present in a fresh local DB, so guard every statement with `WHERE EXISTS`):
  - leave `in_transit` legacy routes alone (a receptionist can still finish them)
  - cancel any route still `in_progress` with `started_at < '2026-08-01'`, set `cancellation_reason = 'ruta abandonada — migración spec-52'`, detach its manifests (`pickup_route_id = NULL`)
- [ ] **Step 4: Re-run — PASS**
- [ ] **Step 5: Commit** — `fix(spec-52): reconcile abandoned production pickup routes`

**Do not backfill package statuses.** Reconstructing transition timestamps from scan history would fabricate data. The engine starts clean; the forward-only guard makes the first real scan safe.

---

### Task 5: receptionist trigger — `open_route_reception`, route lock, reopen

> ## ⚠️ RE-SCOPED DURING IMPLEMENTATION — this task is now EXPAND-ONLY
>
> The text below (drop `close_pickup_route`, remove the trigger's `→ in_transit` branch, delete `CloseRouteButton`, rewrite four spec47 tests) describes the **original** plan. It was not implemented that way, and it must not be.
>
> **Why:** the database chunk ships ahead of the frontend. Dropping close in this task would *deadlock* production, not merely degrade it — drivers would lose the close button, `close_pickup_route` would be gone, but the reception UI still gates on `status='in_transit'`, which today only happens via close. Routes could never reach reception at all.
>
> **What actually shipped** (migration `20260812000005`, commit `a901eab`):
> - `open_route_reception`, `reopen_pickup_route`, and the `pickup_scans` route-lock trigger — all added
> - `close_pickup_route` **kept and working**
> - the trigger's `→ in_transit` branch **kept** — it is what makes close still work
> - **no frontend file touched**
> - deploy-time post-conditions that abort the migration if either has already been removed, as a tripwire against the contract phase landing out of order
>
> Both paths coexist safely: a driver-closed route gets its batch from the trigger, and `open_route_reception` detects it and returns the same row rather than inserting a second (which `uniq_route_receptions_pickup_route` would reject).
>
> **The removals move to the contract phase, Task 8.** See "Expand/contract release plan" below.

**Files:**
- Create: `20260812000005_spec52_receptionist_trigger.sql`
- Create: `tests/spec52_open_route_reception.sql`, `tests/spec52_route_lock.sql`, `tests/spec52_reopen_route.sql`
- **Rewrite (not delete — keep the coverage), all four:** `tests/spec47_close_route_zero_packages_fails.sql`, `tests/spec47_close_route_creates_route_reception.sql`, `tests/spec47_complete_route_cascades_manifest_status.sql:55`, `tests/spec47_reception_scan_increments_count.sql:54`

> The last two are easy to miss. They never call `close_pickup_route` — they flip `pickup_routes.status` to `in_transit` **raw** and then read the `route_receptions` row that the trigger branch created. Once that branch is removed, the row does not exist: `spec47_reception_scan_increments_count.sql` raises `'route_receptions row missing after route close'` and the cascade assertions get a NULL id. Both must call `open_route_reception` instead of updating status directly.
- Delete: `apps/frontend/src/components/pickup/CloseRouteButton.tsx` + `.test.tsx`, `hooks/pickup/useClosePickupRoute.ts` + `.test.ts`
- Modify: `app/app/pickup/route/active/page.tsx` (lines 14, 17, 33, 67-77, 128-136)

- [ ] **Step 1: Write the failing tests**
  - `open_route_reception` creates the batch, stamps `in_transit_at`, sets `status='in_transit'`, sets manifests to `awaiting_reception`, freezes `expected_count` from `verified` pickup scans, sets `received_by = auth.uid()` and `delivered_by = route.driver_id`
  - **idempotency:** a second call returns the same `route_receptions.id` and does **not** re-stamp `in_transit_at`
  - rejects a `received` or `cancelled` route
  - **route lock:** inserting a `pickup_scans` row for an `in_transit` route raises `55000`
  - `reopen_pickup_route` reverts an empty batch; **raises** once any `reception_scans` exist; raises a **named** error (not a bare `23505`) when the driver or vehicle already has a replacement active route
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Migration**
  - `CREATE OR REPLACE trg_pickup_routes_status_sync` — **remove the `→ in_transit` branch entirely** (`20260625000001:177-196`). It did two things: set manifests to `awaiting_reception` **and** create the batch. `open_route_reception` must now do **both**; omitting the manifest update is a silent failure that only surfaces at reception time.
  - `open_route_reception(p_route_id UUID)` per the contract above, `SECURITY DEFINER`, granted to `authenticated`
  - `reopen_pickup_route(p_route_id UUID)` with guards in order: (1) no `reception_scans`, (2) pre-check both active-route indexes, raising a named Spanish error. **Soft-delete the batch** (`UPDATE route_receptions SET deleted_at = NOW()`) — `CLAUDE.md` is soft-deletes-only, and the partial unique index at `20260625000001:196` is already `WHERE deleted_at IS NULL` so this works cleanly. **Consequently `open_route_reception`'s idempotency lookup must filter `deleted_at IS NULL`**, or a reopen-then-rescan returns the dead batch.
  - `BEFORE INSERT` trigger on `pickup_scans` joining `manifests.pickup_route_id → pickup_routes.status`, raising `ERRCODE '55000'` when a route exists and its status ≠ `in_progress`.

> **Do not write `IF v_status IS DISTINCT FROM 'in_progress'`.** Most manifests are scanned *before* being attached to a route, so `pickup_route_id` is `NULL` on the common path — that predicate would block every ordinary pickup scan and break several spec47 fixtures. The rule is: **`NULL` route → allow**; route present and not `in_progress` → raise. Add a pgTAP case for the unattached-manifest path.
  - `DROP FUNCTION public.close_pickup_route(UUID)`
- [ ] **Step 4: Frontend** — delete the two components/hooks and their tests; strip the close wiring from `route/active/page.tsx`; fix `page.test.tsx:19,48-49` (mocks the deleted hook and asserts `vehicle_label`)
- [ ] **Step 5: Update both type files by hand** (or from a local DB — see the Conventions warning; never regenerate against prod here). Remove `close_pickup_route`, update `start_pickup_route`, add `open_route_reception` and `reopen_pickup_route`.
- [ ] **Step 6: Run pgTAP + `npx turbo run lint type-check test:run build`**
- [ ] **Step 7: Commit** — `feat(spec-52)!: receptionist QR scan opens reception; remove driver close step`

---

### Task 6: unexpected count + the notes rule

**Files:**
- Create: `20260812000006_spec52_unexpected_count.sql`
- Create: `tests/spec52_unexpected_count.sql`

- [ ] **Step 1: Write the failing tests** — four cases:
  1. a scan **with** a `verified` pickup scan on the route does *not* increment `unexpected_count`
  2. a scan **without** one does
  3. `complete_route_reception` demands notes on under-count and on over-count
  4. **the offsetting case:** 10 expected · 10 received · 1 unexpected still demands notes. *This is the regression the rule exists to prevent — a naive `received <> expected` check passes it silently.*
  5. accepts without notes **only** when `matched_count = expected_count AND unexpected_count = 0`
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Migration**
  - `ALTER TABLE public.route_receptions ADD COLUMN unexpected_count INT NOT NULL DEFAULT 0`
  - `CREATE OR REPLACE FUNCTION public.trg_reception_scans_route_received_count()` (template: `20260625000001:267-283`) — on a `received` scan, also increment `unexpected_count` when:

> **Name the function, not the trigger.** `trg_reception_scans_route_count` is the **trigger** (`:289`); the **function** is `trg_reception_scans_route_received_count` (`:267`). Replacing the trigger name creates a brand-new function that nothing ever invokes — `unexpected_count` would stay 0 forever and the failure would look like a mysterious test failure rather than a typo.

```sql
NOT EXISTS (
  SELECT 1 FROM public.pickup_scans ps
  JOIN public.manifests m ON m.id = ps.manifest_id
  WHERE ps.package_id = NEW.package_id
    AND m.pickup_route_id = v_route_id      -- from route_receptions.pickup_route_id
    AND ps.scan_result = 'verified'
)
```

  The trigger reaches `v_route_id` through `NEW.reception_id → route_receptions.pickup_route_id`. This uses `pickup_scans.manifest_id` directly and so does **not** duplicate the validator's `external_load_id` join — the two ask different questions.
  - **`complete_route_reception` — DEFERRED to Task 11, do NOT tighten it here.** The rule below is correct and still wanted:

```sql
v_matched := v_reception.received_count - v_reception.unexpected_count;
IF (v_matched <> v_reception.expected_count OR v_reception.unexpected_count > 0)
   AND (p_discrepancy_notes IS NULL OR btrim(p_discrepancy_notes) = '') THEN
  RAISE EXCEPTION 'Se requieren notas de discrepancia';
END IF;
```

> **Why it cannot ship in the database PR.** This is the expand phase; the database ships ahead of the frontend. The *shipped* `FinalizeReceptionButton.tsx:38` decides whether to open the notes modal with `const hasMissing = receivedCount < expectedCount`, and `unexpected_count` is not on `RouteReceptionSnapshot`, so the UI cannot see it. Tighten the server guard alone and the offsetting reception (10 expected · 10 received · 1 unexpected) becomes **unfinishable**: counts read equal, no modal opens, `onFinalize(null)` hits the RPC, the server raises, and the receptionist has no way to supply the notes being demanded. Under the spec-47 guard both shapes finalize fine, so tightening early is a *regression* introduced by the migration that first makes the failing case reachable — the same contract-phase-lands-early failure that `20260812000005` PART 5 exists to block. `20260812000006` PART 3 carries the full argument in place of the code.

  - **Manifest closure — currently unimplemented.** `trg_route_receptions_status_sync`'s `completed` branch (`20260625000001:242-249`) sets **only** `reception_status = 'received'`. `CREATE OR REPLACE` it to set `status = 'completed'`, `completed_at = NOW()` and `reception_status = 'received'` in the **same** `UPDATE` — one statement keeps `trg_manifest_reception_status` (`20260318000001:295-319`) benign, since it is guarded by `IF NEW.reception_status IS NULL`. Add the pgTAP case asserting both `status` and `completed_at`.

- [ ] **Step 4: Re-run — all pass**
- [ ] **Step 5: Commit** — `feat(spec-52): track unexpected packages, close manifests, fix offsetting discrepancies`

---

## Expand/contract release plan (added during implementation)

The database chunk deploys **before** the frontend chunk, and merge to `main` auto-deploys. Anything the current frontend calls must keep working until the frontend switches. So spec-52 ships in two phases.

### Expand — the database chunk (Tasks 1-6). Additive only.

| Kept working | Why |
|---|---|
| `start_pickup_route(TEXT)` | UI field is `"Vehículo (opcional)"` and sends `null` (`StartRouteButton.tsx:32,61`). Now a compat wrapper: normalizes the plate, find-or-creates the vehicle, and routes a **blank** label to the operator's inactive `SIN-REGISTRO` placeholder. |
| `close_pickup_route` + the `→ in_transit` trigger branch | The reception UI still gates on `in_transit`, reachable only via close. Removing it would deadlock reception. |
| `pickup_routes.vehicle_label` | Five components still read it. `start_pickup_route(UUID)` now writes the plate into it so it stays truthful. |
| `uniq_pickup_routes_one_active_per_vehicle` | **Deferred, not shipped.** During expand, blank labels and free-text labels ("Camión 1", "Ana") legitimately resolve to a shared vehicle row. Enforcing one-active-route-per-vehicle before `VehicleSelect` exists would block a second driver. `uniq_pickup_routes_one_active_per_driver` **is** enforced. |

### Contract — folded into Task 8 of the frontend chunk

1. `DROP FUNCTION start_pickup_route(TEXT)` and its internal `_get_or_create_unregistered_vehicle` helper
2. remove the `SIN-REGISTRO` exemption from `start_pickup_route(UUID)` — during expand it accepts that one inactive vehicle so the blank-label path can delegate
3. `DROP FUNCTION close_pickup_route` and remove the trigger's `→ in_transit` branch, once the reception UI calls `open_route_reception`
4. delete `CloseRouteButton` + `useClosePickupRoute` and rewrite the four spec47 tests that reach `in_transit` via a raw status flip
5. **add `uniq_pickup_routes_one_active_per_vehicle`** — and run this pre-flight against production first, because after backfill an operator's routes may share the placeholder vehicle:
```sql
SELECT operator_id, COUNT(*) FROM public.pickup_routes
 WHERE status = 'in_progress' AND deleted_at IS NULL
 GROUP BY operator_id HAVING COUNT(*) > 1;
```
   Any row means the index build aborts the deploy. Reconcile first.
6. stop writing `vehicle_label`; drop the column once nothing reads it

Migration `20260812000005` carries deploy-time post-conditions that abort if steps 3 land out of order.

---

## Chunk 2: Frontend

### Task 7: reception scan validator — the 7-row discriminator

Do this **before** the UI tasks: the reception screens depend on its result shape.

**Files:**
- Modify: `apps/frontend/src/lib/reception/reception-scan-validator.ts`
- Modify: `apps/frontend/src/hooks/reception/useReceptionScan.ts` (pass `routeId`)
- Modify: `apps/frontend/src/components/reception/ReceptionScanner.tsx:129-163` — `ScanFeedbackBanner` handles `'received'` (132) and `'duplicate'` (143); `route_mismatch` must be split out of the `not_found` fallback at ~155-163, or it shows no "camión equivocado" message. `scanResult` is typed `string`, so this is **not** caught by type-check.
- Test: `apps/frontend/src/lib/reception/reception-scan-validator.test.ts`, `components/reception/ReceptionScanner.test.tsx`

- [ ] **Step 1: Write one failing test per discriminator row** (7 rows), plus the NULL-`external_load_id` fall-through. Name each test after its row number so the mapping stays obvious.
- [ ] **Step 2: `npx vitest run src/lib/reception/reception-scan-validator.test.ts` — confirm fail**
- [ ] **Step 3: Implement**
  - add `'route_mismatch'` to the `ReceptionScanResult` union (line 3)
  - accept `routeId` in the input
  - resolve membership with the join below — **there is no FK from `orders` to `manifests`**, so this is a string match and the `operator_id` predicate is **required** (`external_load_id` alone is not unique):

```
packages.order_id → orders
orders.external_load_id = manifests.external_load_id
  AND orders.operator_id = manifests.operator_id
manifests.pickup_route_id = :routeId
```

  - `orders.external_load_id` is **nullable** → row 3: `not_found`, `"Paquete sin carga asociada"`
  - **keep** the `ALREADY_RECEIVED_STATUSES` guard (lines 20-25, 80-87) as row 4. It is a **12-value list including `cancelado`/`devuelto`/`dañado`/`extraviado`** — rank 0, *not* "beyond `en_bodega`". Reference the constant; do not re-derive it from `pipeline_position`.
  - **remove** the blanket `PRE_VERIFICADO_STATUSES` rejection (lines 71-78) — replaced by row 7 (`received`, flagged unexpected). **Delete the now-orphaned `PRE_VERIFICADO_STATUSES` constant at line 28** or `@typescript-eslint/no-unused-vars` fails `npx turbo run lint`.
  - **Rows 1-2 keep today's evaluation order.** The existing code checks `duplicate` (line 46) *before* `not_found` (line 59). The discriminator table reads 1→7, but reordering those two to match would change duplicate-detection for unknown barcodes. Preserve the current order; the table is a rule list, not an execution sequence for rows 1-2.
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** — `feat(spec-52): route-scoped reception scan discriminator`

---

### Task 8: `VehicleSelect` and the start-route sheet

**Files:**
- Create: `components/pickup/VehicleSelect.tsx` + `.test.tsx`
- Create: `hooks/pickup/useVehicles.ts` + `.test.ts`
- Modify: `components/pickup/StartRouteButton.tsx`, `hooks/pickup/useStartPickupRoute.ts`
- Modify: `hooks/pickup/useStartPickupRoute.test.ts:40` — currently asserts `{ p_vehicle_label: 'AAA-111' }`
- Modify: `hooks/pickup/useActivePickupRoute.ts:32` — `.in('status', ['draft','in_progress'])` → `.eq('status','in_progress')`

- [ ] **Step 1: Failing tests** — `VehicleSelect` lists only `active && !deleted_at` vehicles; inline plate creation inserts and selects the new vehicle; the sheet cannot be submitted without a vehicle; `useStartPickupRoute` sends `p_vehicle_id`.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Implement.** Combobox over `useVehicles()`, plus a "registrar patente" affordance that writes to `vehicles` and selects the result — this is what lets a paper-and-Excel tenant start on day one without a fleet-registry project.
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** — `feat(spec-52): require a vehicle when starting a pickup route`

---

### Task 9: persistent QR access

**Files:**
- Modify: `components/pickup/ActiveRouteBanner.tsx` + `.test.tsx`
- Modify: `app/app/pickup/page.tsx:188` + `page.test.tsx` — the banner's props are `{ code, startedAt, manifestCount }` (`ActiveRouteBanner.tsx:6-10`) with **no `routeId`**, so adding the QR link forces a prop change that breaks the caller at type-check time.

- [ ] **Step 1: Failing test** — the banner exposes a QR affordance whenever a route is `in_progress`, linking to `/app/pickup/route/[routeId]/qr`.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Implement.** The QR page itself is unchanged; only its reachability changes — it must be one tap away for the whole trip, because the receptionist may need it the moment the truck reaches the dock.
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** — `feat(spec-52): expose route QR for the whole trip`

---

### Task 10: reception tabs, preview page, receive-without-QR

The largest frontend task. Contains the regression fix.

**Files:**
- Modify: `hooks/reception/useIncomingRoutes.ts` (+ `.test.ts:40,73`)
- Modify: `app/app/reception/page.tsx:19-26,54-58` (+ `page.test.tsx:8,13`)
- Modify: `components/reception/RouteQRScannerEntry.tsx` (+ test)
- Modify: `components/reception/IncomingRoutesList.tsx` (+ `.test.tsx:12`)
- Create: `app/app/reception/route/[routeId]/preview/page.tsx`
- Create: `components/reception/RoutePreviewCard.tsx` + `.test.tsx`
- Create: `components/reception/ReceiveWithoutQRButton.tsx` + `.test.tsx`
- Create: `hooks/reception/useOpenRouteReception.ts` + `.test.ts`
- Create: `hooks/reception/useReopenRouteReception.ts` + `.test.ts`
- Create: `components/reception/ReopenRouteButton.tsx` + `.test.tsx`
- Modify: `app/app/reception/route/[routeId]/page.tsx` — mount `ReopenRouteButton`

- [ ] **Step 1: Failing tests**
  - `useIncomingRoutes` accepts `'in_progress' | 'in_transit' | 'received'` — the union at line 33 is currently closed to two values
  - "Rutas entrantes" lists `in_progress`; a new "En descarga" tab lists `in_transit`; "Completadas" and "Retornos" unchanged (four tabs total)
  - `IncomingRoutesList`: an `in_progress` row navigates to `/preview` and fires **no** RPC; an `in_transit` row goes to the session
  - `RouteQRScannerEntry` accepts `in_progress`, rejects `received`/`cancelled`
  - `ReceiveWithoutQRButton` calls nothing until the confirmation dialog is accepted
  - `ReopenRouteButton` — visible only while `received_count = 0`, calls `reopen_pickup_route`, surfaces the named "ya tiene una ruta activa" error legibly. **Without this the recovery path the design calls essential ships unreachable**: Task 5 creates the RPC, and nothing would ever call it.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Implement**
  - **Why the tab split is mandatory:** a route now reaches `in_transit` only *after* the receptionist scans it, so leaving "Rutas entrantes" on `in_transit` would hide every truck still on the road and silently redefine the tab as "being unloaded."
  - `RouteQRScannerEntry` stops reading `pickup_routes` directly and calls `open_route_reception`.
  - **`in_progress` rows are read-only.** Do **not** call `open_route_reception` on mount: these are trucks still out collecting, and one stray tap would stamp a false arrival, freeze `expected_count` mid-trip, and lock the driver out of scanning with no recovery. Opening requires the QR or the confirmed `ReceiveWithoutQRButton`. **The trip must never end by accident.**
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** — `feat(spec-52): split reception tabs and add read-only route preview`

---

### Task 11: plate everywhere, unexpected count in the header

**Files:**
- Modify: `hooks/reception/useRouteReceptionSnapshot.ts:9` (+ `.test.ts:32`) — add `unexpected_count` and the plate to the typed interface. **The RPC needs no change**: `get_route_reception_snapshot` returns `to_jsonb(rr.*)` (`20260625000001:520-522`), so the new column flows through automatically.
- Modify: `hooks/reception/useIncomingRoutes.ts:9,19,44,62`, `components/reception/IncomingRoutesList.tsx:40`, `app/app/reception/route/[routeId]/page.tsx:124` (+ `page.test.tsx:37`, which asserts `vehicle_label`), `app/app/pickup/route/active/page.tsx:85`
- Modify: `components/reception/RouteReceptionHeader.tsx`, `components/reception/FinalizeReceptionButton.tsx` (+ tests)
- Create: `packages/database/supabase/migrations/20260812000007_spec52_snapshot_vehicle_plate.sql` — `CREATE OR REPLACE get_route_reception_snapshot` joining `vehicles` and returning `plate`
- Create: `packages/database/supabase/tests/spec52_snapshot_plate.sql`
- **Create: `packages/database/supabase/migrations/20260812000008_spec52_notes_rule.sql` — the notes-rule tightening deferred out of Task 6** (contract phase). `CREATE OR REPLACE complete_route_reception` with the `matched := received_count - unexpected_count` guard exactly as written in Task 6. **This SQL and the `FinalizeReceptionButton` change below must land in the SAME commit** — the server rule and the modal trigger are one rule expressed twice, and either half alone is a reception screen that cannot be finalized.
- Modify: `packages/database/supabase/tests/spec52_unexpected_count.sql` — cases 4 and 5 are marked `TASK 8:` and currently assert *today's* behaviour (over-count and the offsetting case finalize without notes). Flip them to the CASE 3 shape: bare call raises, call with notes completes. The fixtures (route 3 = 1/2/1, route 4 = 10/10/1) are already built for it.

> **This is a 7th migration and it lands in the frontend PR.** Either move it into the database PR, or verify the `deploy.yml` path filter actually triggers the migration job for that PR — the plan warns about exactly this failure mode elsewhere.

- [ ] **Step 1: Failing tests** — nothing renders `vehicle_label`; the header shows `8/10 esperados · 1 inesperado`; `FinalizeReceptionButton` demands notes on under-count, over-count, **and the offsetting case**. The button must mirror the server rule exactly — `const needsNotes = receivedCount - unexpectedCount !== expectedCount || unexpectedCount > 0` — replacing today's `receivedCount < expectedCount` at `FinalizeReceptionButton.tsx:38`, which is the reason the guard could not be tightened in Task 6.
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Implement.** All five read sites switch to the plate. The header must **not** show a single fraction — `expected_count` and `received_count` now count different populations, so `matched/expected` plus a separate unexpected callout is the only honest display.
- [ ] **Step 4: Tests pass**
- [ ] **Step 5: Commit** — `feat(spec-52): show vehicle plate and unexpected package count`

---

### Task 12: file-size compliance + QA scope

**Files:**
- Create: `components/pickup/PickupManifestTabs.tsx` + `.test.tsx`
- Modify: `app/app/pickup/page.tsx` (356 lines — over the 300-line rule in `CLAUDE.md`)
- Modify: `docs/qa-test-scope.md` — row **2.6** (line 63) is written around `close_pickup_route`, and row **2.5** (line 62) is also stale (`start_pickup_route` → `draft`: both the status and the RPC signature change)
- **No sprint tracker to update.** `docs/sprint-status.yaml` was deliberately removed in `45d9d1d` and is gitignored (`.gitignore:36`) — parallel branches editing it caused constant merge conflicts. Status lives in this file's `**Status:**` line. Do not recreate it.
- Modify: `docs/specs/spec-52-…md` — flip `**Status:**` to `in progress` on the first implementation commit

- [ ] **Step 1: Failing test** for `PickupManifestTabs` (tab switching, client filter)
- [ ] **Step 2: Run, confirm fail**
- [ ] **Step 3: Extract** the tab/filter logic. Scoped to the file already being edited — not a refactor sweep. Verify `page.tsx` is now under 300 lines.
- [ ] **Step 4: Update `qa-test-scope.md` rows 2.5 and 2.6** for the receptionist-triggered flow. **Coordinate with the spec-51 QA work** — it has several live branches touching that file.
- [ ] **Step 5: Full CI green**
- [ ] **Step 6: Commit** — `refactor(spec-52): extract PickupManifestTabs; update QA scope`

---

### Task 13: end-to-end

**Files:** Create the E2E under the existing test setup.

- [ ] **Step 1: Write the E2E**

Depart hub with a vehicle → visit 2 clients, add 3 cargas → scan packages → arrive → receptionist scans QR → scan packages **flat and deliberately out of carga order** → finalize.

Assert: packages `en_bodega`; orders rolled up by the existing trigger; manifests `completed` with `completed_at`; route `received`; `in_transit_at` ≈ QR scan time; `received_at` ≈ finalize time.

- [ ] **Step 2: Run it — expect green if Tasks 1-12 are correct**
- [ ] **Step 3: Commit** — `test(spec-52): end-to-end pickup route and consolidated reception`

---

## Execution notes

**Suggested PR split** — Tasks 1-6 (database) and Tasks 7-13 (frontend) as two PRs. Task 5 is the one hard coupling: its SQL and the `CloseRouteButton` deletion must land together, so it anchors the boundary.

**Serialise, do not parallelise.** An earlier draft claimed Tasks 8, 9 and 12 touch disjoint files. They do not — **all three edit `app/app/pickup/page.tsx`**: Task 8 the `StartRouteButton` (line 194), Task 9 the `ActiveRouteBanner` (line 188), Task 12 the tabs/filter extraction (lines 209, 234-334). Run them in order, with Task 12 last so the extraction absorbs the other two's edits. Tasks 10 and 11 likewise share `useIncomingRoutes` and `IncomingRoutesList`.

**Verify before claiming done** (per `CLAUDE.md`): `gh pr checks <N>` green **and** `gh pr view <N> --json state,mergedAt` merged. Remember pgTAP does not run in CI — run it manually and say so explicitly in the PR body, and confirm the "Verify Production Migrations" drift job actually executed rather than being skipped by the path filter.
