# Spec-15: Dispatch Module

**Status:** completed
**Date:** 2026-03-24
**Branch:** `feat/spec-15-dispatch-module`
**Depends on:** spec-03 (enum foundation), spec-12 (distribution/andén model), spec-13d (pickup/reception patterns)

---

## Overview

The Dispatch Module is the final operational step before last-mile delivery. Operators build routes by scanning packages from assigned andenes, select the truck, close the route, and dispatch it to DispatchTrack (DT) — which pushes the route to the driver's mobile app.

This completes the full hub E2E flow:
```
Pickup → Reception → Distribution → Dispatch → En Ruta
```

---

## User Story

As a dispatcher, I need to:
1. Create a new route for today
2. Scan packages from the andén into the route (one by one, any order)
3. Select the truck the packages will load into
4. Close the route when loading is complete
5. Dispatch the route to DispatchTrack so the driver can start delivering

---

## Status Pipeline Changes

### New package/order status: `listo_para_despacho`

Rename existing `listo` → `listo_para_despacho` in both enums. This state means: "all packages scanned, route closed, awaiting dispatch."

```
asignado → en_carga → listo_para_despacho → en_ruta → entregado
```

### New route status: `draft`

Add `draft` before `planned` in `route_status_enum`:

```
draft → planned → in_progress → completed / cancelled
```

| Route status | Meaning |
|---|---|
| `draft` | Being built locally — dispatcher is scanning packages |
| `planned` | Dispatched to DT, driver hasn't started yet |
| `in_progress` | Driver is actively delivering (DT webhook) |
| `completed` | All stops resolved (DT webhook) |
| `cancelled` | Cancelled at any point |

---

## Database Migration

One migration, no new tables needed. Existing `routes`, `dispatches`, and `fleet_vehicles` tables are sufficient.

```sql
-- Add draft status to routes
ALTER TYPE route_status_enum ADD VALUE 'draft' BEFORE 'planned';

-- Rename listo → listo_para_despacho
ALTER TYPE order_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
ALTER TYPE package_status_enum RENAME VALUE 'listo' TO 'listo_para_despacho';
```

**Pre-condition:** Before running this migration, verify no rows carry `listo` in production:
```sql
SELECT COUNT(*) FROM packages WHERE status = 'listo';
SELECT COUNT(*) FROM orders WHERE status = 'listo';
```
Both must return 0. If not, update those rows to the appropriate new value first.

---

## UI Design

### Design choice: Tablet Hybrid

Optimized for **landscape tablet** (primary device for hub operators). Structure follows Split Panel (uses landscape width), interaction follows Card Deck (touch-friendly targets throughout).

Key constraints:
- All touch targets: **minimum 52px height**
- Scan input: **56px height**, always auto-focused, accepts barcode / order number / QR
- Action buttons: **full-width**, prominent, only unlocked at the correct state
- Right panel: **never scrolls** — truck, stats, and CTAs always visible

### Screen 1: `/app/dispatch` — Route List

- Header: "Despacho" title + "Nueva Ruta" button (52px, gold)
- Large tiles grid (3 columns on landscape tablet): route ID, truck, package count, status badge, time
- Routes in `listo_para_despacho` state highlighted with gold tint + immediate "Despachar" shortcut
- Tap any tile → opens Route Builder

### Screen 2: `/app/dispatch/[routeId]` — Route Builder

**Left panel (62%):**
- Top bar: back arrow + route ID + date + status badge
- Scan zone (gold-tinted background): pulsing indicator, large scan input, hint text
- Count strip: "N paquetes escaneados"
- Scrollable package list: 60px card-rows with order ID, client name, address, status badge, 44px remove button

**Right panel (38%, fixed, no scroll):**
- Truck selector (52px select)
- Driver field (optional, 52px input)
- Stats: packages count, orders count
- "Cerrar Ruta" button (52px, secondary)
- "Despachar a DispatchTrack →" button (56px, gold, disabled until route closed)

---

## Scan Logic

When a code is scanned:

1. Look up by `packages.barcode = code` (operator-scoped)
2. Fallback: look up by `orders.order_number = code`
3. Validate package status is `asignado` — reject with message if not

   > **Why only `asignado`:** The Distribution module advances packages to `asignado` the moment they are physically placed in an andén. A package cannot reach the Dispatch screen without first passing through Distribution. Any package not yet in `asignado` is not physically at the andén and must not be loaded.

4. Validate package is not already in another active route — reject with message if so
5. Create `dispatches` row: `route_id`, `order_id`, `status: pending`, `operator_id`
6. Update package status → `en_carga`
7. Return package details to UI for instant display

**Inline error messages** (never crash the scanner):
- Code not found → "Código no encontrado"
- Wrong status → "Paquete en estado incorrecto (estado: `en_bodega`)"
- Already in route → "Paquete ya asignado a Ruta #RUT-007"

---

## API Endpoints

All under `app/api/dispatch/`, all enforce `operator_id` isolation.

