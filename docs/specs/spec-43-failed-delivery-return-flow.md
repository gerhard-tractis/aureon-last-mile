# Spec-43: Failed Delivery Return Flow

**Date:** 2026-05-12  
**Status:** Design approved — pending implementation  
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

`devuelto` remains a separate terminal state meaning "package returned to retailer — no further action."

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
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'en_retorno' BEFORE 'cancelado';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'parcialmente_entregado' BEFORE 'cancelado';

-- Add return reason columns to packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_reason_code VARCHAR(10);
```

### Migration 2 — `process_failed_delivery` RPC

Called by n8n when DT fires `status` 3 or 4.

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
  v_order_id UUID;
  v_returning_count INT;
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

  IF p_dt_status = 3 THEN
    -- Full rejection: all non-terminal packages → retorno_hub
    UPDATE packages
    SET status            = 'retorno_hub',
        return_reason     = p_substatus,
        return_reason_code = p_substatus_code,
        status_updated_at = NOW(),
        updated_at        = NOW()
    WHERE order_id = v_order_id
      AND status NOT IN ('entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado')
      AND deleted_at IS NULL;

    UPDATE orders
    SET status     = 'en_retorno',
        updated_at = NOW()
    WHERE id = v_order_id;

  ELSIF p_dt_status = 4 THEN
    -- Partial: packages with zero delivered_quantity → retorno_hub
    -- (caller is responsible for passing undelivered package labels;
    --  for now, all non-entregado packages → retorno_hub)
    UPDATE packages
    SET status            = 'retorno_hub',
        return_reason     = p_substatus,
        return_reason_code = p_substatus_code,
        status_updated_at = NOW(),
        updated_at        = NOW()
    WHERE order_id = v_order_id
      AND status NOT IN ('entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado')
      AND deleted_at IS NULL;

    UPDATE orders
    SET status     = 'parcialmente_entregado',
        updated_at = NOW()
    WHERE id = v_order_id;
  END IF;

  SELECT COUNT(*) INTO v_returning_count
  FROM packages
  WHERE order_id = v_order_id AND status = 'retorno_hub' AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'order_id',        v_order_id,
    'returning_count', v_returning_count
  );
END;
$$;
```

**Idempotency:** packages already in `entregado`, `cancelado`, `devuelto`, `dañado`, or `extraviado` are skipped, so duplicate DT webhooks are safe.

### Migration 3 — `return_receptions` and `return_reception_scans` tables

```sql
CREATE TABLE IF NOT EXISTS public.return_receptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  external_route_id TEXT NOT NULL,   -- DT route_id
  received_by      UUID REFERENCES public.users(id),
  status           hub_reception_status_enum NOT NULL DEFAULT 'pending',
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  expected_count   INT NOT NULL DEFAULT 0,
  received_count   INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.return_reception_scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_reception_id UUID NOT NULL REFERENCES public.return_receptions(id),
  package_id       UUID REFERENCES public.packages(id),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  scanned_by       UUID REFERENCES public.users(id),
  barcode          TEXT NOT NULL,
  scan_result      reception_scan_result_enum NOT NULL,
  scanned_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at       TIMESTAMPTZ
);
```

RLS policies mirror `hub_receptions` / `reception_scans` (tenant isolation via `operator_id`).

### Migration 4 — `get_ops_control_snapshot` RPC update

Add a `returns` key to the existing RPC:

```sql
'returns', COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'id',                o.id,
    'order_number',      o.order_number,
    'retailer_name',     o.retailer_name,
    'status',            o.status,
    'return_reason',     p.return_reason,
    'return_reason_code', p.return_reason_code,
    'age_minutes',
      EXTRACT(EPOCH FROM (NOW() - o.updated_at)) / 60
  ))
  FROM orders o
  JOIN packages p ON p.order_id = o.id
    AND p.status = 'retorno_hub'
    AND p.deleted_at IS NULL
  WHERE o.operator_id = p_operator_id
    AND o.status IN ('en_retorno', 'parcialmente_entregado')
    AND o.deleted_at IS NULL
), '[]'::jsonb),
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

### `pipeline.ts`

```ts
type PackageStatus = ... | 'retorno_hub' | ...   // non-terminal

type OrderStatus = ... | 'en_retorno' | 'parcialmente_entregado'

// PIPELINE_STAGES: add display entries for new order statuses
{ status: 'en_retorno',            label: 'En Retorno',             icon: 'RotateCcw', position: 7.5 },
{ status: 'parcialmente_entregado', label: 'Parcialmente Entregado', icon: 'PackageOpen', position: 7.5 },
```

`retorno_hub` is NOT added to `TERMINAL_PACKAGE_STATUSES`.

### `useOpsControlSnapshot.ts`

Change line 76 from:
```ts
returns: [] as ReturnRow[], // No returns table yet
```
to:
```ts
returns: (result?.returns ?? []) as ReturnRow[],
```

Add `'en_retorno'` and `'parcialmente_entregado'` to `EXCLUDED_ORDER_STATUSES`? No — these orders should stay in the snapshot for Reingresos. They should be removed when they transition to `en_bodega` (which is already excluded? No — `en_bodega` is an active state). The snapshot excludes `entregado` and `cancelado` only; all other statuses pass through. No change needed to the exclusion set.

Add realtime subscription: orders changing to/from `en_retorno` / `parcialmente_entregado` are handled automatically by the existing orders channel subscription (it already upserts any order not in `EXCLUDED_ORDER_STATUSES`).

### Reception Hub — new "Retornos" tab

**New route:** `/app/reception` gains a tab switcher: `Ingresos` (existing) | `Retornos` (new).

**Retornos tab components:**

- `ReturnRouteList` — lists distinct `external_route_id` values from packages where `status = retorno_hub`, showing driver name + returning package count. Sorted by oldest package first.
- `ReturnReceptionSession` — scan session for a selected route. Mirrors existing `ReceptionScan` flow: scan barcode → validate against `retorno_hub` packages on this route → success moves package to `en_bodega`.
- Shows `return_reason` per package so the receptionist can see why each item came back.

**On scan success:**
1. Package → `en_bodega`, `return_reason` / `return_reason_code` preserved on the record.
2. `return_reception_scans` row recorded.
3. Check: if all packages on the order that were in `retorno_hub` are now `en_bodega` → order → `en_bodega`. Implemented as a Supabase RPC `complete_return_reception_scan(p_package_id, p_return_reception_id, p_scanned_by)`.

---

## Test Plan

| Layer | Tests |
|---|---|
| `process_failed_delivery` RPC | status 3 → all packages retorno_hub + order en_retorno; status 4 → partial split; duplicate webhook idempotency; unknown order_number returns error |
| `complete_return_reception_scan` RPC | package → en_bodega; order → en_bodega when last returning package received; partial order stays parcialmente_entregado until all returning packages received |
| `get_ops_control_snapshot` | `returns` array populated; grouped correctly; empty when no returning orders |
| `useOpsControlSnapshot` hook | `returns` reads from RPC result, not hardcoded |
| `ReturnsPanel` | renders return_reason column; shows age and SLA |
| `ReturnRouteList` | groups by route; shows count; empty state |
| `ReturnReceptionSession` | scan success → package en_bodega; scan not_found → error state; duplicate scan → duplicate result |
| `pipeline.ts` | new statuses present; retorno_hub not in terminal list |
