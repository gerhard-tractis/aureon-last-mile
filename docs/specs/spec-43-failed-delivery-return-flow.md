# Spec-43: Failed Delivery Return Flow

**Date:** 2026-05-12  
**Status:** backlog  
**Branch:** `feat/spec-43-failed-delivery-return-flow`

---

## Problem

When a driver cannot complete a delivery, DispatchTrack fires a webhook (`status: 3` rejected or `status: 4` partial). Today the system has no state to represent this condition — the order stays `en_ruta` indefinitely, the Ops Control Reingresos panel is hardcoded to an empty list, and the Reception Hub has no way to process returning packages.

---

## Goals

1. Automatically transition affected packages and orders to a "returning to hub" state when DispatchTrack reports a failed or partial delivery.
2. Surface these orders in Ops Control → Reingresos with failure reason and SLA age.
3. Let the hub receptionist scan returning packages in a dedicated tab inside Reception Hub, grouped by route.
4. Return received packages to `en_bodega` so the full delivery pipeline can restart.

---

## Out of Scope

- Re-scheduling logic (deciding when to attempt re-delivery is a future spec).
- `Cambios y Devoluciones` (retailer-initiated returns) — that remains a placeholder.
- Manual override of return status by an operator.

---

## Status Design

### New package status: `retorno_hub`

Non-terminal. A package enters this state when its delivery is rejected by DispatchTrack. It can transition back to `en_bodega` once received at the hub.

```
en_ruta → retorno_hub → en_bodega → (pipeline restarts)
en_ruta → entregado              (happy path, unchanged)
```

`devuelto` remains a separate terminal state meaning "package permanently returned to retailer — no further action."

### New order statuses

| Status | Meaning | Trigger |
|---|---|---|
| `en_retorno` | All packages on this order failed delivery and are returning to hub | DT `status: 3` |
| `parcialmente_entregado` | Some packages were delivered; remaining packages are returning to hub | DT `status: 4` |

**Order lifecycle for returns:**

```
en_ruta → (DT status 3) → en_retorno
en_ruta → (DT status 4) → parcialmente_entregado
en_retorno | parcialmente_entregado → (all retorno_hub packages received at hub) → en_bodega
en_bodega → (normal pipeline) → ... → entregado
```

### Failure reason columns on `packages`

| Column | Type | Source |
|---|---|---|
| `return_reason` | `TEXT` | DT `substatus` (e.g. "Nadie en casa") |
| `return_reason_code` | `VARCHAR(10)` | DT `substatus_code` (e.g. "07") |

Populated by the webhook handler. Shown in Reingresos and the Reception Hub Retornos tab.

---

## DB Migrations

### Migration 1 — Extend status enums + add return reason columns

```sql
-- Add retorno_hub to package_status_enum
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retorno_hub' BEFORE 'cancelado';

-- Add en_retorno and parcialmente_entregado to order_status_enum
-- Note: orders table uses a TEXT status column with a CHECK constraint, not a named enum.
-- Verify constraint name before altering. Pattern: CHECK (status IN (...))
-- Extend the CHECK constraint to include the two new values.
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'ingresado', 'verificado', 'en_bodega', 'asignado',
    'en_carga', 'listo', 'en_ruta', 'entregado', 'cancelado',
    'en_retorno', 'parcialmente_entregado'
  ));

-- Add return reason columns to packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_reason_code VARCHAR(10);

-- Index to support fast Reingresos queries
CREATE INDEX IF NOT EXISTS idx_orders_return_statuses
  ON public.orders(operator_id, status)
  WHERE status IN ('en_retorno', 'parcialmente_entregado');

CREATE INDEX IF NOT EXISTS idx_packages_retorno_hub
  ON public.packages(order_id, status)
  WHERE status = 'retorno_hub';
```

### Migration 2 — `process_failed_delivery` RPC

Called by n8n when DT fires `status` 3 or 4.

**Partial delivery note (status 4):** The DispatchTrack webhook payload does not provide package-level delivery granularity — only an order-level `status: 4` signal. Therefore for both status 3 and status 4, ALL non-terminal packages on the order are moved to `retorno_hub`. The difference between the two is only the resulting order status (`en_retorno` vs `parcialmente_entregado`). If DT later exposes per-package outcome, this RPC can be extended with a `p_delivered_barcodes TEXT[]` parameter.

```sql
CREATE OR REPLACE FUNCTION process_failed_delivery(
  p_order_number    TEXT,
  p_dt_status       INT,        -- 3 = rejected, 4 = partial
  p_substatus       TEXT,
  p_substatus_code  TEXT,
  p_operator_id     UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_order_id        UUID;
  v_returning_count INT;
  v_new_order_status TEXT;
BEGIN
  -- Resolve order
  SELECT id INTO v_order_id
  FROM orders
  WHERE order_number = p_order_number
    AND operator_id  = p_operator_id
    AND deleted_at IS NULL;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'order_not_found');
  END IF;

  -- Determine new order status
  v_new_order_status := CASE p_dt_status
    WHEN 3 THEN 'en_retorno'
    WHEN 4 THEN 'parcialmente_entregado'
    ELSE NULL
  END;

  IF v_new_order_status IS NULL THEN
    RETURN jsonb_build_object('error', 'unsupported_dt_status');
  END IF;

  -- Move all non-terminal packages to retorno_hub
  -- Idempotent: skips packages already in terminal states or already retorno_hub
  UPDATE packages
  SET status             = 'retorno_hub',
      return_reason      = p_substatus,
      return_reason_code = p_substatus_code,
      status_updated_at  = NOW(),
      updated_at         = NOW()
  WHERE order_id = v_order_id
    AND status NOT IN ('entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado', 'retorno_hub')
    AND deleted_at IS NULL;

  -- Update order status
  UPDATE orders
  SET status     = v_new_order_status,
      updated_at = NOW()
  WHERE id = v_order_id;

  SELECT COUNT(*) INTO v_returning_count
  FROM packages
  WHERE order_id = v_order_id
    AND status   = 'retorno_hub'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'order_id',        v_order_id,
    'returning_count', v_returning_count
  );
END;
$$;
```

### Migration 3 — `return_receptions` and `return_reception_scans` tables

> **Enum reuse:** `hub_reception_status_enum` (`pending | in_progress | completed`) and `reception_scan_result_enum` (`received | not_found | duplicate`) are pre-existing types created in migration `20260318000001_create_hub_reception_tables.sql` (spec-08). They are reused here without redefinition.

