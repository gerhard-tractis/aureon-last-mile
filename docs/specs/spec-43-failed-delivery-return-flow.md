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

`devuelto` remains a separate terminal state meaning "package permanently returned to retailer — no further action." The transition into `devuelto` is **out of scope for this spec** and is owned by **spec-44b** (`mark_returned_to_sender` writes `orders.return_to_sender_state = 'returned'` and is expected to flip the corresponding packages to `devuelto`). No code in spec-43 writes the `devuelto` value.

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

> **`orders.status` is a real enum (`order_status_enum`).** It was created by `20260313000001_epic5_enum_migration.sql` and there is no `orders_status_check` constraint to alter. Both new order values must be added to the enum, same pattern as `package_status_enum`. Likewise `orders.leading_status` is `order_status_enum` and inherits the new values automatically.

> **Transaction note:** `ALTER TYPE … ADD VALUE` cannot run inside a transaction block that already references the new value. Split the enum extensions into their own migration file (this one), separate from any migration that uses `'retorno_hub'::package_status_enum`, `'en_retorno'::order_status_enum`, or `'parcialmente_entregado'::order_status_enum` in a CASE or comparison.

```sql
-- Extend package_status_enum with the non-terminal "returning to hub" state
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retorno_hub' BEFORE 'cancelado';

-- Extend order_status_enum with the two new return-flow values
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'en_retorno';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'parcialmente_entregado';

-- Add return reason columns to packages
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_reason_code VARCHAR(10);

-- Partial index to support fast Retornos-tab queries (find packages awaiting hub receipt)
CREATE INDEX IF NOT EXISTS idx_packages_retorno_hub
  ON public.packages(order_id, status)
  WHERE status = 'retorno_hub';

-- Note: `idx_orders_operator_status` (full index on operator_id, status) already exists
-- from epic5, so no extra orders-side index is needed for Reingresos lookups.
```

### Migration 2 — Teach the order-status trigger about returns

> **Why this is required.** `recalculate_order_status` (from `20260313000003_epic5_functions_and_trigger.sql`) is an AFTER UPDATE OF status trigger on `packages` that derives both `orders.status` and `orders.leading_status` from the pipeline positions of the order's active packages. Because `pipeline_position('retorno_hub')` falls through to `ELSE 0`, the original trigger sees a status-3 webhook (all packages → `retorno_hub`) as "zero active packages" and forces the order to `cancelado`. It also defeats `complete_return_reception_scan`: the first scan moves one package back to `en_bodega`, the trigger immediately fires and sets the order to `en_bodega` while the rest of the route's packages are still returning.
>
> The clean fix is to make the trigger the single source of truth for the new return states and drop the manual `UPDATE orders SET status = …` blocks from both RPCs. The trigger now handles four cases:
>
> | Package mix | Order `status` & `leading_status` |
> |---|---|
> | At least one `retorno_hub`, no `entregado` | `en_retorno` |
> | At least one `retorno_hub`, at least one `entregado` | `parcialmente_entregado` |
> | No `retorno_hub`, no other active packages | `cancelado` *(unchanged)* |
> | No `retorno_hub`, some active packages | MIN/MAX over `pipeline_position` *(unchanged)* |
>
> `pipeline_position` itself is **left unchanged** — `retorno_hub` continues to return 0. The trigger short-circuits on `retorno_hub` before falling through to the MIN/MAX path, so the legacy pipeline math is undisturbed when no packages are in `retorno_hub`.

