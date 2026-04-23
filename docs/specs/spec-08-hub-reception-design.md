# Hub Reception & Chain of Custody — Design Spec

**Date:** 2026-03-18
**Status:** completed
**Epic:** Phase 1.1 — Recepción
**PRD FRs:** FR20-FR23
**Depends on:** Epic 4A (Pickup Verification), Epic 5 spec-03 (package_status pipeline)

## Problem

When a pickup crew arrives at the operator's hub with verified packages, there is no digital process to confirm what actually arrived. Discrepancies between what was signed at pickup and what reaches the hub go undetected — enabling in-transit loss or theft with no accountability.

## Solution

A barcode-scanning reception workflow at the hub that reconciles received packages against what was verified at pickup. Uses QR-based manifest handoff (driver → receiver) to eliminate paper. Advances package status from `verificado` → `en_bodega` with full audit trail.

## Prerequisite Fix

**Pickup must advance package status.** Currently, scanning a package at pickup creates a `pickup_scans` record but leaves `packages.status` at `ingresado`. This must be fixed:

- On each successful pickup scan (`scan_result = 'verified'`), update `packages.status` → `'verificado'`
- The existing `trg_recalculate_order_status` trigger will auto-promote `orders.status` once ALL packages in an order reach `verificado`

## Data Model

### New Table: `hub_receptions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `manifest_id` | FK → manifests | |
| `operator_id` | FK → operators | RLS policy |
| `received_by` | FK → users | Hub receiver |
| `delivered_by` | FK → users | Driver who handed off |
| `status` | enum: `pending`, `in_progress`, `completed` | |
| `started_at` | TIMESTAMPTZ | Set when scanning begins |
| `completed_at` | TIMESTAMPTZ | Set on confirmation |
| `expected_count` | INT | Count of `verificado` packages in manifest |
| `received_count` | INT | Packages scanned at hub |
| `discrepancy_notes` | TEXT, nullable | In-transit loss notes |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