```sql
-- ── return_receptions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_receptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id       UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  external_route_id TEXT NOT NULL,
  received_by       UUID REFERENCES public.users(id),
  status            hub_reception_status_enum NOT NULL DEFAULT 'pending',
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  expected_count    INT NOT NULL DEFAULT 0,
  received_count    INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

COMMENT ON TABLE public.return_receptions IS
  'Return reception sessions — tracks hub receipt of packages returning after failed delivery. Grouped by DT route.';
COMMENT ON COLUMN public.return_receptions.external_route_id IS
  'DispatchTrack route_id (TEXT cast from integer). Groups all returning packages from one route.';

CREATE INDEX IF NOT EXISTS idx_return_receptions_operator_id
  ON public.return_receptions(operator_id);
CREATE INDEX IF NOT EXISTS idx_return_receptions_route
  ON public.return_receptions(operator_id, external_route_id);
CREATE INDEX IF NOT EXISTS idx_return_receptions_status
  ON public.return_receptions(operator_id, status);

ALTER TABLE public.return_receptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "return_receptions_tenant_isolation" ON public.return_receptions
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── return_reception_scans ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.return_reception_scans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_reception_id   UUID NOT NULL REFERENCES public.return_receptions(id),
  package_id            UUID REFERENCES public.packages(id),
  operator_id           UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  scanned_by            UUID REFERENCES public.users(id),
  barcode               TEXT NOT NULL,
  scan_result           reception_scan_result_enum NOT NULL,
  scanned_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

COMMENT ON TABLE public.return_reception_scans IS
  'Individual barcode scans during a return reception session.';
COMMENT ON COLUMN public.return_reception_scans.package_id IS
  'NULL when scan_result = not_found (barcode not found among expected returning packages).';

CREATE INDEX IF NOT EXISTS idx_return_reception_scans_reception
  ON public.return_reception_scans(return_reception_id);
CREATE INDEX IF NOT EXISTS idx_return_reception_scans_package
  ON public.return_reception_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_return_reception_scans_operator
  ON public.return_reception_scans(operator_id);

ALTER TABLE public.return_reception_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "return_reception_scans_tenant_isolation" ON public.return_reception_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### Migration 4 — `get_ops_control_snapshot` RPC update

Add a `returns` key alongside the existing `orders`, `routes`, `manifests`, `sla_config`. One row per order (using `DISTINCT ON`), with the most recent package reason.

```sql
'returns', COALESCE((
  SELECT jsonb_agg(row)
  FROM (
    SELECT DISTINCT ON (o.id)
      jsonb_build_object(
        'id',                 o.id,
        'order_number',       o.order_number,
        'retailer_name',      o.retailer_name,
        'status',             o.status,
        'return_reason',      p.return_reason,
        'return_reason_code', p.return_reason_code,
        'age_minutes',        EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60
      ) AS row
    FROM orders o
    JOIN packages p
      ON p.order_id   = o.id
     AND p.status     = 'retorno_hub'
     AND p.deleted_at IS NULL
    WHERE o.operator_id = p_operator_id
      AND o.status IN ('en_retorno', 'parcialmente_entregado')
      AND o.deleted_at IS NULL
    ORDER BY o.id, p.updated_at DESC  -- picks the most-recently-updated package reason
  ) sub
), '[]'::jsonb),
```

### Migration 5 — `complete_return_reception_scan` RPC

Called once per successful barcode scan in the Retornos tab. Moves the package to `en_bodega`, records the scan, and promotes the order to `en_bodega` when all its `retorno_hub` packages have been received.

```sql
CREATE OR REPLACE FUNCTION complete_return_reception_scan(
  p_package_id          UUID,
  p_return_reception_id UUID,
  p_scanned_by          UUID,
  p_barcode             TEXT,
  p_operator_id         UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_order_id            UUID;
  v_remaining_count     INT;
  v_order_promoted      BOOLEAN := FALSE;
BEGIN
  -- Validate package belongs to operator and is in retorno_hub
  SELECT order_id INTO v_order_id
  FROM packages
  WHERE id          = p_package_id
    AND operator_id = p_operator_id
    AND status      = 'retorno_hub'
    AND deleted_at IS NULL;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found_or_wrong_status');
  END IF;

  -- Move package back to active pipeline
  UPDATE packages
  SET status            = 'en_bodega',
      status_updated_at = NOW(),
      updated_at        = NOW()
  WHERE id = p_package_id;

  -- Record scan
  INSERT INTO return_reception_scans
    (return_reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
  VALUES
    (p_return_reception_id, p_package_id, p_operator_id, p_scanned_by, p_barcode, 'received', NOW());

  -- Increment received_count on the session
  UPDATE return_receptions
  SET received_count = received_count + 1,
      updated_at     = NOW()
  WHERE id = p_return_reception_id;

  -- Check if this was the last retorno_hub package on the order
  SELECT COUNT(*) INTO v_remaining_count
  FROM packages
  WHERE order_id  = v_order_id
    AND status    = 'retorno_hub'
    AND deleted_at IS NULL;

  IF v_remaining_count = 0 THEN
    UPDATE orders
    SET status     = 'en_bodega',
        updated_at = NOW()
    WHERE id = v_order_id;
    v_order_promoted := TRUE;
  END IF;

  -- return_reason / return_reason_code are intentionally preserved on the package
  -- record after this transition — they serve as audit history for why the package
  -- was returned, useful for re-delivery planning and reporting.

  RETURN jsonb_build_object(
    'package_id',     p_package_id,
    'order_id',       v_order_id,
    'order_promoted', v_order_promoted,
    'remaining',      v_remaining_count
  );
END;
$$;
```

---

## n8n Workflow Change

In the existing Paris DispatchTrack n8n workflow, add a branch after receiving a `dispatch` event:

```
IF payload.status IN (3, 4)
  → Call Supabase RPC: process_failed_delivery(
      p_order_number   = payload.identifier,
      p_dt_status      = payload.status,
      p_substatus      = payload.substatus,
      p_substatus_code = payload.substatus_code,
      p_operator_id    = <paris operator UUID>
    )
```

The existing happy-path branch (status 2 → `entregado`) is unchanged.

---

## Frontend Changes

### `apps/frontend/src/lib/types/pipeline.ts`

```ts
// PackageStatus — add retorno_hub (non-terminal, between en_ruta and en_bodega)
type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'retorno_hub' | 'entregado'
  | 'cancelado' | 'devuelto' | 'dañado' | 'extraviado';

// TERMINAL_PACKAGE_STATUSES — retorno_hub is NOT added (it is non-terminal)

// OrderStatus — add two new values
type OrderStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado' | 'cancelado'
  | 'en_retorno' | 'parcialmente_entregado';

// PIPELINE_STAGES: add display entries for new order statuses
{ status: 'en_retorno',             label: 'En Retorno',              icon: 'RotateCcw',   position: 7.5 },
{ status: 'parcialmente_entregado', label: 'Parcialmente Entregado',  icon: 'PackageOpen', position: 7.5 },
```

### `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts`

Line 76 — change from:
```ts
returns: [] as ReturnRow[], // No returns table yet
```
to:
```ts
returns: (result?.returns ?? []) as ReturnRow[],
```

`EXCLUDED_ORDER_STATUSES` stays as `{ 'entregado', 'cancelado' }` — no change needed. Orders in `en_retorno` / `parcialmente_entregado` pass through to the snapshot and appear in Reingresos. The existing realtime subscription on the `orders` channel handles live updates automatically.

### Reception Hub — new "Retornos" tab

**Page:** `/app/reception` gains a tab switcher: `Ingresos` (existing flow) | `Retornos` (new).

**New components** (all inside `apps/frontend/src/app/app/reception/`):

| Component | Responsibility |
|---|---|
| `ReturnRouteList` | Lists distinct `external_route_id` values from `retorno_hub` packages. Shows driver name + returning package count. Sorted oldest-first. |
| `ReturnReceptionSession` | Scan session for a selected route. Mirrors `ReceptionScan`. Calls `complete_return_reception_scan` RPC on each successful scan. |
| `useReturnRoutes` hook | Queries Supabase for packages where `status = retorno_hub`, grouped by `external_route_id`. |
| `useReturnReceptionSession` hook | Creates/resumes a `return_receptions` row; exposes scan handler. |

**On scan success (inside `useReturnReceptionSession`):**
1. Call `complete_return_reception_scan(p_package_id, p_return_reception_id, p_scanned_by, p_barcode, p_operator_id)`.
2. RPC moves package to `en_bodega`, records scan, optionally promotes order.
3. Hook updates local session state (received count, remaining list).

**On scan not_found:**  
Insert a `return_reception_scans` row with `scan_result = 'not_found'`, show error feedback to receptionist. Package state unchanged.

**Return reason display:** each package row in the session shows `return_reason` so the receptionist understands why the item came back.

---

## Test Plan

| Layer | Tests |
|---|---|
| `process_failed_delivery` RPC | status 3 → all packages `retorno_hub` + order `en_retorno`; status 4 → all non-terminal packages `retorno_hub` + order `parcialmente_entregado`; duplicate webhook (package already `retorno_hub`) is skipped; unknown `order_number` returns error |
| `complete_return_reception_scan` RPC | package moves to `en_bodega`; scan row recorded; order promoted to `en_bodega` when last `retorno_hub` package received; order NOT promoted when other `retorno_hub` packages remain; package not in `retorno_hub` returns error |
| `get_ops_control_snapshot` | `returns` array populated with one row per order (not per package); empty when no returning orders; `age_minutes` present |
| `useOpsControlSnapshot` hook | `returns` reads from RPC result (not hardcoded `[]`) |
| `ReturnsPanel` | renders `return_reason` column; shows age and SLA |
| `ReturnRouteList` | groups by route; shows count; empty state when no returning packages |
| `ReturnReceptionSession` | scan success → package removed from list; scan not_found → error shown; duplicate scan handled |
| `pipeline.ts` | `retorno_hub` present in `PackageStatus`; NOT in `TERMINAL_PACKAGE_STATUSES`; `en_retorno` and `parcialmente_entregado` present in `OrderStatus` |

---

## Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When DispatchTrack reports a failed delivery (status 3 or 4), automatically transition packages to `retorno_hub` and orders to `en_retorno`/`parcialmente_entregado`; surface them in Ops Control Reingresos tab; let receptionists scan them back to `en_bodega` via a Retornos tab in the Reception Hub.

**Architecture:** n8n webhook handler calls `process_failed_delivery` Supabase RPC on DT status 3/4; the RPC transitions statuses and records return metadata on packages (`return_route_id`, `return_reason`). The ops-control snapshot RPC gains a `returns` key via LATERAL JOIN. Two new hooks (`useReturnRoutes`, `useReturnReceptionSession`) drive the Reception Hub Retornos tab. A second RPC (`complete_return_reception_scan`) moves packages back to `en_bodega` and records each scan.

**Tech Stack:** PostgreSQL ENUMs · Supabase RPCs · TanStack Query · React/Next.js · Vitest · n8n workflow (manual JSON edit)

---

### File Map

| File | Action | Purpose |
|---|---|---|
| `packages/database/supabase/migrations/20260512000001_add_return_statuses.sql` | Create | Extend `package_status_enum` and `order_status_enum`; add `return_route_id`/`return_reason` columns to `packages` |
| `packages/database/supabase/migrations/20260512000002_process_failed_delivery.sql` | Create | `process_failed_delivery` RPC |
| `packages/database/supabase/migrations/20260512000003_create_return_reception_tables.sql` | Create | `return_receptions` + `return_reception_scans` tables and RLS policies |
| `packages/database/supabase/migrations/20260512000004_snapshot_returns.sql` | Create | `get_ops_control_snapshot` rewrite with `returns` key |
| `packages/database/supabase/migrations/20260512000005_complete_return_reception_scan.sql` | Create | `complete_return_reception_scan` RPC |
| `apps/frontend/src/lib/types/pipeline.ts` | Modify | Add `retorno_hub` to `PackageStatus`; add `en_retorno`, `parcialmente_entregado` to `OrderStatus` |
| `apps/frontend/src/lib/types/pipeline.test.ts` | Modify | Add tests for new statuses |
| `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts` | Modify | Line 76: replace hardcoded `[]` with `(result?.returns ?? []) as ReturnRow[]` |
| `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.test.ts` | Modify | Update returns assertion to verify RPC data is used |
| `apps/frontend/src/hooks/reception/useReturnRoutes.ts` | Create | Queries packages in `retorno_hub` grouped by `return_route_id` |
| `apps/frontend/src/hooks/reception/useReturnRoutes.test.ts` | Create | Tests for `useReturnRoutes` |
| `apps/frontend/src/hooks/reception/useReturnReceptionSession.ts` | Create | Manages a return reception session; exposes scan handler calling `complete_return_reception_scan` |
| `apps/frontend/src/hooks/reception/useReturnReceptionSession.test.ts` | Create | Tests for `useReturnReceptionSession` |
| `apps/frontend/src/app/app/reception/page.tsx` | Modify | Add Retornos tab using `useReturnRoutes` with inline scan Dialog |

---

## Chunk 1: DB Migrations 1-3

### Task 1: Extend ENUMs and add columns to packages

**Files:**
- Create: `packages/database/supabase/migrations/20260512000001_add_return_statuses.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Extend package_status_enum with retorno_hub (non-terminal — can return to en_bodega)
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retorno_hub';

-- Extend order_status_enum with return-flow statuses
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'en_retorno';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'parcialmente_entregado';

-- Add return metadata columns to packages for grouping and display in Retornos tab
ALTER TABLE packages
  ADD COLUMN IF NOT EXISTS return_route_id TEXT,
  ADD COLUMN IF NOT EXISTS return_reason   TEXT;

COMMENT ON COLUMN packages.return_route_id IS 'DispatchTrack route ID that failed; set by process_failed_delivery RPC';
COMMENT ON COLUMN packages.return_reason   IS 'rechazado (DT status 3) or entrega_parcial (DT status 4)';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: no errors; `retorno_hub`, `en_retorno`, `parcialmente_entregado` values available in their respective ENUMs.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260512000001_add_return_statuses.sql
git commit -m "feat(spec-43): extend enums and add return columns to packages"
```

---

### Task 2: Create `process_failed_delivery` RPC

**Files:**
- Create: `packages/database/supabase/migrations/20260512000002_process_failed_delivery.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- process_failed_delivery: called by n8n on DispatchTrack
-- webhook status 3 (full rejection) or 4 (partial delivery).
-- Idempotent: packages already in retorno_hub are skipped.
-- =============================================================

CREATE OR REPLACE FUNCTION process_failed_delivery(
  p_order_number TEXT,
  p_dt_status    INT,
  p_route_id     TEXT,
  p_operator_id  UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_order_id         UUID;
  v_new_order_status order_status_enum;
  v_pkg_count        INT;
BEGIN
  SELECT id INTO v_order_id
  FROM orders
  WHERE order_number = p_order_number
    AND operator_id  = p_operator_id
    AND deleted_at   IS NULL;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  v_new_order_status := CASE p_dt_status
    WHEN 3 THEN 'en_retorno'::order_status_enum
    WHEN 4 THEN 'parcialmente_entregado'::order_status_enum
    ELSE NULL
  END;

  IF v_new_order_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_dt_status');
  END IF;

  -- Move all non-terminal, not-yet-returning packages to retorno_hub
  UPDATE packages
  SET status          = 'retorno_hub',
      return_route_id = p_route_id,
      return_reason   = CASE p_dt_status WHEN 3 THEN 'rechazado' ELSE 'entrega_parcial' END,
      updated_at      = NOW()
  WHERE order_id  = v_order_id
    AND deleted_at IS NULL
    AND status NOT IN ('cancelado', 'devuelto', 'dañado', 'extraviado', 'retorno_hub');

  GET DIAGNOSTICS v_pkg_count = ROW_COUNT;

  UPDATE orders
  SET status            = v_new_order_status,
      status_updated_at = NOW(),
      updated_at        = NOW()
  WHERE id = v_order_id;

  RETURN jsonb_build_object('ok', true, 'packages_updated', v_pkg_count);
END;
$$;

COMMENT ON FUNCTION process_failed_delivery(TEXT, INT, TEXT, UUID) IS
  'Called by n8n on DispatchTrack status 3 (full rejection) or 4 (partial). Moves non-terminal packages to retorno_hub and updates order status. Idempotent.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: function `process_failed_delivery` created.

- [ ] **Step 3: Smoke-test via Supabase SQL editor**

```sql
-- Replace with a real order_number and operator_id from dev data
SELECT process_failed_delivery('TEST-ORDER-001', 3, 'ROUTE-42', 'your-operator-uuid'::uuid);
-- Expected: {"ok": true, "packages_updated": N}
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260512000002_process_failed_delivery.sql
git commit -m "feat(spec-43): add process_failed_delivery RPC"
```

---

### Task 3: Create return reception tables

**Files:**
- Create: `packages/database/supabase/migrations/20260512000003_create_return_reception_tables.sql`

Reference pattern: `packages/database/supabase/migrations/20260318000001_create_hub_reception_tables.sql`

Reuses `hub_reception_status_enum` and `reception_scan_result_enum` defined in that migration — do NOT redefine them.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- Return reception tables for the Hub Retornos flow.
-- Reuses hub_reception_status_enum and reception_scan_result_enum
-- from 20260318000001_create_hub_reception_tables.sql.
-- =============================================================

CREATE TABLE IF NOT EXISTS return_receptions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID        NOT NULL REFERENCES operators(id),
  route_id     TEXT        NOT NULL,
  status       hub_reception_status_enum NOT NULL DEFAULT 'in_progress',
  scanned_by   UUID        NOT NULL REFERENCES profiles(id),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_return_receptions_operator
  ON return_receptions(operator_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_return_receptions_route
  ON return_receptions(route_id, operator_id) WHERE deleted_at IS NULL;

ALTER TABLE return_receptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_receptions_operator_isolation" ON return_receptions
  USING (operator_id = (
    SELECT operator_id FROM profiles WHERE id = auth.uid()
  ));

-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS return_reception_scans (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  return_reception_id  UUID        NOT NULL REFERENCES return_receptions(id),
  package_id           UUID        REFERENCES packages(id),
  barcode              TEXT        NOT NULL,
  scan_result          reception_scan_result_enum NOT NULL,
  scanned_by           UUID        NOT NULL REFERENCES profiles(id),
  scanned_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  operator_id          UUID        NOT NULL REFERENCES operators(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_return_scans_reception
  ON return_reception_scans(return_reception_id);

CREATE INDEX IF NOT EXISTS idx_return_scans_package
  ON return_reception_scans(package_id) WHERE package_id IS NOT NULL;

ALTER TABLE return_reception_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_reception_scans_operator_isolation" ON return_reception_scans
  USING (operator_id = (
    SELECT operator_id FROM profiles WHERE id = auth.uid()
  ));
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: both tables created with RLS enabled.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260512000003_create_return_reception_tables.sql
git commit -m "feat(spec-43): add return_receptions and return_reception_scans tables"
```

---

## Chunk 2: DB Migrations 4-5

### Task 4: Add `returns` key to `get_ops_control_snapshot`

**Files:**
- Create: `packages/database/supabase/migrations/20260512000004_snapshot_returns.sql`

IMPORTANT: Copy the complete function body from `packages/database/supabase/migrations/20260505000001_filter_empty_drafts_from_ops_control.sql` as the template. Add the `returns` key between `manifests` and `sla_config`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- Add 'returns' key to get_ops_control_snapshot.
-- Returns = orders in en_retorno or parcialmente_entregado
-- with at least one retorno_hub package. One row per order
-- (LATERAL JOIN + LIMIT 1 picks the most-recently-updated
-- retorno_hub package to avoid duplicates).
--
-- Template: 20260505000001_filter_empty_drafts_from_ops_control.sql
-- =============================================================

CREATE OR REPLACE FUNCTION get_ops_control_snapshot(
  p_operator_id UUID
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT jsonb_build_object(
    'orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                        o.id,
        'order_number',              o.order_number,
        'customer_name',             o.customer_name,
        'retailer_name',             o.retailer_name,
        'external_load_id',          o.external_load_id,
        'status',                    o.status,
        'pickup_point_name',         pp.name,
        'effective_delivery_date',   COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna',                    o.comuna,
        'delivery_date',             o.delivery_date,
        'delivery_window_start',     TO_CHAR(o.delivery_window_start, 'HH24:MI'),
        'delivery_window_end',       TO_CHAR(o.delivery_window_end,   'HH24:MI'),
        'rescheduled_delivery_date', o.rescheduled_delivery_date,
        'rescheduled_window_start',  TO_CHAR(o.rescheduled_window_start, 'HH24:MI'),
        'rescheduled_window_end',    TO_CHAR(o.rescheduled_window_end,   'HH24:MI'),
        'dwell_minutes',             EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'age_minutes',               EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'idle_minutes',              EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60,
        'packages',                  COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',                 p.id,
            'label',              p.label,
            'status',             p.status,
            'declared_box_count', p.declared_box_count,
            'sku_items',          p.sku_items
          ))
          FROM packages p
          WHERE p.order_id = o.id
            AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o
      LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
        AND o.status NOT IN ('entregado', 'cancelado')
    ), '[]'::jsonb),

    'routes', COALESCE((
      SELECT jsonb_agg(row_to_json(r))
      FROM routes r
      WHERE r.operator_id = p_operator_id
        AND r.deleted_at IS NULL
        AND r.status NOT IN ('completed', 'cancelled')
        AND NOT (r.status = 'draft' AND COALESCE(r.planned_stops, 0) = 0)
    ), '[]'::jsonb),

    'manifests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                      o.id,
        'order_number',            o.order_number,
        'customer_name',           o.customer_name,
        'retailer_name',           o.retailer_name,
        'external_load_id',        o.external_load_id,
        'status',                  o.status,
        'pickup_point_name',       pp.name,
        'effective_delivery_date', COALESCE(o.rescheduled_delivery_date, o.delivery_date),
        'comuna',                  o.comuna,
        'packages',                COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id',                 p.id,
            'label',              p.label,
            'status',             p.status,
            'declared_box_count', p.declared_box_count,
            'sku_items',          p.sku_items
          ))
          FROM packages p
          WHERE p.order_id = o.id
            AND p.deleted_at IS NULL
        ), '[]'::jsonb)
      ))
      FROM orders o
      LEFT JOIN pickup_points pp ON pp.id = o.pickup_point_id
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at IS NULL
        AND o.external_load_id IN (
          SELECT m.external_load_id
          FROM manifests m
          WHERE m.operator_id     = p_operator_id
            AND m.deleted_at IS NULL
            AND m.status != 'cancelled'
            AND m.reception_status = 'awaiting_reception'
        )
    ), '[]'::jsonb),

    'returns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',              o.id,
        'order_number',    o.order_number,
        'customer_name',   o.customer_name,
        'retailer_name',   o.retailer_name,
        'status',          o.status,
        'return_route_id', p.return_route_id,
        'return_reason',   p.return_reason,
        'age_minutes',     EXTRACT(EPOCH FROM (NOW() - o.status_updated_at)) / 60
      ))
      FROM orders o
      JOIN LATERAL (
        SELECT return_route_id, return_reason
        FROM packages
        WHERE order_id  = o.id
          AND deleted_at IS NULL
          AND status    = 'retorno_hub'
        ORDER BY updated_at DESC
        LIMIT 1
      ) p ON TRUE
      WHERE o.operator_id = p_operator_id
        AND o.deleted_at  IS NULL
        AND o.status IN ('en_retorno', 'parcialmente_entregado')
    ), '[]'::jsonb),

    'sla_config', COALESCE((
      SELECT jsonb_agg(row_to_json(s))
      FROM retailer_return_sla_config s
      WHERE s.operator_id = p_operator_id
        AND s.deleted_at IS NULL
    ), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_ops_control_snapshot(UUID) IS
  'Single-RPC snapshot for Ops Control. Includes returns key (en_retorno/parcialmente_entregado orders). Empty draft routes excluded. Orders include delivery window fields for SLA classification and computed dwell/age/idle_minutes.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

- [ ] **Step 3: Smoke-test**

```sql
SELECT get_ops_control_snapshot('your-operator-uuid'::uuid) -> 'returns';
-- Expected: '[]'::jsonb when no returning orders, or array of return objects
```

- [ ] **Step 4: Commit**

```bash
git add packages/database/supabase/migrations/20260512000004_snapshot_returns.sql
git commit -m "feat(spec-43): add returns key to get_ops_control_snapshot"
```

---

### Task 5: Create `complete_return_reception_scan` RPC

**Files:**
- Create: `packages/database/supabase/migrations/20260512000005_complete_return_reception_scan.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================
-- complete_return_reception_scan: called per scan in the
-- Hub Retornos tab.
-- retorno_hub → en_bodega → records scan → promotes order
-- to en_bodega when last retorno_hub package is received.
-- Returns scan_result: received | not_found | duplicate.
-- =============================================================

CREATE OR REPLACE FUNCTION complete_return_reception_scan(
  p_package_id           UUID,
  p_return_reception_id  UUID,
  p_scanned_by           UUID,
  p_barcode              TEXT,
  p_operator_id          UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
DECLARE
  v_pkg_status  package_status_enum;
  v_order_id    UUID;
  v_remaining   INT;
BEGIN
  SELECT status, order_id
    INTO v_pkg_status, v_order_id
  FROM packages
  WHERE id          = p_package_id
    AND operator_id = p_operator_id
    AND deleted_at  IS NULL;

  IF v_pkg_status IS NULL THEN
    INSERT INTO return_reception_scans
      (return_reception_id, barcode, scan_result, scanned_by, operator_id)
    VALUES
      (p_return_reception_id, p_barcode, 'not_found', p_scanned_by, p_operator_id);
    RETURN jsonb_build_object('ok', false, 'scan_result', 'not_found');
  END IF;

  IF v_pkg_status != 'retorno_hub' THEN
    INSERT INTO return_reception_scans
      (return_reception_id, package_id, barcode, scan_result, scanned_by, operator_id)
    VALUES
      (p_return_reception_id, p_package_id, p_barcode, 'duplicate', p_scanned_by, p_operator_id);
    RETURN jsonb_build_object('ok', false, 'scan_result', 'duplicate');
  END IF;

  UPDATE packages
  SET status          = 'en_bodega',
      return_route_id = NULL,
      return_reason   = NULL,
      updated_at      = NOW()
  WHERE id = p_package_id;

  INSERT INTO return_reception_scans
    (return_reception_id, package_id, barcode, scan_result, scanned_by, operator_id)
  VALUES
    (p_return_reception_id, p_package_id, p_barcode, 'received', p_scanned_by, p_operator_id);

  SELECT COUNT(*) INTO v_remaining
  FROM packages
  WHERE order_id  = v_order_id
    AND deleted_at IS NULL
    AND status    = 'retorno_hub';

  IF v_remaining = 0 THEN
    UPDATE orders
    SET status            = 'en_bodega',
        status_updated_at = NOW(),
        updated_at        = NOW()
    WHERE id = v_order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'scan_result', 'received');
END;
$$;

COMMENT ON FUNCTION complete_return_reception_scan(UUID, UUID, UUID, TEXT, UUID) IS
  'Per-scan handler for Hub Retornos. Moves retorno_hub package to en_bodega, records scan, promotes order when last retorno_hub package is received.';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: function `complete_return_reception_scan` created.

- [ ] **Step 3: Commit**

```bash
git add packages/database/supabase/migrations/20260512000005_complete_return_reception_scan.sql
git commit -m "feat(spec-43): add complete_return_reception_scan RPC"
```

---

## Chunk 3: Frontend Types + Snapshot Hook

### Task 6: Add new statuses to `pipeline.ts`

**Files:**
- Modify: `apps/frontend/src/lib/types/pipeline.ts`
- Modify: `apps/frontend/src/lib/types/pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

Add at the end of the `describe` block in `apps/frontend/src/lib/types/pipeline.test.ts`:

```ts
it('PackageStatus includes retorno_hub and it is not terminal', () => {
  const s: PackageStatus = 'retorno_hub';
  expect(s).toBe('retorno_hub');
  expect(TERMINAL_PACKAGE_STATUSES).not.toContain('retorno_hub');
});

it('OrderStatus includes en_retorno and parcialmente_entregado', () => {
  const s1: OrderStatus = 'en_retorno';
  const s2: OrderStatus = 'parcialmente_entregado';
  expect(s1).toBe('en_retorno');
  expect(s2).toBe('parcialmente_entregado');
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/frontend
pnpm test -- --run src/lib/types/pipeline.test.ts
```

Expected: TypeScript compile error — `'retorno_hub'` is not assignable to type `PackageStatus`.

- [ ] **Step 3: Update `pipeline.ts`**

Replace the `PackageStatus` type:

```ts
export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado' | 'devuelto' | 'dañado' | 'extraviado'
  | 'retorno_hub';
```

Replace the `OrderStatus` type:

```ts
export type OrderStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado'
  | 'en_retorno' | 'parcialmente_entregado';
```

`PIPELINE_STAGES`, `TERMINAL_PACKAGE_STATUSES`, and `PRIORITY_CONFIG` remain unchanged.

- [ ] **Step 4: Run tests to pass**

```bash
cd apps/frontend
pnpm test -- --run src/lib/types/pipeline.test.ts
```

Expected: all 6 tests pass (4 original + 2 new).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/types/pipeline.ts apps/frontend/src/lib/types/pipeline.test.ts
git commit -m "feat(spec-43): add retorno_hub, en_retorno, parcialmente_entregado to pipeline types"
```

---

### Task 7: Wire `returns` in `useOpsControlSnapshot`

**Files:**
- Modify: `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts`
- Modify: `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.test.ts`

- [ ] **Step 1: Update the hook**

In `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts`, find line 76:

```ts
    returns: [] as ReturnRow[], // No returns table yet
```

Replace with:

```ts
    returns: (result?.returns ?? []) as ReturnRow[],
```

- [ ] **Step 2: Update the test**

In `apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.test.ts`, find the mock `rpc` return value and add `returns` data:

```ts
// In the mock data object returned by rpc, add:
returns: [{ id: 'ret-1', order_number: 'RET-001', status: 'en_retorno', return_route_id: 'ROUTE-1' }],
```

Replace the assertion that previously checked for hardcoded empty:

```ts
// Old (hardcoded empty):
expect(result.current.snapshot?.returns).toHaveLength(0);

// New (reads from RPC):
expect(result.current.snapshot?.returns).toHaveLength(1);
expect(result.current.snapshot?.returns[0]).toMatchObject({ id: 'ret-1' });
```

- [ ] **Step 3: Run tests**

```bash
cd apps/frontend
pnpm test -- --run src/hooks/ops-control/useOpsControlSnapshot.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.ts \
        apps/frontend/src/hooks/ops-control/useOpsControlSnapshot.test.ts
git commit -m "feat(spec-43): wire returns from RPC in useOpsControlSnapshot"
```

---

## Chunk 4: Return Reception Hooks + Tab

### Task 8: Create `useReturnRoutes` hook

**Files:**
- Create: `apps/frontend/src/hooks/reception/useReturnRoutes.ts`
- Create: `apps/frontend/src/hooks/reception/useReturnRoutes.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/frontend/src/hooks/reception/useReturnRoutes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReturnRoutes } from './useReturnRoutes';

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'pkg-1', label: 'PKG-001',
              return_route_id: 'ROUTE-42', return_reason: 'rechazado',
              order_id: 'ord-1',
              orders: { order_number: 'ORD-001', customer_name: 'Juan' },
            },
            {
              id: 'pkg-2', label: 'PKG-002',
              return_route_id: 'ROUTE-42', return_reason: 'rechazado',
              order_id: 'ord-2',
              orders: { order_number: 'ORD-002', customer_name: 'Maria' },
            },
          ],
          error: null,
        }),
      }),
    }),
  }),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useReturnRoutes', () => {
  it('groups packages by return_route_id', async () => {
    const { result } = renderHook(() => useReturnRoutes('op-1'), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].routeId).toBe('ROUTE-42');
    expect(result.current.data![0].packages).toHaveLength(2);
    expect(result.current.data![0].orderCount).toBe(2);
  });

  it('is disabled when operatorId is null', () => {
    const { result } = renderHook(() => useReturnRoutes(null), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/frontend
pnpm test -- --run src/hooks/reception/useReturnRoutes.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useReturnRoutes.ts`**

Create `apps/frontend/src/hooks/reception/useReturnRoutes.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export type ReturnPackage = {
  id: string;
  label: string;
  return_route_id: string;
  return_reason: string | null;
  order_id: string;
  order_number: string;
  customer_name: string;
};

export type ReturnRouteGroup = {
  routeId: string;
  packages: ReturnPackage[];
  orderCount: number;
};

export function useReturnRoutes(operatorId: string | null) {
  return useQuery({
    queryKey: ['return-routes', operatorId],
    queryFn: async (): Promise<ReturnRouteGroup[]> => {
      const supabase = createSPAClient();
      const { data, error } = await supabase
        .from('packages')
        .select(`
          id,
          label,
          return_route_id,
          return_reason,
          order_id,
          orders!inner(order_number, customer_name)
        `)
        .eq('operator_id', operatorId!)
        .eq('status', 'retorno_hub')
        .is('deleted_at', null)
        .not('return_route_id', 'is', null);

      if (error) throw error;

      const groups = new Map<string, ReturnPackage[]>();
      for (const row of data ?? []) {
        const pkg: ReturnPackage = {
          id:              row.id as string,
          label:           row.label as string,
          return_route_id: row.return_route_id as string,
          return_reason:   row.return_reason as string | null,
          order_id:        row.order_id as string,
          order_number:    (row.orders as { order_number: string }).order_number,
          customer_name:   (row.orders as { customer_name: string }).customer_name,
        };
        if (!groups.has(pkg.return_route_id)) groups.set(pkg.return_route_id, []);
        groups.get(pkg.return_route_id)!.push(pkg);
      }

      return Array.from(groups.entries()).map(([routeId, packages]) => ({
        routeId,
        packages,
        orderCount: new Set(packages.map((p) => p.order_id)).size,
      }));
    },
    enabled: !!operatorId,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: Run tests to pass**

```bash
cd apps/frontend
pnpm test -- --run src/hooks/reception/useReturnRoutes.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/reception/useReturnRoutes.ts \
        apps/frontend/src/hooks/reception/useReturnRoutes.test.ts
git commit -m "feat(spec-43): add useReturnRoutes hook"
```

---

### Task 9: Create `useReturnReceptionSession` hook

**Files:**
- Create: `apps/frontend/src/hooks/reception/useReturnReceptionSession.ts`
- Create: `apps/frontend/src/hooks/reception/useReturnReceptionSession.test.ts`

User ID is retrieved internally via `supabase.auth.getUser()` — same pattern as `useQRHandoff.ts:154`.

- [ ] **Step 1: Write failing tests**

Create `apps/frontend/src/hooks/reception/useReturnReceptionSession.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useReturnReceptionSession } from './useReturnReceptionSession';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSPAClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  }),
}));

vi.mock('@/lib/pickup/audio', () => ({
  playFeedback: vi.fn(),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useReturnReceptionSession', () => {
  beforeEach(() => {
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'sess-1' }, error: null }),
        }),
      }),
    });
  });

  it('creates a new session and returns sessionId', async () => {
    const { result } = renderHook(
      () => useReturnReceptionSession('op-1', 'ROUTE-42'),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sessionId).toBe('sess-1');
  });

  it('scan returns received result', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, scan_result: 'received' }, error: null });

    const { result } = renderHook(
      () => useReturnReceptionSession('op-1', 'ROUTE-42'),
      { wrapper }
    );
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'));

    let scanResult: string | undefined;
    await act(async () => {
      scanResult = await result.current.scan({ barcode: 'PKG-001', packageId: 'pkg-1' });
    });

    expect(scanResult).toBe('received');
    expect(result.current.lastScanResult).toBe('received');
  });

  it('scan returns not_found when package is unknown', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, scan_result: 'not_found' }, error: null });

    const { result } = renderHook(
      () => useReturnReceptionSession('op-1', 'ROUTE-42'),
      { wrapper }
    );
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'));

    let scanResult: string | undefined;
    await act(async () => {
      scanResult = await result.current.scan({ barcode: 'UNKNOWN', packageId: 'pkg-x' });
    });

    expect(scanResult).toBe('not_found');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/frontend
