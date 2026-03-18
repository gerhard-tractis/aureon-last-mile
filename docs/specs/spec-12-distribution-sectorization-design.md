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

---

## Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hub sectorization workflow — sorting `en_bodega` packages into dock zones by comuna and delivery date, with batch and quick-sort scanning modes, consolidation zone management, and a distribution dashboard.

**Architecture:** Frontend-first approach following reception patterns. DB migration creates tables/triggers/enums. Sectorization engine is pure TypeScript with full unit tests. UI follows existing page → component → hook → lib layering. All scanning reuses `useBarcodeScan` and feedback patterns from reception.

**Tech Stack:** Next.js 15, Supabase (Postgres + RLS), TanStack Query 5, Zustand (if needed), Vitest + React Testing Library, shadcn/ui components.

---

### Task D.0: DB Migration

**Files:**
- Create: `packages/database/supabase/migrations/20260319000001_create_distribution_tables.sql`
- Modify: `apps/frontend/src/lib/types/auth.types.ts` (add `'distribution'` to Permission union)

- [ ] **Step 1: Write the migration SQL**

```sql
-- =============================================================
-- Spec-11: Distribution Sectorization tables, enums, triggers
-- =============================================================

-- Step 1: Add new values to package_status_enum
-- MUST run outside transaction block
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'sectorizado';
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retenido';

-- Step 2: New enums
DO $$ BEGIN
  CREATE TYPE batch_status_enum AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE dock_scan_result_enum AS ENUM ('accepted', 'rejected', 'wrong_zone', 'unmapped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 3: dock_zones table
CREATE TABLE IF NOT EXISTS public.dock_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  name VARCHAR NOT NULL,
  code VARCHAR NOT NULL,
  is_consolidation BOOLEAN NOT NULL DEFAULT false,
  comunas TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- One consolidation zone per operator
CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_zones_one_consolidation
  ON public.dock_zones (operator_id)
  WHERE is_consolidation = true AND deleted_at IS NULL;

-- Unique code per operator
CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_zones_operator_code
  ON public.dock_zones (operator_id, code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dock_zones_operator_id ON public.dock_zones(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_zones_deleted_at ON public.dock_zones(deleted_at);

-- Step 4: dock_batches table
CREATE TABLE IF NOT EXISTS public.dock_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  dock_zone_id UUID NOT NULL REFERENCES public.dock_zones(id),
  status batch_status_enum NOT NULL DEFAULT 'open',
  created_by UUID NOT NULL REFERENCES public.users(id),
  closed_at TIMESTAMPTZ,
  package_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dock_batches_operator_id ON public.dock_batches(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_batches_dock_zone_id ON public.dock_batches(dock_zone_id);
CREATE INDEX IF NOT EXISTS idx_dock_batches_created_by ON public.dock_batches(created_by);
CREATE INDEX IF NOT EXISTS idx_dock_batches_deleted_at ON public.dock_batches(deleted_at);

-- Step 5: dock_scans table
CREATE TABLE IF NOT EXISTS public.dock_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id),
  batch_id UUID NOT NULL REFERENCES public.dock_batches(id),
  package_id UUID REFERENCES public.packages(id),
  barcode TEXT NOT NULL,
  scan_result dock_scan_result_enum NOT NULL,
  scanned_by UUID NOT NULL REFERENCES public.users(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dock_scans_unique_package_batch
  ON public.dock_scans (operator_id, batch_id, package_id)
  WHERE deleted_at IS NULL AND package_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dock_scans_operator_id ON public.dock_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_batch_id ON public.dock_scans(batch_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_package_id ON public.dock_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_dock_scans_deleted_at ON public.dock_scans(deleted_at);

-- Step 6: Add dock_zone_id to packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS dock_zone_id UUID REFERENCES public.dock_zones(id);

CREATE INDEX IF NOT EXISTS idx_packages_dock_zone_id ON public.packages(dock_zone_id);

-- Step 7: RLS policies
ALTER TABLE public.dock_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dock_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY dock_zones_tenant_isolation ON public.dock_zones
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY dock_batches_tenant_isolation ON public.dock_batches
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY dock_scans_tenant_isolation ON public.dock_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 8: Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_zones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_scans TO authenticated;
GRANT ALL ON public.dock_zones TO service_role;
GRANT ALL ON public.dock_batches TO service_role;
GRANT ALL ON public.dock_scans TO service_role;
REVOKE ALL ON public.dock_zones FROM anon;
REVOKE ALL ON public.dock_batches FROM anon;
REVOKE ALL ON public.dock_scans FROM anon;

-- Step 9: Audit + set_updated_at triggers (idempotent)
DO $$ BEGIN
  CREATE TRIGGER audit_dock_zones
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_zones
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_zones_updated_at
    BEFORE UPDATE ON public.dock_zones
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_batches
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_batches_updated_at
    BEFORE UPDATE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_scans
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dock_scans_updated_at
    BEFORE UPDATE ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 10: Domain trigger — advance package status on scan
CREATE OR REPLACE FUNCTION public.trg_dock_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_consolidation BOOLEAN;
  v_dock_zone_id UUID;
BEGIN
  IF NEW.scan_result = 'accepted' AND NEW.package_id IS NOT NULL THEN
    -- Look up target dock zone via batch
    SELECT dz.id, dz.is_consolidation
    INTO v_dock_zone_id, v_is_consolidation
    FROM public.dock_batches db
    JOIN public.dock_zones dz ON dz.id = db.dock_zone_id
    WHERE db.id = NEW.batch_id;

    -- Update package status and location
    UPDATE public.packages
    SET status = CASE WHEN v_is_consolidation THEN 'retenido' ELSE 'sectorizado' END,
        dock_zone_id = v_dock_zone_id,
        status_updated_at = NOW()
    WHERE id = NEW.package_id;

    -- Increment batch package_count
    UPDATE public.dock_batches
    SET package_count = package_count + 1
    WHERE id = NEW.batch_id;
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_dock_scan_status
    AFTER INSERT ON public.dock_scans
    FOR EACH ROW EXECUTE FUNCTION public.trg_dock_scan_advance_package_status();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 11: Domain trigger — batch close timestamp
CREATE OR REPLACE FUNCTION public.trg_dock_batch_close_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'closed' AND (OLD.status IS NULL OR OLD.status != 'closed') THEN
    NEW.closed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_dock_batch_close
    BEFORE UPDATE ON public.dock_batches
    FOR EACH ROW EXECUTE FUNCTION public.trg_dock_batch_close_timestamp();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Step 12: Update pipeline_position() with new statuses
CREATE OR REPLACE FUNCTION pipeline_position(p_status TEXT)
RETURNS INT AS $$
  SELECT CASE p_status
    WHEN 'ingresado'    THEN 1
    WHEN 'verificado'   THEN 2
    WHEN 'en_bodega'    THEN 3
    WHEN 'sectorizado'  THEN 4
    WHEN 'retenido'     THEN 5
    WHEN 'asignado'     THEN 6
    WHEN 'en_carga'     THEN 7
    WHEN 'listo'        THEN 8
    WHEN 'en_ruta'      THEN 9
    WHEN 'entregado'    THEN 10
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Step 13: Update recalculate_order_status() to handle package-only statuses
CREATE OR REPLACE FUNCTION recalculate_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
  v_min_pos INT;
  v_max_pos INT;
  v_min_status order_status_enum;
  v_max_status order_status_enum;
  v_active_count INT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT COUNT(*) INTO v_active_count
  FROM packages
  WHERE order_id = v_order_id
    AND deleted_at IS NULL
    AND pipeline_position(status::text) > 0;

  IF v_active_count = 0 THEN
    UPDATE orders SET
      status = 'cancelado',
      leading_status = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  -- Map positions back to order_status_enum values
  -- Positions 4 (sectorizado) and 5 (retenido) are package-only;
  -- map them back to 3 (en_bodega) for order-level status
  SELECT CASE
    WHEN v_min_pos <= 3 THEN
      CASE v_min_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_min_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_min_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
        WHEN 9 THEN 'en_ruta' WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_min_status;

  SELECT CASE
    WHEN v_max_pos <= 3 THEN
      CASE v_max_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_max_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_max_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
        WHEN 9 THEN 'en_ruta' WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_max_status;

  UPDATE orders SET
    status = v_min_status,
    leading_status = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Step 14: Permission backfill — warehouse and admin users get distribution
UPDATE public.users
SET permissions = array_append(permissions, 'distribution')
WHERE 'warehouse' = ANY(permissions)
  AND NOT ('distribution' = ANY(permissions))
  AND deleted_at IS NULL;

UPDATE public.users
SET permissions = array_append(permissions, 'distribution')
WHERE 'admin' = ANY(permissions)
  AND NOT ('distribution' = ANY(permissions))
  AND deleted_at IS NULL;
```