| Method | Path | Action |
|---|---|---|
| `POST` | `/routes` | Create route → `status: draft` |
| `POST` | `/routes/[id]/scan` | Scan package into route |
| `DELETE` | `/routes/[id]/packages/[pkgId]` | Remove package → revert to `asignado` |
| `POST` | `/routes/[id]/close` | Close route → all packages → `listo_para_despacho` |
| `POST` | `/routes/[id]/dispatch` | Dispatch to DT → packages → `en_ruta`, route → `planned` |

---

## DispatchTrack API Integration

**Endpoint:** `POST https://activationcode.dispatchtrack.com/api/external/v1/routes`
**Auth:** `X-AUTH-TOKEN: {DT_API_KEY}` (already in `.env`)
**Credentials:** already available in project environment

### Payload shape

> **Date format:** DT API expects `DD-MM-YYYY` (confirmed from their API docs example: `"date": "22-04-2022"`). This differs from ISO-8601 used elsewhere in the project — format explicitly before sending.

```json
{
  "truck_identifier": "ZALDUENDO",
  "date": "24-03-2026",
  "driver_identifier": "optional",
  "dispatches": [
    {
      "identifier": 4821,
      "contact_name": "Mario González",
      "contact_address": "Av. Providencia 1234, Providencia",
      "contact_phone": "+56912345678",
      "contact_email": "mario@example.com",
      "current_state": 1
    }
  ]
}
```

### Response

```json
{ "status": "ok", "response": { "route_id": 164972 } }
```

The returned `route_id` is stored as `routes.external_route_id`. Individual `dispatches.external_dispatch_id` values are **not** available from this response — they are populated later when DT sends inbound webhooks for each stop as the driver progresses through the route.

### Failure handling

If DT API call fails (network error, 4xx, 5xx):
- **Nothing changes** — packages stay at `listo_para_despacho`, route stays `draft`
- Error logged to existing `audit_log` table (`action: 'dispatch_failed'`, `metadata: { route_id, dt_error, packages_count }`)
- UI shows inline error with "Reintentar" button
- No partial state possible — DT call is all-or-nothing before any local status update

---

## State Transition Summary

| Action | Package status | Route status |
|---|---|---|
| Package scanned into route | `asignado` → `en_carga` | `draft` |
| Package removed from route | `en_carga` → `asignado` | `draft` |
| Route closed | `en_carga` → `listo_para_despacho` | `draft` |
| Dispatch successful | `listo_para_despacho` → `en_ruta` | `draft` → `planned` |
| Driver starts route (DT webhook) | — | `planned` → `in_progress` |
| Route completed (DT webhook) | — | `in_progress` → `completed` |

---

## Tests

### Unit tests (Vitest)
- `scan-lookup.test.ts` — resolves barcode, order number, QR; handles not found; handles wrong status; handles already-in-route
- `status-transitions.test.ts` — validates allowed transitions per status
- `dt-payload-builder.test.ts` — correct JSON shape from route + packages data

### Integration tests
- Full scan flow against test DB (create route → scan → verify status)
- Close route (atomic — all packages flip together)
- Dispatch: success path (DT mocked 200) + failure path (DT mocked 500 → no state change)

### E2E test (Playwright)
- Full journey: create route → scan 3 packages → close → dispatch (DT mocked) → assert packages are `en_ruta`

---

## Files to Create / Modify

### New files
```
apps/frontend/src/app/app/dispatch/
  page.tsx                          # Route list
  [routeId]/
    page.tsx                        # Route builder
apps/frontend/src/components/dispatch/
  RouteListTile.tsx
  RouteBuilder.tsx
  ScanZone.tsx
  PackageRow.tsx
  RoutePanel.tsx
apps/frontend/src/hooks/
  useDispatchRoutes.ts
  useScanPackage.ts
apps/frontend/src/app/api/dispatch/
  routes/route.ts
  routes/[id]/scan/route.ts
  routes/[id]/close/route.ts
  routes/[id]/dispatch/route.ts
  routes/[id]/packages/[pkgId]/route.ts
apps/frontend/src/lib/
  dispatchtrack-api.ts              # DT API client
packages/database/supabase/migrations/
  YYYYMMDD_dispatch_module.sql      # Enum changes
```

### Modified files
- `apps/frontend/src/components/sidebar/` — add Dispatch nav item
- `docs/sprint-status.yaml` — update Epic 3B story 4 → done, add story 15

---

## Intentional Constraints

- **No re-opening a closed route:** Once "Cerrar Ruta" is pressed, the route cannot return to `draft`. If a dispatcher needs to add a package, they must dispatch the current route first and create a new one, or delete the route and start over. This simplifies state management and avoids race conditions with the DT API. Re-open functionality is out of scope for v1.

---

## Out of Scope

- Automatic route optimization / stop ordering (deferred to OR-Tools spec)
- Fleet vehicle management (3b-6, optional)
- Intermediate state `3b-5` (`in_route` → `out_for_delivery`) — separate spec
- Editing a dispatched route (contact DispatchTrack support to cancel + recreate)