pnpm test -- --run src/hooks/reception/useReturnReceptionSession.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useReturnReceptionSession.ts`**

Create `apps/frontend/src/hooks/reception/useReturnReceptionSession.ts`:

```ts
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import { playFeedback } from '@/lib/pickup/audio';

export type ReturnScanResult = 'received' | 'not_found' | 'duplicate';

export type ReturnReceptionState = {
  sessionId: string | null;
  isLoading: boolean;
  error: Error | null;
  scan: (args: { barcode: string; packageId: string }) => Promise<ReturnScanResult>;
  lastScanResult: ReturnScanResult | null;
};

export function useReturnReceptionSession(
  operatorId: string | null,
  routeId: string | null
): ReturnReceptionState {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<ReturnScanResult | null>(null);
  const queryClient = useQueryClient();

  const { isLoading, error } = useQuery({
    queryKey: ['return-reception-session', operatorId, routeId],
    queryFn: async () => {
      const supabase = createSPAClient();

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) throw new Error('No authenticated user');

      const { data: existing } = await supabase
        .from('return_receptions')
        .select('id')
        .eq('operator_id', operatorId!)
        .eq('route_id', routeId!)
        .eq('status', 'in_progress')
        .is('deleted_at', null)
        .maybeSingle();

      if (existing) {
        setSessionId((existing as { id: string }).id);
        return existing;
      }

      const { data: created, error: insertError } = await supabase
        .from('return_receptions')
        .insert({
          operator_id: operatorId,
          route_id: routeId,
          scanned_by: userId,
          status: 'in_progress',
        })
        .select('id')
        .single();

      if (insertError) throw insertError;
      setSessionId((created as { id: string }).id);
      return created;
    },
    enabled: !!operatorId && !!routeId,
  });

  const scanMutation = useMutation({
    mutationFn: async (args: { barcode: string; packageId: string }): Promise<ReturnScanResult> => {
      const supabase = createSPAClient();

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) throw new Error('No authenticated user');

      const { data, error: rpcError } = await supabase.rpc('complete_return_reception_scan', {
        p_package_id:          args.packageId,
        p_return_reception_id: sessionId,
        p_scanned_by:          userId,
        p_barcode:             args.barcode,
        p_operator_id:         operatorId,
      });
      if (rpcError) throw rpcError;
      return (data as { scan_result: ReturnScanResult }).scan_result;
    },
    onSuccess: (result) => {
      setLastScanResult(result);
      playFeedback(
        result === 'received'  ? 'verified'  :
        result === 'duplicate' ? 'duplicate' : 'not_found'
      );
      queryClient.invalidateQueries({ queryKey: ['return-routes', operatorId] });
    },
  });

  return {
    sessionId,
    isLoading,
    error: error as Error | null,
    scan: (args) => scanMutation.mutateAsync(args),
    lastScanResult,
  };
}
```

- [ ] **Step 4: Run tests to pass**

```bash
cd apps/frontend
pnpm test -- --run src/hooks/reception/useReturnReceptionSession.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/hooks/reception/useReturnReceptionSession.ts \
        apps/frontend/src/hooks/reception/useReturnReceptionSession.test.ts