```sql
-- The pipeline_position helper is unchanged; retorno_hub keeps returning 0 and
-- is handled by an explicit branch in the trigger below.

CREATE OR REPLACE FUNCTION recalculate_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id     UUID;
  v_active_count INT;   -- non-terminal packages excluding retorno_hub
  v_retorno      INT;   -- count of retorno_hub packages
  v_entregado    INT;   -- count of entregado packages
  v_min_pos      INT;
  v_max_pos      INT;
  v_min_status   order_status_enum;
  v_max_status   order_status_enum;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT
    COUNT(*) FILTER (WHERE pipeline_position(status::text) > 0 AND status <> 'retorno_hub'),
    COUNT(*) FILTER (WHERE status = 'retorno_hub'),
    COUNT(*) FILTER (WHERE status = 'entregado')
  INTO v_active_count, v_retorno, v_entregado
  FROM packages
  WHERE order_id   = v_order_id
    AND deleted_at IS NULL;

  -- Return-flow branch takes precedence over the legacy MIN/MAX logic.
  IF v_retorno > 0 THEN
    UPDATE orders SET
      status            = CASE WHEN v_entregado > 0
                               THEN 'parcialmente_entregado'::order_status_enum
                               ELSE 'en_retorno'::order_status_enum END,
      leading_status    = CASE WHEN v_entregado > 0
                               THEN 'parcialmente_entregado'::order_status_enum
                               ELSE 'en_retorno'::order_status_enum END,
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- No retorno_hub packages: fall through to the original logic.
  IF v_active_count + v_entregado = 0 THEN
    UPDATE orders SET
      status            = 'cancelado',
      leading_status    = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id   = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  SELECT CASE v_min_pos
    WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado'
    WHEN 3 THEN 'en_bodega' WHEN 4 THEN 'asignado'
    WHEN 5 THEN 'en_carga'  WHEN 6 THEN 'listo'
    WHEN 7 THEN 'en_ruta'   WHEN 8 THEN 'entregado'
  END::order_status_enum INTO v_min_status;

  SELECT CASE v_max_pos
    WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado'
    WHEN 3 THEN 'en_bodega' WHEN 4 THEN 'asignado'
    WHEN 5 THEN 'en_carga'  WHEN 6 THEN 'listo'
    WHEN 7 THEN 'en_ruta'   WHEN 8 THEN 'entregado'
  END::order_status_enum INTO v_max_status;

  UPDATE orders SET
    status            = v_min_status,
    leading_status    = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger definition is unchanged; CREATE OR REPLACE on the function is enough.
```

### Migration 3 — `process_failed_delivery` RPC

Called by n8n when DT fires `status` 3 or 4.

**Partial delivery note (status 4):** The DispatchTrack webhook payload does not provide package-level delivery granularity — only an order-level `status: 4` signal. Therefore for both status 3 and status 4, ALL non-terminal packages on the order are moved to `retorno_hub`. The difference between the two is only the resulting order status (`en_retorno` vs `parcialmente_entregado`), and that distinction is now derived by the `recalculate_order_status` trigger (see Migration 2) based on whether any `entregado` packages exist on the order. If DT later exposes per-package outcome, this RPC can be extended with a `p_delivered_barcodes TEXT[]` parameter.

**Reason history:** `return_reason` and `return_reason_code` are overwritten on each failed attempt. The previous reason is preserved in the `audit_logs` row produced by the `audit_packages_changes` trigger, so audit history is not lost. Surfacing prior reasons in the UI is deferred.

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
  v_order_id          UUID;
  v_current_status    order_status_enum;
  v_returning_count   INT;
BEGIN
  IF p_dt_status NOT IN (3, 4) THEN
    RETURN jsonb_build_object('error', 'unsupported_dt_status');
  END IF;

  -- Resolve and lock the order row so concurrent webhooks serialise.
  SELECT id, status
    INTO v_order_id, v_current_status
  FROM orders
  WHERE order_number = p_order_number
    AND operator_id  = p_operator_id
    AND deleted_at IS NULL
  FOR UPDATE;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'order_not_found');
  END IF;

  -- Idempotency / duplicate-webhook short-circuit.
  -- If the order is already in a return state, do nothing — the original
  -- webhook already moved every non-terminal package to retorno_hub and we
  -- don't want to drag en_bodega/en_ruta packages (from a subsequent
  -- re-dispatch cycle) back into retorno_hub on a stale replay.
  IF v_current_status IN ('en_retorno', 'parcialmente_entregado') THEN
    SELECT COUNT(*) INTO v_returning_count
    FROM packages
    WHERE order_id   = v_order_id
      AND status     = 'retorno_hub'
      AND deleted_at IS NULL;

    RETURN jsonb_build_object(
      'order_id',        v_order_id,
      'returning_count', v_returning_count,
      'skipped',         true
    );
  END IF;

  -- Move all non-terminal packages to retorno_hub.
  -- The recalculate_order_status trigger (Migration 2) will derive the new
  -- orders.status (en_retorno or parcialmente_entregado) from the resulting
  -- package mix — we do NOT update orders.status here.
  UPDATE packages
  SET status             = 'retorno_hub',
      return_reason      = p_substatus,
      return_reason_code = p_substatus_code,
      status_updated_at  = NOW(),
      updated_at         = NOW()
  WHERE order_id   = v_order_id
    AND status NOT IN ('entregado', 'cancelado', 'devuelto', 'dañado', 'extraviado', 'retorno_hub')
    AND deleted_at IS NULL;

  SELECT COUNT(*) INTO v_returning_count
  FROM packages
  WHERE order_id   = v_order_id
    AND status     = 'retorno_hub'
    AND deleted_at IS NULL;

  RETURN jsonb_build_object(
    'order_id',        v_order_id,
    'returning_count', v_returning_count,
    'skipped',         false
  );