- [ ] **Step 2: Update Permission type in auth.types.ts**

Add `'distribution'` to the Permission union:
```typescript
export type Permission = 'pickup' | 'warehouse' | 'loading' | 'operations' | 'admin' | 'reception' | 'distribution';
```

- [ ] **Step 3: Apply migration locally**

Run: `cd packages/database && npx supabase db push` (or `npx supabase migration up` depending on local setup)
Verify: no errors, check tables exist with `\dt dock_*` in psql

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260319000001_create_distribution_tables.sql
git add apps/frontend/src/lib/types/auth.types.ts
git commit -m "feat(distribution): D.0 — DB migration for sectorization tables, enums, triggers"
```

---

### Task D.1: Sectorization Engine + Scan Validator

**Files:**
- Create: `apps/frontend/src/lib/distribution/sectorization-engine.ts`
- Create: `apps/frontend/src/lib/distribution/sectorization-engine.test.ts`
- Create: `apps/frontend/src/lib/distribution/dock-scan-validator.ts`
- Create: `apps/frontend/src/lib/distribution/dock-scan-validator.test.ts`

- [ ] **Step 1: Write failing tests for sectorization engine**

```typescript
// sectorization-engine.test.ts
import { describe, it, expect } from 'vitest';
import { determineDockZone, type DockZone, type PackageOrder } from './sectorization-engine';