git commit -m "feat(spec-43): add useReturnReceptionSession hook"
```

---

### Task 10: Add Retornos tab to reception page

**Files:**
- Modify: `apps/frontend/src/app/app/reception/page.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports in `apps/frontend/src/app/app/reception/page.tsx`:

```ts
import { RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useReturnRoutes, type ReturnRouteGroup } from '@/hooks/reception/useReturnRoutes';
import { useReturnReceptionSession } from '@/hooks/reception/useReturnReceptionSession';
```

- [ ] **Step 2: Add state and hooks to component body**

After the existing `useCompletedReceptions` call, add:

```ts
const { data: returnRoutes = [], isLoading: isLoadingReturns } = useReturnRoutes(operatorId);
const [scanningRoute, setScanningRoute] = useState<ReturnRouteGroup | null>(null);
const [scanBarcode, setScanBarcode] = useState('');
const [scanPackageId, setScanPackageId] = useState('');

const session = useReturnReceptionSession(
  scanningRoute ? operatorId : null,
  scanningRoute?.routeId ?? null
);
```

- [ ] **Step 3: Add Retornos trigger to TabsList**

In the existing `<TabsList>`, after the "Completados" trigger:

```tsx
<TabsTrigger value="returns">
  Retornos
  {returnRoutes.length > 0 && (
    <Badge variant="destructive" className="ml-1.5 h-4 px-1 text-xs">
      {returnRoutes.length}
    </Badge>
  )}
</TabsTrigger>
```