END;
$$;
```

### Migration 4 — `return_receptions` and `return_reception_scans` tables

> **Enum reuse:** `hub_reception_status_enum` (`pending | in_progress | completed`) and `reception_scan_result_enum` (`received | not_found | duplicate`) are pre-existing types created in migration `20260318000001_create_hub_reception_tables.sql` (spec-08). They are reused here without redefinition.

> **`expected_count` is populated at session creation** by `useReturnReceptionSession`, which runs `SELECT COUNT(*) FROM packages WHERE status = 'retorno_hub' AND <route join> AND operator_id = $1` at the moment the receptionist opens the route. The count is a snapshot — subsequent packages arriving in `retorno_hub` for the same route after the session opened will be visible in the live list but will not retroactively change `expected_count`.

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

### Migration 5 — `get_ops_control_snapshot` RPC update

Add a `returns` key alongside the existing `orders`, `routes`, `manifests`, `sla_config`. One row per order (using `DISTINCT ON`), with the most recent package reason.

> **Cross-spec consistency with spec-44a.** Spec-44a introduces a separate `returns_to_sender` snapshot key that mandates exclusion from every other stage array. Orders move from spec-43's `returns` to spec-44a's `returns_to_sender` only after the operator (or auto-policy) gives up on re-delivery — i.e., the order's `return_to_sender_state` becomes non-null. While `return_to_sender_state` is null, the order belongs in `returns`. Spec-44a's snapshot query therefore needs to add `AND o.return_to_sender_state IS NULL` to the `returns` subquery in this migration to prevent dual-listing. That column does not exist yet on this branch; flag this dependency when spec-44a lands.

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

### Migration 6 — `complete_return_reception_scan` RPC

Called once per successful barcode scan in the Retornos tab. Moves the package to `en_bodega` and records the scan. The order's `status` and `leading_status` are derived by the `recalculate_order_status` trigger (Migration 2): partway through a route the trigger keeps the order in `en_retorno` / `parcialmente_entregado`; once the last `retorno_hub` package on the order flips, the trigger naturally lands the order back on `en_bodega` (or `en_bodega` + `leading_status=entregado` if some packages had already been delivered).

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
  v_order_id          UUID;
  v_remaining_count   INT;
  v_new_order_status  order_status_enum;
BEGIN
  -- Validate package and lock its order row so concurrent scans on the same
  -- order serialise (prevents two scans both observing remaining = 0 from a
  -- stale read of orders.status).
  SELECT p.order_id INTO v_order_id
  FROM packages p
  JOIN orders   o ON o.id = p.order_id
  WHERE p.id          = p_package_id
    AND p.operator_id = p_operator_id
    AND p.status      = 'retorno_hub'
    AND p.deleted_at IS NULL
  FOR UPDATE OF o;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('error', 'package_not_found_or_wrong_status');
  END IF;

  -- Move package back to active pipeline; the trigger updates orders.status.
  -- return_reason / return_reason_code are intentionally preserved on the
  -- package record as audit history of why it returned.
  UPDATE packages
  SET status            = 'en_bodega',
      status_updated_at = NOW(),
      updated_at        = NOW()
  WHERE id = p_package_id;

  -- Record scan.
  INSERT INTO return_reception_scans
    (return_reception_id, package_id, operator_id, scanned_by, barcode, scan_result, scanned_at)
  VALUES
    (p_return_reception_id, p_package_id, p_operator_id, p_scanned_by, p_barcode, 'received', NOW());

  -- Increment received_count on the session.
  UPDATE return_receptions
  SET received_count = received_count + 1,
      updated_at     = NOW()
  WHERE id = p_return_reception_id;

  -- Re-read state derived by the trigger.
  SELECT COUNT(*) INTO v_remaining_count
  FROM packages
  WHERE order_id   = v_order_id
    AND status     = 'retorno_hub'
    AND deleted_at IS NULL;

  SELECT status INTO v_new_order_status
  FROM orders
  WHERE id = v_order_id;

  RETURN jsonb_build_object(
    'package_id',       p_package_id,
    'order_id',         v_order_id,
    'order_promoted',   v_remaining_count = 0,
    'order_status',     v_new_order_status,
    'remaining',        v_remaining_count
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

// PIPELINE_STAGES: add display entries for new order statuses.
// Positions must be unique (the renderer sorts on this field), so the two
// return states are placed between en_ruta (7) and entregado (8).
{ status: 'parcialmente_entregado', label: 'Parcialmente Entregado',  icon: 'PackageOpen', position: 7.4 },
{ status: 'en_retorno',             label: 'En Retorno',              icon: 'RotateCcw',   position: 7.6 },
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

### `ReturnsPanel` (Ops Control)

`ReturnsPanel.tsx` already exists in `apps/frontend/src/components/ops-control/` as the host of the (currently empty) `returns` array. Update it to:

- Render the new columns surfaced by the snapshot: `return_reason`, `return_reason_code`, `age_minutes`.
- Add SLA bucketing on `age_minutes` (matches the bucketing conventions of sibling panels — `at_risk` / `late` thresholds inherited from `sla_config`).
- Drop the "no returns yet" placeholder copy now that the array is real.

No new panel component is created — `ReturnsPanel` is the home for both the existing `returns` snapshot key and these new fields.

### Reception Hub — new "Retornos" tab

**Page:** `/app/reception` gains a tab switcher: `Ingresos` (existing flow) | `Retornos` (new).

**New components** (all inside `apps/frontend/src/app/app/reception/`):

| Component | Responsibility |
|---|---|
| `ReturnRouteList` | Lists distinct routes that have packages in `retorno_hub`. Shows external route id, driver name, and returning package count. Sorted oldest-first by min `status_updated_at`. |
| `ReturnReceptionSession` | Scan session for a selected route. Mirrors `ReceptionScan`. Calls `complete_return_reception_scan` RPC on each successful scan. |
| `useReturnRoutes` hook | Reads the route list via the join described below. |
| `useReturnReceptionSession` hook | Creates/resumes a `return_receptions` row; populates `expected_count`; exposes the scan handler. |

**`external_route_id` source — explicit join path.** `packages` does not carry `external_route_id`. It lives on `routes.external_route_id`, linked through `dispatches`:

```
packages  →  orders  →  dispatches  →  routes
              (order_id)   (route_id)
