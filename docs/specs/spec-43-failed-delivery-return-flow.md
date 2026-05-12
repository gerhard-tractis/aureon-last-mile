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