- [ ] **Step 4: Add TabsContent for Retornos**

After the closing `</TabsContent>` of the "completed" tab:

```tsx
{/* Retornos tab */}
<TabsContent value="returns" className="space-y-3 mt-4">
  {isLoadingReturns ? (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  ) : returnRoutes.length === 0 ? (
    <EmptyState
      icon={RotateCcw}
      title="Sin retornos pendientes"
      description="Las rutas con entregas fallidas aparecerán aquí."
    />
  ) : (
    returnRoutes.map((group) => (
      <div
        key={group.routeId}
        className="flex items-center justify-between rounded-lg border p-4"
      >
        <div>
          <p className="font-medium text-sm">Ruta {group.routeId}</p>
          <p className="text-xs text-muted-foreground">
            {group.packages.length} paquete{group.packages.length !== 1 ? 's' : ''}{' · '}
            {group.orderCount} orden{group.orderCount !== 1 ? 'es' : ''}
          </p>
        </div>
        <Button size="sm" onClick={() => setScanningRoute(group)}>
          <RotateCcw className="h-4 w-4 mr-1" />
          Escanear
        </Button>
      </div>
    ))
  )}
</TabsContent>
```

- [ ] **Step 5: Add return scan Dialog**

Before the closing `</div>` of the page, after the existing QR Scanner Dialog:

```tsx
{/* Return Scan Dialog */}
<Dialog open={!!scanningRoute} onOpenChange={(open) => { if (!open) { setScanningRoute(null); setScanBarcode(''); setScanPackageId(''); } }}>
  <DialogContent className="max-w-sm">
    <DialogHeader>
      <DialogTitle>Retorno — Ruta {scanningRoute?.routeId}</DialogTitle>
    </DialogHeader>
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {scanningRoute?.packages.length ?? 0} paquete(s) pendiente(s)
      </p>
      <Input
        placeholder="Código de barras"
        value={scanBarcode}
        onChange={(e) => setScanBarcode(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && scanBarcode && scanPackageId) {
            await session.scan({ barcode: scanBarcode, packageId: scanPackageId });
            setScanBarcode('');
            setScanPackageId('');
          }
        }}
      />
      {session.lastScanResult && (
        <p className={`text-sm font-medium ${
          session.lastScanResult === 'received'  ? 'text-green-600' :
          session.lastScanResult === 'duplicate' ? 'text-yellow-600' : 'text-red-600'
        }`}>
          {session.lastScanResult === 'received'  ? 'Recibido ✓' :
           session.lastScanResult === 'duplicate' ? 'Duplicado'  : 'No encontrado'}
        </p>
      )}
      <div className="space-y-1 max-h-60 overflow-y-auto">
        {scanningRoute?.packages.map((pkg) => (
          <button
            key={pkg.id}
            type="button"
            className="flex w-full items-center justify-between text-xs p-2 rounded bg-muted hover:bg-muted/80 text-left"
            onClick={() => { setScanPackageId(pkg.id); setScanBarcode(pkg.label); }}
          >
            <span>{pkg.label}</span>
            <span className="text-muted-foreground">{pkg.return_reason}</span>
          </button>
        ))}
      </div>
    </div>
  </DialogContent>
</Dialog>
```

