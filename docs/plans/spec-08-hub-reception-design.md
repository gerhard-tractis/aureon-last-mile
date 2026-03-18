# Hub Reception & Chain of Custody — Design Spec

**Date:** 2026-03-18
**Status:** approved
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
| `scan_result` | enum: `received`, `not_found`, `duplicate` | |
| `scanned_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

### New Enum: `reception_status_enum`

Values: `awaiting_reception`, `reception_in_progress`, `received`

### Manifests Table Extension

Add column `reception_status` (type: `reception_status_enum`, default: NULL). Set to `awaiting_reception` when manifest `status` becomes `completed`.

### Trigger: Package Status Advance

On `reception_scans` INSERT with `scan_result = 'received'` and `package_id IS NOT NULL`:
- Update `packages.status` → `'en_bodega'`
- The existing `trg_recalculate_order_status` handles order status auto-recalculation

### Permission

New `reception` permission added to the user permissions array. Only users with this permission see the Recepción tab in navigation.

## Screen Flow

### Screen 1 — QR Handoff (Driver Side)

**Route:** `/app/pickup/handoff/[loadId]`

- Driver sees their completed manifests with "Entregar en bodega" button
- Tapping creates a `hub_receptions` record with `status = 'pending'`, `delivered_by = current_user`
- Shows full-screen QR code encoding the manifest UUID (plain string)
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
| Package from different manifest | Reject: "Paquete no pertenece a esta carga" |
| Duplicate scan | `scan_result = 'duplicate'`, triple beep, red flash, no status change |
| Reception abandoned mid-scan | Stays `in_progress`, resumable from list |
| All packages received | Auto-navigate to confirmation screen |
| QR for already-received manifest | "Esta carga ya fue recibida" + timestamp + receiver name |

## Component Reuse

From pickup verification (adapted for reception context):
- `ScanValidator` logic (barcode matching, duplicate detection, audio/haptic)
- `ManifestDetailList` / `OrderCard` / `PackageRow` pattern
- `useBarcodeScan` hook

## Testing Strategy

- **Unit tests:** `useReceptionScans`, `useHubReceptions`, `useQRHandoff`, scan validator for reception, QR generation/parsing
- **Component tests:** Reception list, scanning screen, confirmation screen, QR display, QR scanner camera, permission gating on nav
- **Integration:** Package status `verificado` → `en_bodega`, order status auto-recalculation via trigger, RLS on new tables

All TDD per project rules (Vitest + React Testing Library).