const TODAY = '2026-03-18';
const TOMORROW = '2026-03-19';
const FUTURE = '2026-03-25';

const zones: DockZone[] = [
  { id: 'zone-1', name: 'Andén 1', code: 'DOCK-001', is_consolidation: false, comunas: ['las condes', 'vitacura'], is_active: true },
  { id: 'zone-2', name: 'Andén 2', code: 'DOCK-002', is_consolidation: false, comunas: ['providencia', 'ñuñoa'], is_active: true },
  { id: 'consol', name: 'Consolidación', code: 'CONSOL', is_consolidation: true, comunas: [], is_active: true },
];

describe('determineDockZone', () => {
  it('routes package to matching andén when delivery is today', () => {
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-1');
    expect(result.reason).toBe('matched');
  });

  it('routes package to matching andén when delivery is tomorrow', () => {
    const pkg: PackageOrder = { comuna: 'Providencia', delivery_date: TOMORROW };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-2');
    expect(result.reason).toBe('matched');
  });

  it('routes to consolidation when delivery date is future', () => {
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: FUTURE };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('future_date');
  });

  it('routes to consolidation when comuna is unmapped', () => {
    const pkg: PackageOrder = { comuna: 'Peñalolén', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('unmapped');
    expect(result.flagged).toBe(true);
  });

  it('matches comunas case-insensitively with trimming', () => {
    const pkg: PackageOrder = { comuna: '  LAS CONDES  ', delivery_date: TODAY };
    const result = determineDockZone(pkg, zones, TODAY);
    expect(result.zone_id).toBe('zone-1');
  });

  it('skips inactive zones', () => {
    const inactiveZones = zones.map(z =>
      z.id === 'zone-1' ? { ...z, is_active: false } : z
    );
    const pkg: PackageOrder = { comuna: 'Las Condes', delivery_date: TODAY };
    const result = determineDockZone(pkg, inactiveZones, TODAY);
    expect(result.zone_id).toBe('consol');
    expect(result.reason).toBe('unmapped');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/lib/distribution/sectorization-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement sectorization engine**

```typescript
// sectorization-engine.ts
export interface DockZone {
  id: string;
  name: string;
  code: string;
  is_consolidation: boolean;
  comunas: string[];
  is_active: boolean;
}

export interface PackageOrder {
  comuna: string;
  delivery_date: string; // YYYY-MM-DD
}

export type ZoneMatchReason = 'matched' | 'future_date' | 'unmapped';

export interface ZoneMatchResult {
  zone_id: string;
  zone_name: string;
  zone_code: string;
  is_consolidation: boolean;
  reason: ZoneMatchReason;
  flagged: boolean;
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

function isDeliveryDateActive(deliveryDate: string, today: string): boolean {
  const delivery = new Date(deliveryDate + 'T00:00:00');
  const todayDate = new Date(today + 'T00:00:00');
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return delivery <= tomorrow;
}

export function determineDockZone(
  pkg: PackageOrder,
  zones: DockZone[],
  today: string
): ZoneMatchResult {
  const consolidation = zones.find(z => z.is_consolidation);
  if (!consolidation) {
    throw new Error('No consolidation zone configured');
  }

  const makeResult = (zone: DockZone, reason: ZoneMatchReason, flagged = false): ZoneMatchResult => ({
    zone_id: zone.id,
    zone_name: zone.name,
    zone_code: zone.code,
    is_consolidation: zone.is_consolidation,
    reason,
    flagged,
  });

  // Check delivery date first
  if (!isDeliveryDateActive(pkg.delivery_date, today)) {
    return makeResult(consolidation, 'future_date');
  }

  // Find matching zone by comuna
  const normalizedComuna = normalize(pkg.comuna);
  const matchingZone = zones.find(
    z => !z.is_consolidation && z.is_active && z.comunas.some(c => normalize(c) === normalizedComuna)
  );

  if (matchingZone) {
    return makeResult(matchingZone, 'matched');
  }

  // Unmapped comuna — consolidation + flag
  return makeResult(consolidation, 'unmapped', true);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/lib/distribution/sectorization-engine.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Write failing tests for dock scan validator**

```typescript
// dock-scan-validator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { validateDockScan, type DockScanInput, type DockScanValidationResult } from './dock-scan-validator';

// Mock Supabase client
vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: vi.fn(() => mockSupabase),
}));

const mockSupabase = {
  from: vi.fn(() => mockSupabase),
  select: vi.fn(() => mockSupabase),
  eq: vi.fn(() => mockSupabase),
  is: vi.fn(() => mockSupabase),
  limit: vi.fn(() => mockSupabase),
  single: vi.fn(),
  in: vi.fn(() => mockSupabase),
};

describe('validateDockScan', () => {
  it('rejects when barcode not found', async () => {
    mockSupabase.single.mockResolvedValueOnce({ data: null, error: null }); // no duplicate
    mockSupabase.limit.mockResolvedValueOnce({ data: [], error: null }); // no package

    const result = await validateDockScan({
      barcode: 'UNKNOWN-123',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('no encontrado');
  });

  it('rejects duplicate scan in same batch', async () => {
    mockSupabase.limit.mockResolvedValueOnce({
      data: [{ id: 'existing-scan' }],
      error: null,
    });

    const result = await validateDockScan({
      barcode: 'PKG-001',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('ya escaneado');
  });

  it('rejects package not in en_bodega status', async () => {
    mockSupabase.limit.mockResolvedValueOnce({ data: [], error: null }); // no duplicate
    mockSupabase.limit.mockResolvedValueOnce({
      data: [{ id: 'pkg-1', label: 'PKG-001', status: 'verificado', order_id: 'ord-1' }],
      error: null,
    });

    const result = await validateDockScan({
      barcode: 'PKG-001',
      batchId: 'batch-1',
      targetZoneId: 'zone-1',
      operatorId: 'op-1',
      mode: 'batch',
    });

    expect(result.scanResult).toBe('rejected');
    expect(result.message).toContain('no está en bodega');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apps/frontend && npx vitest run src/lib/distribution/dock-scan-validator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 7: Implement dock scan validator**

Create `dock-scan-validator.ts` following the pattern from `reception-scan-validator.ts`:
- Check for duplicate scan in same batch
- Look up package by barcode label
- Validate package status is `en_bodega` (or `sectorizado` for re-sectorization in quick-sort mode)
- In batch mode: validate package's comuna belongs to target zone
- Return typed result with `scanResult`, `packageId`, `packageLabel`, `message`

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/frontend && npx vitest run src/lib/distribution/dock-scan-validator.test.ts`
Expected: All tests PASS

- [ ] **Step 9: Update reception-scan-validator.ts**

Add `'sectorizado'` and `'retenido'` to the `ALREADY_RECEIVED_STATUSES` array in `apps/frontend/src/lib/reception/reception-scan-validator.ts`. These are post-reception statuses — if a package is already sectorized, it should not be re-scanned during hub reception.

- [ ] **Step 10: Implement useSectorizationRules hook**

Create `apps/frontend/src/hooks/distribution/useSectorizationRules.ts` — a hook that wraps the sectorization engine for use in components. Given a package barcode, it fetches the package's order (to get comuna + delivery_date), fetches dock zones, and calls `determineDockZone`. Used by QuickSortScanner to determine where a scanned package should go.

- [ ] **Step 11: Commit**

```bash
git add apps/frontend/src/lib/distribution/ apps/frontend/src/lib/reception/reception-scan-validator.ts apps/frontend/src/hooks/distribution/useSectorizationRules.ts
git commit -m "feat(distribution): D.1 — sectorization engine + dock scan validator with tests"
```

---

### Task D.2: Andén Maintenance UI

**Files:**
- Create: `apps/frontend/src/hooks/distribution/useDockZones.ts`
- Create: `apps/frontend/src/components/distribution/DockZoneList.tsx`
- Create: `apps/frontend/src/components/distribution/DockZoneForm.tsx`
- Create: `apps/frontend/src/components/distribution/UnmappedComunasBanner.tsx`
- Create: `apps/frontend/src/app/app/distribution/layout.tsx`
- Create: `apps/frontend/src/app/app/distribution/settings/page.tsx`
- Test: collocated `*.test.ts` / `*.test.tsx` files

- [ ] **Step 1: Write failing test for useDockZones hook**

Test the hook returns dock zones for the operator, supports create/update/delete mutations.
Follow `useReceptionManifests` pattern: `useQuery` with `queryKey: ['distribution', 'dock-zones', operatorId]`.

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement useDockZones hook**

```typescript
// useDockZones.ts
export function useDockZones(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'dock-zones', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('dock_zones')
        .select('id, name, code, is_consolidation, comunas, is_active')
        .eq('operator_id', operatorId!)
        .is('deleted_at', null)
        .order('is_consolidation', { ascending: false })
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}

export function useCreateDockZone() { /* useMutation pattern */ }
export function useUpdateDockZone() { /* useMutation pattern */ }
export function useDeleteDockZone() { /* useMutation — soft delete */ }
export function useEnsureConsolidationZone() { /* create if not exists */ }
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Write failing test for DockZoneList component**

Test: renders list of zones, shows consolidation at top, shows "Agregar andén" button, handles empty state.

- [ ] **Step 6: Run test, verify fail**

- [ ] **Step 7: Implement DockZoneList + DockZoneForm + UnmappedComunasBanner**

Follow `ReceptionList` + `ReceptionCard` patterns. Use shadcn `Table`, `Badge` for comunas, `Switch` for active toggle, `Dialog` for form modal.

- [ ] **Step 8: Run test, verify pass**

- [ ] **Step 9: Write failing test for permission guard layout**

Test: users without `distribution` permission get redirected. Follow `reception/layout.tsx` exactly.

- [ ] **Step 10: Run test, verify fail**

- [ ] **Step 11: Implement distribution layout + settings page**

```typescript
// distribution/layout.tsx — identical pattern to reception/layout.tsx
// distribution/settings/page.tsx — renders DockZoneList + DockZoneForm
```

- [ ] **Step 12: Run test, verify pass**

- [ ] **Step 13: Commit**

```bash
git add apps/frontend/src/hooks/distribution/ apps/frontend/src/components/distribution/ apps/frontend/src/app/app/distribution/
git commit -m "feat(distribution): D.2 — andén maintenance UI with CRUD and permission guard"
```

---

### Task D.3: Distribution Dashboard

**Files:**
- Create: `apps/frontend/src/hooks/distribution/useDistributionKPIs.ts`
- Create: `apps/frontend/src/hooks/distribution/useConsolidation.ts`
- Create: `apps/frontend/src/components/distribution/DistributionKPIs.tsx`
- Create: `apps/frontend/src/components/distribution/DockZoneGrid.tsx`
- Create: `apps/frontend/src/components/distribution/ConsolidationPanel.tsx`
- Create: `apps/frontend/src/app/app/distribution/page.tsx`
- Test: collocated test files

- [ ] **Step 1: Write failing test for useDistributionKPIs**

Test: returns three counts — pending (`en_bodega`), consolidation (`retenido`), due soon (`retenido` with delivery_date ≤ tomorrow).

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement useDistributionKPIs**

```typescript
export function useDistributionKPIs(operatorId: string | null) {
  return useQuery({
    queryKey: ['distribution', 'kpis', operatorId],
    queryFn: async () => {
      const supabase = createSPAClient();
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

      // Pending: packages in en_bodega
      const { count: pending } = await supabase
        .from('packages')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId!)
        .eq('status', 'en_bodega')
        .is('deleted_at', null);

      // In consolidation: packages in retenido
      const { count: consolidation } = await supabase
        .from('packages')
        .select('id', { count: 'exact', head: true })
        .eq('operator_id', operatorId!)
        .eq('status', 'retenido')
        .is('deleted_at', null);

      // Due soon: retenido packages with delivery_date <= tomorrow
      // Requires join through orders
      const { count: dueSoon } = await supabase
        .from('packages')
        .select('id, orders!inner(delivery_date)', { count: 'exact', head: true })
        .eq('operator_id', operatorId!)
        .eq('status', 'retenido')
        .is('deleted_at', null)
        .lte('orders.delivery_date', tomorrow);

      return { pending: pending ?? 0, consolidation: consolidation ?? 0, dueSoon: dueSoon ?? 0 };
    },
    enabled: !!operatorId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Write failing test for useConsolidation**

Test: returns `retenido` packages grouped by delivery date, supports release mutation (sets status back to `en_bodega`, clears `dock_zone_id`).

- [ ] **Step 6: Run test, verify fail**

- [ ] **Step 7: Implement useConsolidation hook**

Include `releaseFromConsolidation` mutation that updates selected packages: `status = 'en_bodega'`, `dock_zone_id = null`.

- [ ] **Step 8: Run test, verify pass**

- [ ] **Step 9: Write failing tests for dashboard components**

Test DistributionKPIs renders three cards, DockZoneGrid renders andén cards, ConsolidationPanel shows grouped packages with release button.

- [ ] **Step 10: Run tests, verify fail**

- [ ] **Step 11: Implement DistributionKPIs + DockZoneGrid + ConsolidationPanel**

Follow `MetricsCard` pattern for KPIs. Use `Card` from shadcn for andén grid. ConsolidationPanel groups by date with urgency highlighting for tomorrow's packages.

- [ ] **Step 12: Run tests, verify pass**

- [ ] **Step 13: Implement distribution/page.tsx**

Wire up: KPIs at top, DockZoneGrid in middle, ConsolidationPanel at bottom. Show setup prompt if no andenes configured.

- [ ] **Step 14: Commit**

```bash
git add apps/frontend/src/hooks/distribution/ apps/frontend/src/components/distribution/ apps/frontend/src/app/app/distribution/page.tsx
git commit -m "feat(distribution): D.3 — distribution dashboard with KPIs, andén grid, consolidation panel"
```

---

### Task D.4: Batch Scanning

**Files:**
- Create: `apps/frontend/src/hooks/distribution/useDockBatches.ts`
- Create: `apps/frontend/src/hooks/distribution/useDockScans.ts`
- Create: `apps/frontend/src/hooks/distribution/usePendingSectorization.ts`
- Create: `apps/frontend/src/components/distribution/BatchOverview.tsx`
- Create: `apps/frontend/src/components/distribution/BatchScanner.tsx`
- Create: `apps/frontend/src/components/distribution/BatchDetailList.tsx`
- Create: `apps/frontend/src/components/distribution/BatchConfirmation.tsx`
- Create: `apps/frontend/src/app/app/distribution/batch/page.tsx`
- Create: `apps/frontend/src/app/app/distribution/batch/[batchId]/page.tsx`
- Create: `apps/frontend/src/app/app/distribution/batch/[batchId]/confirm/page.tsx`
- Test: collocated test files

- [ ] **Step 1: Write failing test for usePendingSectorization**

Test: fetches `en_bodega` packages, groups them by target andén using sectorization engine.

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement usePendingSectorization**

Fetch all `en_bodega` packages with their order's comuna + delivery_date, run `determineDockZone` for each, group by zone_id. Return `Map<string, { zone: DockZone, packages: Package[] }>`.

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Write failing test for useDockBatches**

Test: create batch mutation, close batch mutation, list batches for a zone.

- [ ] **Step 6: Run test, verify fail**

- [ ] **Step 7: Implement useDockBatches + useDockScans**

Follow `useHubReceptions` + `useReceptionScans` patterns. Create mutation inserts `dock_batches` row. Scan mutation calls `validateDockScan` then inserts `dock_scans` row. Include audio feedback via `playFeedback()`.

- [ ] **Step 8: Run test, verify pass**

- [ ] **Step 9: Write failing tests for BatchOverview, BatchScanner, BatchDetailList, BatchConfirmation**

Test: BatchOverview shows groups with "Iniciar lote" buttons. BatchScanner shows scanner with feedback. BatchDetailList shows scanned vs. pending. BatchConfirmation validates andén PK code match.

- [ ] **Step 10: Run tests, verify fail**

- [ ] **Step 11: Implement batch components**

- `BatchOverview`: card per group, "Iniciar lote" creates batch and navigates to `batch/[batchId]`
- `BatchScanner`: reuses `ReceptionScanner` pattern with `onScan` callback, shows last scan feedback
- `BatchDetailList`: follows `ReceptionDetailList` pattern — scanned items green, pending items gray
- `BatchConfirmation`: summary + andén PK scanner. Validates scanned code matches `dock_zone.code`. On match: closes batch (status → `closed`). Shows success with count.

- [ ] **Step 12: Run tests, verify pass**

- [ ] **Step 13: Implement batch pages**

- `batch/page.tsx`: renders BatchOverview with pending sectorization data
- `batch/[batchId]/page.tsx`: renders BatchScanner + BatchDetailList, "Cerrar lote" navigates to confirm
- `batch/[batchId]/confirm/page.tsx`: renders BatchConfirmation, success redirects to `/app/distribution`

- [ ] **Step 14: Commit**

```bash
git add apps/frontend/src/hooks/distribution/ apps/frontend/src/components/distribution/ apps/frontend/src/app/app/distribution/batch/
git commit -m "feat(distribution): D.4 — batch scanning with overview, scanner, detail list, confirmation"
```

---

### Task D.5: Quick-Sort Scanning

**Files:**
- Create: `apps/frontend/src/components/distribution/QuickSortScanner.tsx`
- Create: `apps/frontend/src/app/app/distribution/quicksort/page.tsx`
- Test: collocated test files

- [ ] **Step 1: Write failing test for QuickSortScanner**

Test: three-state flow (scan_package → show_destination → scan_anden). Verify: scans package, shows destination with large text, scans andén PK, validates code match, returns to initial state. Running counter increments.

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Implement QuickSortScanner**

Three states managed by `useState<'scan_package' | 'show_destination' | 'scan_anden'>`:

**State A (scan_package):** Scanner waiting. On scan → look up package, call `determineDockZone`, auto-create batch, transition to B.

**State B (show_destination):** Large display: "→ {zone.name} · {zone.code}". If unmapped: yellow warning. "Escanear andén" button or auto-transition to C.

**State C (scan_anden):** Scanner waiting for andén PK. On scan → validate code matches. If match: insert `dock_scans` with `accepted`, close batch, increment counter, transition to A. If mismatch: error feedback, stay in C.

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Implement quicksort page**

```typescript
// quicksort/page.tsx
'use client';
import { QuickSortScanner } from '@/components/distribution/QuickSortScanner';
import { useOperatorId } from '@/hooks/useOperatorId';
import { useGlobal } from '@/hooks/useGlobal';
import { useDockZones } from '@/hooks/distribution/useDockZones';
import { Skeleton } from '@/components/ui/skeleton';

export default function QuickSortPage() {
  const { operatorId } = useOperatorId();
  const { user } = useGlobal();
  const { data: zones } = useDockZones(operatorId);

  if (!operatorId || !zones || !user?.id) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="p-4">
      <QuickSortScanner
        operatorId={operatorId}
        userId={user.id}
        zones={zones}
      />
    </div>
  );
}
```

**Note:** `useOperatorId()` returns `{ operatorId, role, permissions }`. For `userId`, use `useGlobal()` which provides `{ user }` where `user.id` is the authenticated user's UUID. This pattern applies to all pages that need `userId` for `scanned_by` or `created_by` fields.

- [ ] **Step 6: Run all distribution tests**

Run: `cd apps/frontend && npx vitest run src/lib/distribution/ src/components/distribution/ src/hooks/distribution/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/distribution/QuickSortScanner* apps/frontend/src/app/app/distribution/quicksort/
git commit -m "feat(distribution): D.5 — quick-sort scanning with three-state flow"
```

---

### Task D.6: Navigation Integration

**Files:**
- Modify: `apps/frontend/src/components/AppLayout.tsx` (add distribution nav entry)
- Modify: `apps/frontend/src/app/app/dashboard/operaciones/page.tsx` (enable tab ④)
- Create: `apps/frontend/src/components/dashboard/DistributionTab.tsx`
- Test: collocated test files

- [ ] **Step 1: Write failing test for nav entry**

Test: users with `distribution` permission see the Distribución link. Users without it don't.

- [ ] **Step 2: Run test, verify fail**

- [ ] **Step 3: Add distribution nav entry to AppLayout**

Follow the reception pattern — add after the reception link:
```typescript
{distributionAllowed && (
  <Link
    href="/app/distribution"
    className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
      pathname.startsWith('/app/distribution')
        ? 'bg-primary-50 text-primary-600'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`}
  >
    <ArrowLeftRight className={`mr-3 h-5 w-5 ...`} />
    Distribución
  </Link>
)}
```

Add `const distributionAllowed = hasPermission(permissions, 'distribution');` alongside existing permission checks.

- [ ] **Step 4: Run test, verify pass**

- [ ] **Step 5: Enable distribution tab in operaciones**

In `operaciones/page.tsx`, change:
```typescript
{ id: 'distribution', step: '④', label: 'Distribución', enabled: true },
```

Add conditional render:
```typescript
{activeTab === 'distribution' && <DistributionTab operatorId={operatorId} />}
```

- [ ] **Step 6: Implement DistributionTab component**

Lightweight summary component showing the 3 KPIs (pending, consolidation, due soon) using `useDistributionKPIs`. Links to `/app/distribution` for full view.

- [ ] **Step 7: Run all tests**

Run: `cd apps/frontend && npx vitest run`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/components/AppLayout.tsx apps/frontend/src/app/app/dashboard/operaciones/page.tsx apps/frontend/src/components/dashboard/DistributionTab.tsx
git commit -m "feat(distribution): D.6 — nav integration + pipeline tab ④ enabled"
```

---

### Dependency Graph

```
D.0 (DB migration) ─────┬──→ D.1 (Engine + Validator) ──┬──→ D.3 (Dashboard)
                         │                                ├──→ D.4 (Batch scan)
                         ├──→ D.2 (Andén maintenance) ───┤
                         │                                └──→ D.5 (Quick-sort)
                         └──→ D.6 (Nav integration)
```

**Parallelizable after D.0:** D.1, D.2, and D.6 can run in parallel. After D.1+D.2 complete, D.3, D.4, and D.5 can run in parallel.