- [ ] **Step 6: Run TypeScript check**

```bash
cd apps/frontend
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/app/reception/page.tsx
git commit -m "feat(spec-43): add Retornos tab to reception hub"
```

---

## Chunk 5: n8n + PR

### Task 11: Update n8n workflow for failed deliveries

This task requires manual access to the n8n instance at `n8n.tractis.ai`.

- [ ] **Step 1: Open the `paris-dispatchtrack` workflow in n8n**

Navigate to `n8n.tractis.ai` and locate the webhook workflow `paris-dispatchtrack`.

- [ ] **Step 2: Add a branch for status 3 and 4**

After the existing webhook trigger, add an `IF` node with condition:
```
{{ $json.status === 3 || $json.status === 4 }}
```

- [ ] **Step 3: Add HTTP Request node calling `process_failed_delivery`**

Add a Supabase RPC call (HTTP Request or Supabase node) with:
```json
{
  "p_order_number": "{{ $json.orderNumber }}",
  "p_dt_status":    {{ $json.status }},
  "p_route_id":     "{{ $json.routeId }}",
  "p_operator_id":  "{{ $env.OPERATOR_ID }}"
}
```

Map `orderNumber` and `routeId` to the actual DispatchTrack webhook field names from the DT API docs. Check existing n8n nodes in this workflow for the correct field names.

