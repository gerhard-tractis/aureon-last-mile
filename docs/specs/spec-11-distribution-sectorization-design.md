# Distribution Sectorization — Design Spec

**Date:** 2026-03-18
**Status:** backlog
**Epic:** Phase 1.2 — Distribución
**Depends on:** spec-08 (Hub Reception), Epic 5 spec-03 (package_status pipeline)

## Problem

After packages are received at the hub (`en_bodega`), they sit unsorted in the reception area. There is no process to physically organize packages by destination zone before dispatch. This causes congestion in the reception area, slows driver loading, and provides no traceability of where a package is physically located within the hub.

## Solution

A sectorization workflow that sorts received packages into dock zones (andenes) based on destination comuna and delivery date. Operators configure andenes with comuna mappings. Two scanning modes — batch and quick-sort — let operators sort packages efficiently and confirm placement by scanning a physical barcode on each andén. Packages with future delivery dates go to a consolidation zone to keep reception clear.

## Data Model

### New Enum Values: `package_status_enum`

Add two values to the existing `package_status_enum` using `ALTER TYPE ... ADD VALUE` statements (these must run **outside** a transaction block in PostgreSQL — the migration must use separate statements, not a DO block):
- `sectorizado` — package placed in an active andén, ready for dispatch
- `retenido` — package placed in consolidation zone, held for future date

**Pipeline position:** Both sit between `en_bodega` (3) and `asignado` (4). The `pipeline_position()` function must be updated with new integer positions. Renumber the full pipeline:

| Position | Status | Scope |
|----------|--------|-------|
| 1 | `ingresado` | order + package |
| 2 | `verificado` | order + package |
| 3 | `en_bodega` | order + package |
| 4 | `sectorizado` | **package only** |
| 5 | `retenido` | **package only** |
| 6 | `asignado` | order + package |
| 7 | `en_carga` | order + package |
| 8 | `listo` | order + package |
| 9 | `en_ruta` | order + package |
| 10 | `entregado` | order + package |