### New Table: `reception_scans`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `reception_id` | FK → hub_receptions | |
| `package_id` | FK → packages, nullable | NULL when not_found |
| `operator_id` | FK → operators | RLS policy |
| `scanned_by` | FK → users | |
| `barcode` | TEXT | Raw barcode value |
| `scan_result` | `reception_scan_result_enum`: `received`, `not_found`, `duplicate` | New enum (separate from pickup's `scan_result_enum`) |
| `scanned_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

### New Enum: `hub_reception_status_enum`

Values: `pending`, `in_progress`, `completed`

Used by `hub_receptions.status`.

### New Enum: `reception_status_enum`

Values: `awaiting_reception`, `reception_in_progress`, `received`

Used by `manifests.reception_status`. Tracks the manifest's reception lifecycle separately from the `hub_receptions` row because the manifest can be `awaiting_reception` before a `hub_receptions` row exists (i.e., before the driver taps "Entregar en bodega").

**Sync rule:** When `hub_receptions.status` changes, the corresponding `manifests.reception_status` is updated in the same transaction:
- `hub_receptions` created (`pending`) → `manifests.reception_status = 'awaiting_reception'` (if not already set)
- `hub_receptions.status = 'in_progress'` → `manifests.reception_status = 'reception_in_progress'`
- `hub_receptions.status = 'completed'` → `manifests.reception_status = 'received'`

### Manifests Table Extension

Add column `reception_status` (type: `reception_status_enum`, default: NULL). Set to `awaiting_reception` when manifest `status` becomes `completed` (via trigger on manifests table).

### Standard Infrastructure (both tables)

Per architecture rules, each table gets:
- RLS enabled with tenant isolation policy via `get_operator_id()`
- Audit trigger via `audit_trigger_func()`
- `set_updated_at` trigger
- Indexes on `operator_id`, all FK columns, `deleted_at`
- GRANT SELECT/INSERT/UPDATE to `authenticated`, REVOKE ALL from `anon`

### Trigger: Package Status Advance

On `reception_scans` INSERT with `scan_result = 'received'` and `package_id IS NOT NULL`:
- Update `packages.status` → `'en_bodega'`
- The existing `trg_recalculate_order_status` handles order status auto-recalculation

### Trigger: Manifest Reception Status

On `manifests` UPDATE where `status` changes to `completed`:
- Set `reception_status = 'awaiting_reception'`

### Permission

Extend the `Permission` type union in `auth.types.ts` to include `'reception'`:
```typescript
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin' | 'reception';
```

**Backfill migration:** Users with `warehouse` permission also receive `reception` permission (warehouse staff are the default receivers). The permission can also be granted independently to pickup crew who do self-reception.

Only users with `reception` permission see the Recepción tab in navigation. The route layout (`app/app/reception/layout.tsx`) enforces this guard.

## Screen Flow

### Screen 1 — QR Handoff (Driver Side)

**Route:** `/app/pickup/handoff/[loadId]` (same `[loadId]` = `external_load_id` as existing pickup routes)

- Driver sees their completed manifests with "Entregar en bodega" button
- Tapping looks up the manifest by `external_load_id`, creates a `hub_receptions` record with `status = 'pending'`, `delivered_by = current_user`
- Also sets `manifests.reception_status = 'awaiting_reception'` if not already set
- Shows full-screen QR code encoding the **manifest UUID** (not the loadId — the UUID is what the receiver needs for DB lookup)
- QR stays on screen until dismissed

### Screen 2 — Reception List (Receiver Side)

**Route:** `/app/reception`

- Permission-gated: only visible to users with `reception` permission
- Shows manifests where `reception_status = 'awaiting_reception'` or `reception_status = 'reception_in_progress'`
- Each card displays: retailer name, driver name, package count, pickup completion time
- In-progress receptions show: "En progreso: 150/347 recibidos"
- "Escanear QR" button → opens camera, scans driver's QR, navigates to Screen 3
- Tapping an in-progress card resumes that reception

### Screen 3 — Reception Scanning

**Route:** `/app/reception/scan/[receptionId]`

- Same UX as pickup scanning: progress bar (0/N → N/N), barcode camera scanner, multi-sensory feedback (audio + haptic + visual)
- Shows only `verificado` packages from the linked manifest
- Each scan creates a `reception_scans` record and advances package to `en_bodega`
- Back arrow → returns to reception list
- Detail list below scanner showing received vs. pending packages (reuses `ManifestDetailList` pattern adapted for reception)
- Duplicate scan: triple beep, red flash, `scan_result = 'duplicate'`

### Screen 4 — Reception Confirmation

**Route:** `/app/reception/complete/[receptionId]`

- Summary: packages expected, received, missing count
- If missing packages: text field for discrepancy notes (in-transit loss report)
- "Confirmar recepción" button:
  - Sets `hub_receptions.status = 'completed'`, `completed_at = NOW()`
  - Sets `manifests.reception_status = 'received'`
  - Stores discrepancy notes
- No signature required (internal handoff)

## QR Protocol

- **Payload:** Plain manifest UUID string
- **Security:** RLS enforces same `operator_id`. No HMAC needed — internal process.
- **Generation:** Client-side, no network needed on driver side
- **Validation:** Receiver app looks up manifest by ID, RLS ensures same operator
- **Already received:** Shows "Esta carga ya fue recibida" with timestamp and receiver name

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Package not `verificado` | Reject: "Paquete no verificado en retiro" |
| Package already `en_bodega` or later | Reject: "Paquete ya fue recibido en bodega" |
| Package from different manifest | Reject: "Paquete no pertenece a esta carga" |
| Duplicate scan | `scan_result = 'duplicate'`, triple beep, red flash, no status change |
| Reception abandoned mid-scan | Stays `in_progress`, resumable from list |
| All packages received | Auto-navigate to confirmation screen |
| QR for already-received manifest | "Esta carga ya fue recibida" + timestamp + receiver name |
| QR scanned is not a valid UUID | Reject: "Código QR no válido" — no DB query |

## Component Architecture

### Pages (`apps/frontend/src/app/app/`)

| File | Purpose |
|------|---------|
| `reception/layout.tsx` | Permission guard — redirects if user lacks `reception` permission |
| `reception/page.tsx` | Screen 2: Reception list + QR scanner button |
| `reception/scan/[receptionId]/page.tsx` | Screen 3: Reception barcode scanning |
| `reception/complete/[receptionId]/page.tsx` | Screen 4: Confirmation + discrepancy notes |
| `pickup/handoff/[loadId]/page.tsx` | Screen 1: QR code handoff (driver side) |

### Components (`apps/frontend/src/components/reception/`)

| File | Purpose |
|------|---------|
| `ReceptionList.tsx` | Card list of manifests awaiting/in-progress reception |
| `ReceptionCard.tsx` | Single manifest card (retailer, driver, count, time) |
| `ReceptionScanner.tsx` | Barcode scanner adapted for reception (reuses `useBarcodeScan`) |
| `ReceptionDetailList.tsx` | Package list below scanner (adapts `ManifestDetailList` pattern) |
| `ReceptionSummary.tsx` | Completion summary (expected/received/missing counts) |
| `QRHandoff.tsx` | Full-screen QR code display for driver |
| `QRScanner.tsx` | Camera QR scanner for receiver |

### Hooks (`apps/frontend/src/hooks/reception/`)

| File | Purpose |
|------|---------|
| `useHubReceptions.ts` | CRUD for `hub_receptions` table |
| `useReceptionScans.ts` | Insert scans, fetch scan history for a reception |
| `useReceptionManifests.ts` | Fetch manifests with `reception_status` filter |
| `useQRHandoff.ts` | Create reception record + generate QR payload |

### Lib (`apps/frontend/src/lib/reception/`)

| File | Purpose |
|------|---------|
| `reception-scan-validator.ts` | Validate barcode against `verificado` packages, detect duplicates |

## Component Reuse

From pickup verification (adapted for reception context):
- `ScanValidator` logic (barcode matching, duplicate detection, audio/haptic)
- `ManifestDetailList` / `OrderCard` / `PackageRow` pattern
- `useBarcodeScan` hook

## Offline Support

Hub reception requires connectivity. The hub is assumed to have reliable WiFi/LAN. Offline reception is not in scope — if needed, it follows the same IndexedDB queue pattern as pickup (deferred).

## FR Coverage

| FR | Coverage |
|----|----------|
| FR20: Scan packages during hub reception to log arrival | Screen 3 (scanning) + `reception_scans` table |
| FR21: Auto-reconcile received vs. signed manifests, alert discrepancies | Expected vs. received count + Screen 4 discrepancy notes |
| FR22: Distinguish retailer shortages vs. internal handling issues | Implicit: packages not `verificado` = never picked up (retailer). Packages `verificado` but missing at hub = in-transit loss. Screen 4 summary makes this visible. |
| FR23: Log all activities with timestamp, user, operator context | `reception_scans.scanned_by` + `scanned_at` + `operator_id` + audit trigger on both tables |

## Story Breakdown

| Story | Title | Depends on |
|-------|-------|------------|
| R.0 | Prereq: Update pickup scan to advance package status to `verificado` | — |
| R.1 | DB migration: `hub_receptions`, `reception_scans`, enums, triggers, RLS, permissions backfill | R.0 |
| R.2 | Screen 1: QR Handoff (driver side) — `QRHandoff` component + `useQRHandoff` hook | R.1 |
| R.3 | Screen 2: Reception List — `ReceptionList` + `ReceptionCard` + QR scanner + permission layout | R.1 |
| R.4 | Screen 3: Reception Scanning — `ReceptionScanner` + `ReceptionDetailList` + scan validator | R.1 |
| R.5 | Screen 4: Reception Confirmation — `ReceptionSummary` + discrepancy notes + completion mutation | R.4 |
| R.6 | Nav integration: Add Recepción tab to sidebar, permission-gated | R.1 |

## Testing Strategy

- **Unit tests:** `useReceptionScans`, `useHubReceptions`, `useReceptionManifests`, `useQRHandoff`, `reception-scan-validator`, QR generation/parsing
- **Component tests:** ReceptionList, ReceptionCard, ReceptionScanner, ReceptionDetailList, ReceptionSummary, QRHandoff, QRScanner, permission gating on layout and nav
- **Integration:** Package status `verificado` → `en_bodega`, order status auto-recalculation via trigger, RLS on new tables, permission backfill for warehouse users

All TDD per project rules (Vitest + React Testing Library).