- [ ] **Step 4: Test with a sample payload via n8n Execute Workflow**

```json
{ "status": 3, "orderNumber": "TEST-ORDER-001", "routeId": "ROUTE-TEST-42" }
```

Expected: `process_failed_delivery` returns `{"ok": true, "packages_updated": N}`.

- [ ] **Step 5: Activate workflow**

Save and activate the updated workflow.

---

### Task 12: Create PR

- [ ] **Step 1: Push branch**

```bash
git push origin feat/spec-43-failed-delivery-return-flow
```

- [ ] **Step 2: Create PR with auto-merge**

```bash
gh pr create \
  --title "feat(spec-43): failed delivery return flow" \
  --body "$(cat <<'EOF'
## Summary
- New statuses: \`retorno_hub\` (package), \`en_retorno\` / \`parcialmente_entregado\` (order)
- \`process_failed_delivery\` RPC — called by n8n on DT webhook status 3/4
- \`get_ops_control_snapshot\` gains \`returns\` key for Ops Control Reingresos tab
- Hub Reception gains Retornos tab with route-grouped scan flow backed by \`complete_return_reception_scan\` RPC

## Test plan
- [ ] All 5 migrations apply cleanly; ENUMs and tables exist
- [ ] \`process_failed_delivery\` with status 3: packages → \`retorno_hub\`, order → \`en_retorno\`
- [ ] \`process_failed_delivery\` with status 4: packages → \`retorno_hub\`, order → \`parcialmente_entregado\`
- [ ] Duplicate call (package already \`retorno_hub\`) is a no-op
- [ ] Snapshot RPC returns \`returns\` array for returning orders; empty when none
- [ ] All frontend unit tests pass: pipeline, snapshot hook, useReturnRoutes, useReturnReceptionSession
- [ ] Retornos tab visible in Reception Hub; routes listed with package/order counts
- [ ] Scan a package → moves to \`en_bodega\`; last package in route → order promoted to \`en_bodega\`
- [ ] n8n webhook test with DT status 3/4 payload calls the RPC successfully
EOF
)"
gh pr merge --auto --squash
```