**Package-only statuses:** `sectorizado` and `retenido` are NOT added to `order_status_enum`. They are package-level physical location states. The `recalculate_order_status()` function must treat packages in `sectorizado` or `retenido` as equivalent to `en_bodega` for order-level status calculation (i.e., map positions 4 and 5 back to position 3 when computing the order's minimum status).

**Status transitions:**

```
en_bodega   → sectorizado   (scanned into active andén, delivery date today/tomorrow)
en_bodega   → retenido       (scanned into consolidation zone, delivery date > tomorrow)
retenido    → en_bodega      (released from consolidation when date approaches — operator action)
en_bodega   → sectorizado   (re-sectorized after release from consolidation)
sectorizado → asignado       (future: driver/route assignment via agent suite)
```

**No undo from sectorizado:** Once a package is placed in an active andén, it cannot be moved back to `en_bodega`. If it's in the wrong andén, the operator should use quick-sort to re-scan it to the correct one (the scan validator allows re-sectorization to a different andén).

### New Enum: `batch_status_enum`

Values: `open`, `closed`

### New Enum: `dock_scan_result_enum`

Values: `accepted`, `rejected`, `wrong_zone`, `unmapped`

### New Table: `dock_zones`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `operator_id` | UUID, FK → operators | RLS policy |
| `name` | VARCHAR NOT NULL | Display name: "Andén 1", "Zona Sur", etc. |
| `code` | VARCHAR NOT NULL | Unique short code for barcode: "DOCK-001" |
| `is_consolidation` | BOOLEAN DEFAULT false | One per operator (partial unique index) |
| `comunas` | TEXT[] | Array of comuna names mapped to this zone. Empty for consolidation. |
| `is_active` | BOOLEAN DEFAULT true | Soft disable without deleting |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

**Constraints:**
- Partial unique index: `UNIQUE (operator_id) WHERE is_consolidation = true AND deleted_at IS NULL` — one consolidation zone per operator
- Unique index: `UNIQUE (operator_id, code) WHERE deleted_at IS NULL`

### New Table: `dock_batches`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `operator_id` | UUID, FK → operators | RLS policy |
| `dock_zone_id` | UUID, FK → dock_zones | Target andén for this batch |
| `status` | `batch_status_enum` DEFAULT 'open' | |
| `created_by` | UUID, FK → users | Operator who created the batch |
| `closed_at` | TIMESTAMPTZ, nullable | Set when batch is closed |
| `package_count` | INT DEFAULT 0 | Denormalized count of accepted scans |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

### New Table: `dock_scans`

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID, PK | |
| `operator_id` | UUID, FK → operators | RLS policy |
| `batch_id` | UUID, FK → dock_batches | |
| `package_id` | UUID, FK → packages, nullable | NULL when package not found |
| `barcode` | TEXT NOT NULL | Raw barcode value scanned |
| `scan_result` | `dock_scan_result_enum` | |
| `scanned_by` | UUID, FK → users | |
| `scanned_at` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ, nullable | Soft delete |

**Constraint:** `UNIQUE (operator_id, batch_id, package_id) WHERE deleted_at IS NULL` — prevents duplicate package scans within the same batch at the database level (defense-in-depth alongside application validation).

### Packages Table Extension

Add column `dock_zone_id` (type: UUID, FK → dock_zones, nullable). Tracks current physical location of the package within the hub. Add index: `CREATE INDEX idx_packages_dock_zone_id ON packages(dock_zone_id)`.

### Standard Infrastructure (all new tables)

Per architecture rules, each table gets:
- RLS enabled with tenant isolation policy via `get_operator_id()`
- Audit trigger via `audit_trigger_func()`
- `set_updated_at` trigger (on all three tables)
- Indexes on `operator_id`, all FK columns, `deleted_at`
- GRANT SELECT/INSERT/UPDATE to `authenticated`, REVOKE ALL from `anon`

### Trigger: Package Status Advance on Scan

On `dock_scans` INSERT with `scan_result = 'accepted'` and `package_id IS NOT NULL`:
- Look up target `dock_zone` via `batch.dock_zone_id`
- If `dock_zone.is_consolidation = true` → update `packages.status` → `'retenido'`
- If `dock_zone.is_consolidation = false` → update `packages.status` → `'sectorizado'`
- Set `packages.dock_zone_id` → `dock_zone.id`
- Increment `dock_batches.package_count`
- The existing `trg_recalculate_order_status` handles order status auto-recalculation

### Trigger: Batch Close Timestamp

On `dock_batches` UPDATE where `status` changes to `'closed'`:
- Set `closed_at = NOW()`

### Permission

Extend the `Permission` type union in `auth.types.ts` to include `'distribution'`:
```typescript
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin' | 'reception' | 'distribution';
```

**Backfill migration:** Users with `warehouse` permission also receive `distribution` permission (warehouse staff handle sectorization). The permission can also be granted independently.

Only users with `distribution` permission see the Distribución tab in navigation. The route layout (`app/app/distribution/layout.tsx`) enforces this guard.

## Sectorization Rules Engine

### Delivery Date Filter

When determining the target andén for a package:
1. Look up the order's delivery date via `packages.order_id → orders.delivery_date` (type: DATE, NOT NULL)
2. If delivery date is **today or tomorrow** → look up comuna → assign to matching active andén
3. If delivery date is **later than tomorrow** → assign to consolidation zone

### Comuna Matching

1. Look up the order's destination comuna via `packages.order_id → orders.comuna` (the join path is: `dock_scans.package_id → packages.order_id → orders.comuna`)
2. Find the `dock_zone` where `comunas @> ARRAY[comuna]` and `is_active = true` and `is_consolidation = false`
3. If found → that's the target andén
4. If not found (unmapped comuna) → assign to consolidation zone AND flag for operator attention (the package is sectorized but the operator should update their andén rules)

**Comuna matching is case-insensitive.** Both the `dock_zones.comunas` values and the order's comuna are normalized (trimmed, lowercased) during comparison in `sectorization-engine.ts`.

### Validation: One Comuna Per Andén

A comuna can only appear in one active andén's `comunas` array at a time. The andén maintenance UI enforces this — when adding a comuna to andén A, it's automatically removed from andén B if previously assigned.

## Screen Flow

### Screen 0 — Andén Maintenance (Configuration)

**Route:** `/app/distribution/settings`

- Permission-gated: only `distribution` permission
- Table/list of andenes: name, code, mapped comunas (as tags), active/inactive toggle
- Consolidation zone auto-created on first visit — always shown at top, cannot be deleted or deactivated, no comuna mapping
- "Agregar andén" button → form/modal: name, code (for barcode), multi-select comunas
- Edit existing andenes (name, code, comunas, active status)
- Delete andén (soft delete) — only if no packages currently sectorized there
- **Unmapped comunas warning**: banner listing comunas from recent orders that aren't assigned to any andén
- Barcode generation: printable barcode/QR from the code (e.g., `DOCK-001`) for physical placement at the bay

### Screen 1 — Distribution Dashboard

**Route:** `/app/distribution`

- Permission-gated: only `distribution` permission
- **3 KPI cards at top:**
  - **Pendientes de sectorizar**: count of `en_bodega` packages (must be 0 by end of day)
  - **En consolidación**: total `retenido` packages
  - **Próximos a despachar**: consolidation packages with delivery date ≤ tomorrow (needs immediate attention)
- **Active andenes grid** (middle section): card per andén showing name, code, package count, top comunas. Click into an andén to see its package list.
- **Consolidation alert panel** (bottom section):
  - Packages in consolidation grouped by delivery date
  - Tomorrow's packages highlighted with visual urgency flag
  - "Liberar a sectorización" action button → sets selected packages back to `en_bodega` and clears `packages.dock_zone_id = NULL` so they re-enter the sorting flow
  - Future-dated packages in collapsed/secondary view

### Screen 2 — Batch Scanning

**Route:** `/app/distribution/batch`

**Step 2a — Batch Overview:**
- Shows pending packages grouped by target andén (system pre-calculates using sectorization rules)
- Each group card: andén name, package count, top comunas
- "Iniciar lote" button on each group → creates a `dock_batches` record, navigates to Step 2b

**Step 2b — Batch Scan (`/app/distribution/batch/[batchId]`):**
- Header: target andén name + code, scanned count / batch count
- Barcode scanner (reuses `useBarcodeScan` pattern from reception)
- Each scan validates: package exists, status is `en_bodega`, belongs to this andén's comunas + delivery date filter
- **Wrong zone**: rejected — "No pertenece a este lote" (triple beep, red flash)
- **Unmapped comuna**: rejected — "Comuna sin andén asignado — use modo rápido para enviar a consolidación"
- **Duplicate scan**: rejected — "Paquete ya escaneado" (triple beep)
- **Accepted**: success beep, green flash, added to batch
- Package list below scanner showing scanned vs. pending
- "Cerrar lote" button — operator decides when batch is complete (no minimum/maximum)

**Step 2c — Batch Confirmation (`/app/distribution/batch/[batchId]/confirm`):**
- Summary: batch package count, target andén
- "Escanear andén" prompt — operator scans the andén PK barcode
- System validates the scanned code matches the target `dock_zone.code`
- If mismatch: "Código de andén incorrecto — se esperaba DOCK-001" (reject, retry)
- If match: all packages in batch advance status (`sectorizado` or `retenido`), `packages.dock_zone_id` set, batch closed
- Success screen with count confirmation

### Screen 3 — Quick-Sort Scanning

**Route:** `/app/distribution/quicksort`

- Single-screen flow, no pre-grouping
- **State A — Scan Package:** Barcode scanner waiting for input
- **State B — Show Destination:** Large display showing target andén name + code (e.g., "→ Andén 3 · DOCK-003") or "→ Consolidación · CONSOL"
  - System auto-creates a single-item `dock_batches` record
  - For unmapped comuna: shows "→ Consolidación" + warning flag
- **State C — Scan Andén PK:** Prompt to scan the physical andén barcode
  - Validates code matches the displayed target
  - If match: package advances status, batch closed, returns to State A
  - If mismatch: "Andén incorrecto" — retry scan
- Running counter at top: "X paquetes sectorizados hoy"

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Package not `en_bodega` | Reject: "Paquete no está en bodega — estado actual: {status}" |
| Package already sectorized in same andén | Reject: "Paquete ya está en {andén name}" |
| Package sectorized in different andén (re-sectorization) | Accept in quick-sort mode: update `dock_zone_id` to new andén, create new scan record. Reject in batch mode (use quick-sort to re-sort). |
| Package from different operator | RLS prevents query — no result found |
| Barcode not found in system | Reject: "Código no encontrado" |
| Wrong andén code scanned | Reject: "Código de andén incorrecto — se esperaba {code}" |
| Unmapped comuna in batch mode | Rejected from batch — "Comuna sin andén asignado — use modo rápido para enviar a consolidación". Batch mode only accepts packages belonging to the target andén's comunas. |
| Unmapped comuna in quick-sort | Routed to consolidation + flagged. Quick-sort is the only mode that can process unmapped comunas (sends them to consolidation). |
| No andenes configured | Dashboard shows setup prompt linking to Settings |
| Batch with 0 scans closed | Prevented — "Lote vacío, escanee al menos un paquete" |

## Component Architecture

### Pages (`apps/frontend/src/app/app/`)

| File | Purpose |
|------|---------|
| `distribution/layout.tsx` | Permission guard — redirects if user lacks `distribution` |
| `distribution/page.tsx` | Screen 1: Distribution dashboard |
| `distribution/settings/page.tsx` | Screen 0: Andén maintenance |
| `distribution/batch/page.tsx` | Screen 2a: Batch overview (groups by andén) |
| `distribution/batch/[batchId]/page.tsx` | Screen 2b: Batch scanning |
| `distribution/batch/[batchId]/confirm/page.tsx` | Screen 2c: Batch confirmation + andén PK scan |
| `distribution/quicksort/page.tsx` | Screen 3: Quick-sort scanning |

### Components (`apps/frontend/src/components/distribution/`)

| File | Purpose |
|------|---------|
| `DockZoneList.tsx` | Andén maintenance table with CRUD actions |
| `DockZoneForm.tsx` | Create/edit andén form with comuna multi-select |
| `DistributionKPIs.tsx` | Three KPI cards (pending, consolidation, due soon) |
| `DockZoneGrid.tsx` | Active andenes card grid on dashboard |
| `ConsolidationPanel.tsx` | Consolidation alert panel with release action |
| `BatchOverview.tsx` | Groups pending packages by target andén |
| `BatchScanner.tsx` | Barcode scanner adapted for batch sectorization |
| `BatchDetailList.tsx` | Package list below scanner (scanned vs. pending) |
| `BatchConfirmation.tsx` | Batch summary + andén PK scan prompt |
| `QuickSortScanner.tsx` | Three-state quick-sort flow (scan → destination → confirm) |
| `UnmappedComunasBanner.tsx` | Warning banner for unmapped comunas |

### Hooks (`apps/frontend/src/hooks/distribution/`)

| File | Purpose |
|------|---------|
| `useDockZones.ts` | CRUD for `dock_zones` table |
| `useDockBatches.ts` | Create, close, list batches |
| `useDockScans.ts` | Insert scans, fetch scan history for a batch |
| `useSectorizationRules.ts` | Determine target andén for a package (comuna + delivery date logic) |
| `usePendingSectorization.ts` | Fetch `en_bodega` packages grouped by target andén |
| `useConsolidation.ts` | Fetch `retenido` packages, release action |
| `useDistributionKPIs.ts` | Aggregate counts for dashboard KPIs |

### Lib (`apps/frontend/src/lib/distribution/`)

| File | Purpose |
|------|---------|
| `sectorization-engine.ts` | Core logic: given a package + dock zones, determine target andén |
| `dock-scan-validator.ts` | Validate barcode against expected packages, detect duplicates/wrong zone |

## Component Reuse

From reception (adapted for distribution context):
- `useBarcodeScan` hook (hardware barcode scanner integration)
- Scanner audio/haptic/visual feedback patterns
- Detail list pattern (scanned vs. pending packages)
- Permission gating on layout

## Dashboard Pipeline Tab

Enable tab ④ "Distribución" in `/app/dashboard/operaciones` (currently exists at `apps/frontend/src/app/app/dashboard/operaciones/page.tsx` with `enabled: false` — flip to `enabled: true` and create a `DistributionTab` component):
- Summary metrics: pending sectorization, in consolidation, due soon
- Available to `ops_manager` and `admin` roles (not just `distribution` permission — managers need visibility)

## Offline Support

Distribution requires connectivity. The hub has reliable WiFi/LAN. Offline sectorization is not in scope.

## Story Breakdown

| Story | Title | Depends on |
|-------|-------|------------|
| D.0 | DB migration: `dock_zones`, `dock_batches`, `dock_scans` tables, enums, `sectorizado`/`retenido` status values, triggers, RLS, `packages.dock_zone_id` column | — |
| D.1 | Sectorization engine: `sectorization-engine.ts` + `dock-scan-validator.ts` with full unit tests | D.0 |
| D.2 | Andén maintenance UI: `DockZoneList` + `DockZoneForm` + `useDockZones` + settings page | D.0 |
| D.3 | Distribution dashboard: KPIs + andén grid + consolidation panel + release action | D.1 |
| D.4 | Batch scanning: overview + scanner + detail list + confirmation + andén PK validation | D.1, D.2 |
| D.5 | Quick-sort scanning: three-state flow + auto-batch creation | D.1, D.2 |
| D.6 | Nav integration: Add Distribución tab to sidebar + pipeline tab ④ in operaciones | D.0 |

## Testing Strategy

- **Unit tests:** `sectorization-engine` (comuna matching, delivery date filter, unmapped fallback), `dock-scan-validator` (acceptance, rejection, wrong zone, duplicate), `useDockZones`, `useDockBatches`, `useDockScans`, `useSectorizationRules`, `usePendingSectorization`, `useConsolidation`, `useDistributionKPIs`
- **Component tests:** DockZoneList, DockZoneForm, DistributionKPIs, DockZoneGrid, ConsolidationPanel, BatchOverview, BatchScanner, BatchDetailList, BatchConfirmation, QuickSortScanner, UnmappedComunasBanner, permission gating on layout and nav
- **Integration:** Package status `en_bodega` → `sectorizado`/`retenido`, `dock_zone_id` set correctly, order status auto-recalculation via trigger, batch close timestamp trigger, consolidation release flow (`retenido` → `en_bodega` → `sectorizado`), RLS on all new tables, one-consolidation-per-operator constraint

All TDD per project rules (Vitest + React Testing Library).