```

`useReturnRoutes` query (illustrative — adjust to live alongside existing `useOpsControlSnapshot` patterns):

```sql
-- One row per (route, order, latest dispatch) so that re-attempts don't
-- duplicate or mis-attribute returning packages to an old route.
SELECT DISTINCT ON (p.id)
       r.external_route_id,
       r.driver_name,
       p.id   AS package_id,
       p.order_id,
       p.status_updated_at
FROM packages   p
JOIN orders     o ON o.id       = p.order_id
JOIN dispatches d ON d.order_id = o.id   AND d.deleted_at IS NULL
JOIN routes     r ON r.id       = d.route_id
WHERE p.operator_id = $1
  AND p.status      = 'retorno_hub'
  AND p.deleted_at IS NULL
ORDER BY p.id, d.created_at DESC;  -- pick the most-recent dispatch per package
```

Then group by `external_route_id` for the list view. If a returning package has no `dispatches` row (edge case), surface it under a synthetic "Sin ruta" bucket so it isn't dropped silently.

**`expected_count` initialisation.** When `useReturnReceptionSession` opens a session for a route, it inserts the `return_receptions` row with `expected_count = COUNT(packages WHERE retorno_hub AND <belongs to this route via the join above>)`. This is a snapshot for completion-percentage display; live drift is shown by re-running the count.

**On scan success (inside `useReturnReceptionSession`):**
1. Call `complete_return_reception_scan(p_package_id, p_return_reception_id, p_scanned_by, p_barcode, p_operator_id)`.
2. RPC moves package to `en_bodega`, records scan; trigger updates the order's `status` / `leading_status` accordingly.
3. Hook updates local session state (received count, remaining list). RPC return now includes `order_status` so the UI can reflect the post-trigger value without a re-fetch.

**On scan not_found:** Insert a `return_reception_scans` row with `scan_result = 'not_found'`, show error feedback to receptionist. Package state unchanged.

**Wrong-route scan handling.** If the receptionist scans a barcode that maps to a `retorno_hub` package belonging to a *different* route, the RPC validates only that the package is in `retorno_hub` for the same operator — it does not enforce route membership. The frontend (`useReturnReceptionSession`) is responsible for detecting the mismatch: before invoking the RPC, check the package's resolved `external_route_id` against the active session and, if it differs, show a `route_mismatch` toast asking the user to either switch the session or skip the scan. The scan is still inserted with `scan_result = 'not_found'` to record the mistake.

**Return reason display:** each package row in the session shows `return_reason` so the receptionist understands why the item came back.

---

## Test Plan

| Layer | Tests |
|---|---|
| `recalculate_order_status` trigger | all packages → `retorno_hub` ⇒ order `status` AND `leading_status` = `en_retorno`; `retorno_hub` + `entregado` mix ⇒ both fields = `parcialmente_entregado`; first `retorno_hub`→`en_bodega` scan keeps order in `en_retorno` (or `parcialmente_entregado`); last scan promotes order back to `en_bodega` with correct `leading_status` (`en_bodega` in pure-return case, `entregado` in partial case); no `retorno_hub` packages ⇒ legacy MIN/MAX behaviour unchanged (regression-test status 2 happy path and full cancellation) |
| `pipeline_position` | unchanged — `retorno_hub` returns 0; existing entries return 1–8 |
| `process_failed_delivery` RPC | status 3 → all non-terminal packages `retorno_hub` + order `en_retorno` *(via trigger)*; status 4 with pre-existing `entregado` packages → those stay `entregado`, others move to `retorno_hub`, order `parcialmente_entregado`; duplicate webhook on an order already in a return state returns `skipped: true` and does NOT drag re-dispatched en_bodega/en_ruta packages back to `retorno_hub`; unknown `order_number` returns `order_not_found`; unsupported `p_dt_status` returns `unsupported_dt_status`; concurrent webhooks on the same order serialise (FOR UPDATE) |
| `complete_return_reception_scan` RPC | package moves to `en_bodega`; scan row recorded; `received_count` increments; `order_promoted: true` and `order_status: 'en_bodega'` when last `retorno_hub` package received (pure return); `order_status: 'en_bodega'` with `leading_status='entregado'` in partial-delivery case; `order_promoted: false` when other `retorno_hub` packages remain; package not in `retorno_hub` returns error; concurrent scans on the last two packages of an order serialise without producing inconsistent state |
| `get_ops_control_snapshot` | `returns` array populated with one row per order (not per package); empty when no returning orders; `age_minutes` present; *(spec-44a follow-up)* when `return_to_sender_state` is non-null, the order is excluded from `returns` |
| `useOpsControlSnapshot` hook | `returns` reads from RPC result (not hardcoded `[]`) |
| `ReturnsPanel` | renders `return_reason` and `return_reason_code` columns; shows age and SLA bucket; no longer shows the empty-state placeholder when the array is populated |
| `ReturnRouteList` / `useReturnRoutes` | groups by `external_route_id` via the `packages → orders → dispatches → routes` join; picks the most-recent dispatch when an order has multiple; surfaces "Sin ruta" bucket for orphan packages; empty state when no returning packages |
| `ReturnReceptionSession` / `useReturnReceptionSession` | `expected_count` is set on session creation; scan success → package removed from list; scan not_found → error shown and scan row inserted; wrong-route scan → `route_mismatch` toast and scan row inserted with `not_found`; duplicate scan handled |
| `pipeline.ts` | `retorno_hub` present in `PackageStatus`; NOT in `TERMINAL_PACKAGE_STATUSES`; `en_retorno` and `parcialmente_entregado` present in `OrderStatus`; `PIPELINE_STAGES` positions remain strictly increasing |
