# Epic 5 — DB & Realtime Foundation

**Date:** 2026-03-13
**Status:** completed
**Epic:** 5 — Operations Control Center
**Stories:** 5.1, 5.9

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

## Problem

The Operations Control Center needs a data foundation: order/package pipeline status tracking with dual-status model, priority calculation, capacity planning tables, pipeline count RPCs, and Supabase Realtime subscriptions. The existing `orders.status` column uses an old `order_status_enum` with values `('pending', 'processing', 'dispatched', 'delivered', 'failed')` that must be migrated to the new 8-stage pipeline model.

## Solution

Migrate the existing `order_status_enum` to the new pipeline model, add `package_status_enum`, extend both tables with status tracking, add a trigger that cascades package status changes to compute order-level min/max status, create a priority calculation function, add a `retailer_daily_capacities` table for negotiated capacity tracking, and enable Supabase Realtime on the `orders` table.

### Key Design Decisions

1. **Dual status model:** `packages.status` tracks individual package progression. `orders.status` = MIN of active packages, `orders.leading_status` = MAX of active packages. When they differ, the order is partial (e.g., "2/3 en bodega").
2. **Terminal status exclusion:** Packages with terminal statuses (`cancelado`, `devuelto`, `dañado`, `extraviado`) are excluded from order status computation. If all packages are terminal, the order becomes `cancelado`.
3. **Priority is computed at query time** via a DB function — not stored persistently (would go stale). No priority column on orders.
4. **Capacity as calendar:** One row per retailer per date in `retailer_daily_capacities`. No templates or overrides — explicit dates only. `source` column tracks whether set manually, by rule, or by future AI agent.
5. **Realtime on orders only:** Package status changes cascade to orders via trigger, so the frontend subscribes to `orders` table changes only. Manifests excluded (scoping decision — Story 5.9 mentions manifests but the OCC only needs order-level events).
6. **Enum migration:** The old `order_status_enum` is replaced with the new pipeline enum. Existing data is mapped: `pending→ingresado`, `processing→asignado`, `dispatched→en_ruta`, `delivered→entregado`, `failed→cancelado`.
7. **Capacity joins via `tenant_client_id`:** The `orders` table already has `tenant_client_id UUID REFERENCES tenant_clients(id)`. Capacity utilization joins on this FK, not on string name matching.

---

## Migration Strategy: Existing Enum Replacement

The `order_status_enum` was created in migration `20260223000001_create_automation_worker_schema.sql` with values `('pending', 'processing', 'dispatched', 'delivered', 'failed')`. The `orders.status` column uses this enum. Only `'delivered'` and `'failed'` are actively used in code (`src/lib/dispatch-order-status.ts`).

### Migration Steps

```sql
-- Step 1: Create new enum types
CREATE TYPE package_status_enum AS ENUM (
  'ingresado', 'verificado', 'en_bodega', 'asignado',
  'en_carga', 'listo', 'en_ruta', 'entregado',
  'cancelado', 'devuelto', 'dañado', 'extraviado'
);

CREATE TYPE new_order_status_enum AS ENUM (
  'ingresado', 'verificado', 'en_bodega', 'asignado',
  'en_carga', 'listo', 'en_ruta', 'entregado',
  'cancelado'
);

-- Step 2: Add new status column with mapped values
ALTER TABLE orders ADD COLUMN new_status new_order_status_enum;

UPDATE orders SET new_status = CASE status::text
  WHEN 'pending'    THEN 'ingresado'::new_order_status_enum
  WHEN 'processing' THEN 'asignado'::new_order_status_enum
  WHEN 'dispatched' THEN 'en_ruta'::new_order_status_enum
  WHEN 'delivered'  THEN 'entregado'::new_order_status_enum
  WHEN 'failed'     THEN 'cancelado'::new_order_status_enum
END;

ALTER TABLE orders ALTER COLUMN new_status SET NOT NULL;
ALTER TABLE orders ALTER COLUMN new_status SET DEFAULT 'ingresado';

-- Step 3: Drop old column and rename new
ALTER TABLE orders DROP COLUMN status;
ALTER TABLE orders RENAME COLUMN new_status TO status;

-- Step 4: Drop old enum, rename new to final name
DROP TYPE order_status_enum;
ALTER TYPE new_order_status_enum RENAME TO order_status_enum;

-- Step 5: Update dispatch-order-status mapping in code
-- src/lib/dispatch-order-status.ts must map to new enum values:
--   'delivered' → 'entregado'
--   'failed' → 'cancelado'
```

**Code changes required:**
- `src/lib/dispatch-order-status.ts` — update status mappings to use new enum values
- `src/lib/types.ts` — regenerate Supabase types (`supabase gen types typescript`)

---

## Data Model

### New ENUM (packages only — order enum migrated above)

```sql
CREATE TYPE package_status_enum AS ENUM (
  'ingresado', 'verificado', 'en_bodega', 'asignado',
  'en_carga', 'listo', 'en_ruta', 'entregado',
  'cancelado', 'devuelto', 'dañado', 'extraviado'
);
```

### Column Extensions

```sql
-- packages: add status tracking
ALTER TABLE packages ADD COLUMN status package_status_enum NOT NULL DEFAULT 'ingresado';
ALTER TABLE packages ADD COLUMN status_updated_at TIMESTAMPTZ DEFAULT NOW();

-- orders: add leading_status + status_updated_at (status column already migrated above)
ALTER TABLE orders ADD COLUMN leading_status order_status_enum NOT NULL DEFAULT 'ingresado';
ALTER TABLE orders ADD COLUMN status_updated_at TIMESTAMPTZ DEFAULT NOW();

-- Fix missing updated_at on orders and packages (architecture.md requirement)
ALTER TABLE orders ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE packages ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TRIGGER set_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_packages_updated_at
  BEFORE UPDATE ON packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

### New Indexes

```sql
CREATE INDEX idx_orders_operator_status ON orders(operator_id, status);
CREATE INDEX idx_orders_operator_leading ON orders(operator_id, leading_status);
CREATE INDEX idx_packages_operator_status ON packages(operator_id, status);
CREATE INDEX idx_packages_order_status ON packages(order_id, status);
```

### Retailer Daily Capacities Table

```sql
CREATE TABLE retailer_daily_capacities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES tenant_clients(id) ON DELETE CASCADE,
  capacity_date DATE NOT NULL,
  daily_capacity INT NOT NULL CHECK (daily_capacity >= 0),
  source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'rule', 'ai_agent')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Partial unique index: allows re-inserting after soft delete
CREATE UNIQUE INDEX idx_rdc_unique_active
  ON retailer_daily_capacities(operator_id, client_id, capacity_date)
  WHERE deleted_at IS NULL;

-- Indexes
CREATE INDEX idx_rdc_operator_date
  ON retailer_daily_capacities(operator_id, capacity_date);
CREATE INDEX idx_rdc_operator_client_date
  ON retailer_daily_capacities(operator_id, client_id, capacity_date);

-- Updated_at trigger
CREATE TRIGGER set_rdc_updated_at
  BEFORE UPDATE ON retailer_daily_capacities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE retailer_daily_capacities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rdc_tenant_isolation" ON retailer_daily_capacities
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "rdc_tenant_select" ON retailer_daily_capacities
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON retailer_daily_capacities TO authenticated;
REVOKE ALL ON retailer_daily_capacities FROM anon;

-- Audit trigger
CREATE TRIGGER audit_rdc_changes
  AFTER INSERT OR UPDATE OR DELETE ON retailer_daily_capacities
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
```

---

## Functions & Triggers

### Pipeline Position Helper

Maps enum values to ordinal positions for correct MIN/MAX comparison:

```sql
CREATE OR REPLACE FUNCTION pipeline_position(p_status TEXT)
RETURNS INT AS $$
  SELECT CASE p_status
    WHEN 'ingresado'  THEN 1
    WHEN 'verificado'  THEN 2
    WHEN 'en_bodega'   THEN 3
    WHEN 'asignado'    THEN 4
    WHEN 'en_carga'    THEN 5
    WHEN 'listo'       THEN 6
    WHEN 'en_ruta'     THEN 7
    WHEN 'entregado'   THEN 8
    ELSE 0  -- terminal statuses
  END;
$$ LANGUAGE sql IMMUTABLE;
```

### Order Status Recalculation Trigger

Fires on INSERT, UPDATE (status or deleted_at), and DELETE on packages:

```sql
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

  -- Count active (non-terminal, non-deleted) packages
  -- Terminal = pipeline_position returns 0
  SELECT COUNT(*) INTO v_active_count
  FROM packages
  WHERE order_id = v_order_id
    AND deleted_at IS NULL
    AND pipeline_position(status::text) > 0;

  -- If zero active packages → order is cancelado
  IF v_active_count = 0 THEN
    UPDATE orders SET
      status = 'cancelado',
      leading_status = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- MIN/MAX by pipeline position across active packages
  -- Use pipeline_position for correct ordinal comparison
  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  -- Map positions back to enum values (avoids unsafe cross-enum cast)
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
    status = v_min_status,
    leading_status = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire on: INSERT, status change, soft delete, hard delete
CREATE TRIGGER trg_recalculate_order_status
  AFTER INSERT OR UPDATE OF status, deleted_at OR DELETE ON packages
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_order_status();
```

**Note on backward transitions:** The trigger allows any status transition (e.g., `en_ruta → en_bodega` for returns). All changes are logged by the existing audit trigger on `packages`. No additional validation is needed — the audit trail is sufficient.

### Priority Calculation Function

```sql
CREATE OR REPLACE FUNCTION calculate_order_priority(
  p_delivery_date DATE,
  p_delivery_window_end TIME,
  p_current_time TIMESTAMPTZ DEFAULT NOW()
) RETURNS VARCHAR(10) AS $$
DECLARE
  v_deadline TIMESTAMPTZ;
  v_minutes_remaining INT;
BEGIN
  -- Combine date + window end into a deadline timestamp
  -- If no window_end, use end of delivery_date (23:59)
  v_deadline := (p_delivery_date + COALESCE(p_delivery_window_end, '23:59'::TIME))
                AT TIME ZONE 'America/Santiago';

  v_minutes_remaining := EXTRACT(EPOCH FROM (v_deadline - p_current_time)) / 60;

  RETURN CASE
    WHEN v_minutes_remaining < 0 THEN 'late'
    WHEN v_minutes_remaining < 45 THEN 'urgent'
    WHEN v_minutes_remaining < 120 THEN 'alert'
    ELSE 'ok'
  END;
END;
$$ LANGUAGE plpgsql STABLE;  -- STABLE, not IMMUTABLE: depends on current time
```

### Pipeline Counts RPC

```sql
CREATE OR REPLACE FUNCTION get_pipeline_counts(
  p_operator_id UUID,
  p_date DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  status order_status_enum,
  count BIGINT,
  urgent_count BIGINT,
  alert_count BIGINT,
  late_count BIGINT
) AS $$
  SELECT
    o.status,
    COUNT(*) AS count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'urgent') AS urgent_count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'alert') AS alert_count,
    COUNT(*) FILTER (WHERE calculate_order_priority(
      o.delivery_date, o.delivery_window_end
    ) = 'late') AS late_count
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date = p_date
    AND o.deleted_at IS NULL
    AND o.status != 'cancelado'
  GROUP BY o.status;
$$ LANGUAGE sql STABLE;
```

### Capacity Utilization RPC

```sql
CREATE OR REPLACE FUNCTION get_capacity_utilization(
  p_operator_id UUID,
  p_date_from DATE,
  p_date_to DATE
) RETURNS TABLE (
  client_id UUID,
  retailer_name VARCHAR,
  capacity_date DATE,
  daily_capacity INT,
  actual_orders BIGINT,
  utilization_pct NUMERIC
) AS $$
  SELECT
    rdc.client_id,
    tc.name AS retailer_name,
    rdc.capacity_date,
    rdc.daily_capacity,
    COUNT(o.id) AS actual_orders,
    ROUND(COUNT(o.id)::NUMERIC / NULLIF(rdc.daily_capacity, 0) * 100, 1)
  FROM retailer_daily_capacities rdc
  JOIN tenant_clients tc ON tc.id = rdc.client_id
  LEFT JOIN orders o ON o.operator_id = rdc.operator_id
    AND o.tenant_client_id = rdc.client_id
    AND o.delivery_date = rdc.capacity_date
    AND o.deleted_at IS NULL
  WHERE rdc.operator_id = p_operator_id
    AND rdc.capacity_date BETWEEN p_date_from AND p_date_to
    AND rdc.deleted_at IS NULL
  GROUP BY rdc.client_id, tc.name, rdc.capacity_date, rdc.daily_capacity;
$$ LANGUAGE sql STABLE;
```

---

## Supabase Realtime

### Publication

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
```

RLS automatically filters realtime events — only rows matching the subscriber's JWT `operator_id` are broadcast. Manifests are intentionally excluded (OCC only monitors order-level status).

### Frontend Hook

```typescript
// src/hooks/useRealtimeOrders.ts
import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';

export function useRealtimeOrders(operatorId: string) {
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const supabase = createSPAClient();

    const channel = supabase
      .channel(`operator:${operatorId}:orders`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `operator_id=eq.${operatorId}`,
      }, () => {
        // Debounce: batch invalidations within 1s window
        // Prevents 100 invalidations from bulk package status updates
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['pipeline-counts'] });
          queryClient.invalidateQueries({ queryKey: ['orders'] });
        }, 1000);
      })
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [operatorId, queryClient]);
}
```

### Realtime Status Hook

```typescript
// src/hooks/useRealtimeStatus.ts
import { useState, useEffect, useRef } from 'react';
import { createSPAClient } from '@/lib/supabase/client';

export function useRealtimeStatus(): 'connected' | 'disconnected' {
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const lastHeartbeat = useRef<number>(Date.now());

  useEffect(() => {
    const supabase = createSPAClient();

    // Listen to Supabase Realtime system events
    const channel = supabase.channel('system-status')
      .on('system', { event: '*' } as never, () => {
        lastHeartbeat.current = Date.now();
        setStatus('connected');
      })
      .subscribe((subscriptionStatus: string) => {
        if (subscriptionStatus === 'SUBSCRIBED') {
          lastHeartbeat.current = Date.now();
          setStatus('connected');
        }
        if (subscriptionStatus === 'CLOSED' || subscriptionStatus === 'CHANNEL_ERROR') {
          setStatus('disconnected');
        }
      });

    // Check heartbeat every 10s, mark disconnected if >30s stale
    const interval = setInterval(() => {
      if (Date.now() - lastHeartbeat.current > 30_000) {
        setStatus('disconnected');
      }
    }, 10_000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, []);

  return status;
}
```

### Fallback

If WebSocket disconnects for >30s, TanStack Query's `refetchInterval: 60_000` provides automatic polling fallback. No additional code needed.

---

## TypeScript Types

```typescript
// src/lib/types/pipeline.ts

// Package status (active pipeline + terminal)
export type PackageStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado' | 'devuelto' | 'dañado' | 'extraviado';

export const TERMINAL_PACKAGE_STATUSES: PackageStatus[] = [
  'cancelado', 'devuelto', 'dañado', 'extraviado',
];

// Order status (active pipeline + cancelado)
export type OrderStatus =
  | 'ingresado' | 'verificado' | 'en_bodega' | 'asignado'
  | 'en_carga' | 'listo' | 'en_ruta' | 'entregado'
  | 'cancelado';

export type OrderPriority = 'urgent' | 'alert' | 'ok' | 'late';

// Pipeline stage display config
export const PIPELINE_STAGES: {
  status: OrderStatus;
  label: string;
  icon: string;
  position: number;
}[] = [
  { status: 'ingresado', label: 'Ingresado', icon: 'PackagePlus', position: 1 },
  { status: 'verificado', label: 'Verificado', icon: 'ScanSearch', position: 2 },
  { status: 'en_bodega', label: 'En Bodega', icon: 'Warehouse', position: 3 },
  { status: 'asignado', label: 'Asignado', icon: 'UserCheck', position: 4 },
  { status: 'en_carga', label: 'En Carga', icon: 'Truck', position: 5 },
  { status: 'listo', label: 'Listo', icon: 'CheckCircle', position: 6 },
  { status: 'en_ruta', label: 'En Ruta', icon: 'Navigation', position: 7 },
  { status: 'entregado', label: 'Entregado', icon: 'PackageCheck', position: 8 },
];

// Priority display config
export const PRIORITY_CONFIG: Record<OrderPriority, {
  label: string;
  color: string;
  dotColor: string;
}> = {
  urgent: { label: 'Urgente', color: 'red', dotColor: 'bg-red-500' },
  alert: { label: 'Alerta', color: 'yellow', dotColor: 'bg-yellow-500' },
  ok: { label: 'OK', color: 'green', dotColor: 'bg-green-500' },
  late: { label: 'Atrasado', color: 'gray', dotColor: 'bg-gray-500' },
};
```

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260313000001_epic5_enum_migration.sql` | Drop old order_status_enum, create new enums, migrate data |
| `supabase/migrations/20260313000002_epic5_status_columns.sql` | Column extensions, updated_at, indexes |
| `supabase/migrations/20260313000003_epic5_functions_and_trigger.sql` | Trigger, priority fn, pipeline_position fn |
| `supabase/migrations/20260313000004_epic5_retailer_daily_capacities.sql` | Capacity table, RLS, indexes, audit trigger |
| `supabase/migrations/20260313000005_epic5_rpcs.sql` | get_pipeline_counts, get_capacity_utilization |
| `supabase/migrations/20260313000006_epic5_update_existing_rpcs.sql` | Update OTIF/delivery RPCs to use new enum values |
| `supabase/migrations/20260313000007_epic5_enable_realtime.sql` | Realtime publication |
| `supabase/functions/beetrack-webhook/index.ts` | Update order status writes to new enum values |
| `src/components/dashboard/OrdersDetailTable.tsx` | Update status labels, colors, and filter values |
| `src/components/dashboard/OrdersDetailTable.test.tsx` | Update mock data to new enum values |
| `src/components/dashboard/DeliveryTab.tsx` | Update scrollToOrders() calls to new enum values |
| `src/components/dashboard/DeliveryTab.test.tsx` | Update test assertions to new enum values |
| `src/lib/dispatch-order-status.ts` | Update status mappings to new enum values |
| `src/lib/dispatch-order-status.test.ts` | Update tests to new enum values |
| `src/lib/offline/indexedDB.test.ts` | Update mock order data to new enum values |
| `src/lib/types.ts` | Regenerate via `supabase gen types typescript` |
| `src/hooks/useRealtimeOrders.ts` | Realtime subscription hook with debounce |
| `src/hooks/useRealtimeStatus.ts` | WebSocket connection status hook |
| `src/lib/types/pipeline.ts` | TypeScript types and constants |

> **Note:** `dispatch_status_enum` (`pending`, `delivered`, `failed`, `partial`) is NOT being changed. Only `order_status_enum` is migrated. References to `d.status` (dispatch status) in OTIF/delivery functions remain unchanged. References to `o.status` (order status) change from `delivered→entregado`, `failed→cancelado`, etc.

---

## Dependencies

- **Requires:** Existing `orders`, `packages`, `tenant_clients` tables (already exist)
- **Blocks:** spec-04 (Desktop OCC), spec-05 (Mobile OCC), spec-06 (Capacity/Audit)

---

## Implementation Plan

**Goal:** Build the database foundation for the Operations Control Center — pipeline status enums, dual order/package status tracking, priority calculation, capacity tables, pipeline RPCs, Supabase Realtime, and update all existing consumers of the old enum.

**Architecture:** Seven SQL migrations executed in sequence (enum migration → columns → functions/triggers → capacity table → new RPCs → update existing RPCs → realtime). Update beetrack webhook edge function and dashboard UI components. Two frontend hooks (realtime subscription + connection status). One TypeScript types module.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, TanStack Query v5, Supabase Realtime, Vitest

---

### Pre-requisite: Create feature branch

- [ ] **Create branch before any commits**

```bash
git checkout -b feat/epic5-db-realtime-foundation
```

---

### Chunk 1: Database Migrations

#### Task 1: Migrate order_status_enum to pipeline model

**Files:** Create `apps/frontend/supabase/migrations/20260313000001_epic5_enum_migration.sql`

- [ ] **Step 1:** Write migration SQL (use SQL from "Migration Strategy" section above)
- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): migrate order_status_enum to 8-stage pipeline model"`

#### Task 2: Add status columns, updated_at, and indexes

**Files:** Create `apps/frontend/supabase/migrations/20260313000002_epic5_status_columns.sql`

- [ ] **Step 1:** Write migration SQL (use SQL from "Column Extensions" and "New Indexes" sections above)
- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): add status columns, updated_at, and indexes to orders/packages"`

#### Task 3: Create pipeline_position, priority, and order status trigger

**Files:** Create `apps/frontend/supabase/migrations/20260313000003_epic5_functions_and_trigger.sql`

- [ ] **Step 1:** Write migration SQL (use SQL from "Functions & Triggers" section above — all three functions + trigger)
- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): add pipeline functions and order status recalculation trigger"`

#### Task 4: Create retailer_daily_capacities table

**Files:** Create `apps/frontend/supabase/migrations/20260313000004_epic5_retailer_daily_capacities.sql`

- [ ] **Step 1:** Write migration SQL (use SQL from "Retailer Daily Capacities Table" section above, with this fix: replace the UNIQUE constraint with a partial unique index that excludes soft-deleted rows)

Replace:
```sql
CONSTRAINT unique_capacity_per_retailer_date
  UNIQUE (operator_id, client_id, capacity_date)
```
With:
```sql
-- Partial unique index: allows re-inserting after soft delete
CREATE UNIQUE INDEX idx_rdc_unique_active
  ON public.retailer_daily_capacities(operator_id, client_id, capacity_date)
  WHERE deleted_at IS NULL;
```

- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): create retailer_daily_capacities table with RLS and audit"`

#### Task 5: Create pipeline counts and capacity utilization RPCs

**Files:** Create `apps/frontend/supabase/migrations/20260313000005_epic5_rpcs.sql`

- [ ] **Step 1:** Write migration SQL (use SQL from "Pipeline Counts RPC" and "Capacity Utilization RPC" sections above)
- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): add get_pipeline_counts and get_capacity_utilization RPCs"`

#### Task 6: Update existing OTIF/delivery RPCs to use new enum values

**Files:** Create `apps/frontend/supabase/migrations/20260313000006_epic5_update_existing_rpcs.sql`

> **Important:** Only `o.status` references change (order_status_enum). All `d.status` references stay unchanged (dispatch_status_enum is NOT being migrated).

- [ ] **Step 1:** Write migration SQL

```sql
-- =============================================================
-- Epic 5: Update existing RPCs to use new order_status_enum values
-- Only o.status references change. d.status (dispatch_status_enum) stays unchanged.
-- Mapping: 'delivered' → 'entregado', 'failed' → 'cancelado'
-- =============================================================

-- 1. get_otif_metrics (latest version from 20260309000006)
CREATE OR REPLACE FUNCTION public.get_otif_metrics(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_orders', COUNT(*),
    'delivered_orders', COUNT(*) FILTER (WHERE o.status = 'entregado'),
    'failed_orders', COUNT(*) FILTER (
      WHERE o.status = 'cancelado'
      AND NOT EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'pending'
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'in_route_orders', COUNT(*) FILTER (
      WHERE o.status NOT IN ('entregado', 'cancelado')
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'pending_orders', COUNT(*) FILTER (
      WHERE o.status NOT IN ('entregado', 'cancelado')
      AND NOT EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.route_id IS NOT NULL
          AND d.deleted_at IS NULL
      )
    ),
    'on_time_deliveries', COUNT(*) FILTER (
      WHERE o.status = 'entregado'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_percentage', ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'entregado'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at IS NULL;
$$;

-- 2. get_otif_by_retailer (latest version from 20260309000005)
CREATE OR REPLACE FUNCTION public.get_otif_by_retailer(
  p_operator_id UUID,
  p_start_date  DATE,
  p_end_date    DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'retailer_name',  COALESCE(o.retailer_name, 'Sin cliente'),
    'total_orders',   COUNT(*),
    'delivered',      COUNT(*) FILTER (WHERE o.status = 'entregado'),
    'on_time',        COUNT(*) FILTER (
      WHERE o.status = 'entregado'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    ),
    'otif_pct',       ROUND(
      COUNT(*) FILTER (
        WHERE o.status = 'entregado'
        AND EXISTS (
          SELECT 1 FROM dispatches d
          WHERE d.order_id = o.id
            AND d.status = 'delivered'
            AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
            AND d.deleted_at IS NULL
        )
      )::numeric / NULLIF(COUNT(*), 0) * 100,
      1
    )
  )
  FROM orders o
  WHERE o.operator_id  = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at    IS NULL
  GROUP BY COALESCE(o.retailer_name, 'Sin cliente')
  ORDER BY ROUND(
    COUNT(*) FILTER (
      WHERE o.status = 'entregado'
      AND EXISTS (
        SELECT 1 FROM dispatches d
        WHERE d.order_id = o.id
          AND d.status = 'delivered'
          AND (d.completed_at AT TIME ZONE 'America/Santiago')::date <= o.delivery_date
          AND d.deleted_at IS NULL
      )
    )::numeric / NULLIF(COUNT(*), 0) * 100,
    1
  ) ASC NULLS FIRST;
$$;

-- 3. get_late_deliveries
CREATE OR REPLACE FUNCTION public.get_late_deliveries(
  p_operator_id UUID,
  p_start_date  DATE,
  p_end_date    DATE
)
RETURNS SETOF JSON
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT json_build_object(
    'order_number',   o.order_number,
    'retailer_name',  o.retailer_name,
    'delivery_date',  o.delivery_date,
    'completed_date', (d.completed_at AT TIME ZONE 'America/Santiago')::date,
    'days_late',      (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date,
    'driver_name',    r.driver_name
  )
  FROM orders o
  JOIN dispatches d ON d.order_id = o.id
    AND d.status     = 'delivered'
    AND d.deleted_at IS NULL
  LEFT JOIN routes r ON r.id = d.route_id
    AND r.deleted_at IS NULL
  WHERE o.operator_id  = p_operator_id
    AND o.status       = 'entregado'
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at   IS NULL
    AND (d.completed_at AT TIME ZONE 'America/Santiago')::date > o.delivery_date
  ORDER BY (d.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date DESC;
$$;

-- 4. get_orders_detail
CREATE OR REPLACE FUNCTION public.get_orders_detail(
  p_operator_id  UUID,
  p_start_date   DATE,
  p_end_date     DATE,
  p_status       TEXT     DEFAULT NULL,
  p_retailer     TEXT     DEFAULT NULL,
  p_search       TEXT     DEFAULT NULL,
  p_overdue_only BOOLEAN  DEFAULT FALSE,
  p_page         INTEGER  DEFAULT 1,
  p_page_size    INTEGER  DEFAULT 25
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
SET timezone = 'America/Santiago'
AS $$
DECLARE
  v_offset      INTEGER;
  v_total_count BIGINT;
  v_rows        JSON;
  v_today       DATE;
BEGIN
  v_offset := (p_page - 1) * p_page_size;
  v_today  := (NOW() AT TIME ZONE 'America/Santiago')::date;

  SELECT COUNT(*)
  INTO v_total_count
  FROM orders o
  LEFT JOIN LATERAL (
    SELECT d.completed_at, d.failure_reason, d.route_id
    FROM dispatches d
    WHERE d.order_id   = o.id
      AND d.deleted_at IS NULL
    ORDER BY d.completed_at DESC NULLS LAST
    LIMIT 1
  ) ld ON true
  WHERE o.operator_id  = p_operator_id
    AND o.delivery_date BETWEEN p_start_date AND p_end_date
    AND o.delivery_date IS NOT NULL
    AND o.deleted_at    IS NULL
    AND (p_status   IS NULL OR o.status::text = p_status)
    AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
    AND (p_search   IS NULL OR o.order_number ILIKE '%' || p_search || '%')
    AND (NOT p_overdue_only OR (
      o.status NOT IN ('entregado', 'cancelado')
      AND o.delivery_date < v_today
    ));

  SELECT COALESCE(json_agg(row_data), '[]'::json)
  INTO v_rows
  FROM (
    SELECT json_build_object(
      'id',             o.id,
      'order_number',   o.order_number,
      'retailer_name',  o.retailer_name,
      'comuna',         o.comuna,
      'delivery_date',  o.delivery_date,
      'created_at',     o.created_at,
      'status',         o.status,
      'completed_at',   ld.completed_at,
      'driver_name',    r.driver_name,
      'route_id',       ld.route_id,
      'failure_reason', ld.failure_reason,
      'days_delta',     CASE
        WHEN o.status = 'entregado' AND ld.completed_at IS NOT NULL
          THEN (ld.completed_at AT TIME ZONE 'America/Santiago')::date - o.delivery_date
        WHEN o.status NOT IN ('entregado', 'cancelado') AND o.delivery_date < v_today
          THEN v_today - o.delivery_date
        ELSE NULL
      END
    ) AS row_data
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT d.completed_at, d.failure_reason, d.route_id
      FROM dispatches d
      WHERE d.order_id   = o.id
        AND d.deleted_at IS NULL
      ORDER BY d.completed_at DESC NULLS LAST
      LIMIT 1
    ) ld ON true
    LEFT JOIN routes r ON r.id = ld.route_id
      AND r.deleted_at IS NULL
    WHERE o.operator_id  = p_operator_id
      AND o.delivery_date BETWEEN p_start_date AND p_end_date
      AND o.delivery_date IS NOT NULL
      AND o.deleted_at    IS NULL
      AND (p_status   IS NULL OR o.status::text = p_status)
      AND (p_retailer IS NULL OR o.retailer_name = p_retailer)
      AND (p_search   IS NULL OR o.order_number ILIKE '%' || p_search || '%')
      AND (NOT p_overdue_only OR (
        o.status NOT IN ('entregado', 'cancelado')
        AND o.delivery_date < v_today
      ))
    ORDER BY o.delivery_date DESC, o.order_number ASC
    OFFSET v_offset
    LIMIT p_page_size
  ) sub;

  RETURN json_build_object(
    'rows',        v_rows,
    'total_count', v_total_count
  );
END;
$$;
```

- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): update OTIF and delivery RPCs to use new order enum values"`

#### Task 7: Enable Supabase Realtime on orders table

**Files:** Create `apps/frontend/supabase/migrations/20260313000007_epic5_enable_realtime.sql`

- [ ] **Step 1:** Write migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;`
- [ ] **Step 2:** Verify: `cd apps/frontend && npx supabase db reset 2>&1 | tail -20` → no errors
- [ ] **Step 3:** Commit: `git commit -m "feat(epic5): enable Supabase Realtime on orders table"`

---

### Chunk 2: Edge Function & UI Updates

#### Task 8: Update beetrack-webhook to use new order enum values

**Files:** Modify `apps/frontend/supabase/functions/beetrack-webhook/index.ts`

> **Note:** The `STATUS_MAP` (lines 5-10) maps DispatchTrack codes to `dispatch_status_enum` values — do NOT change these. Only the order status writes (lines 146-161) need updating.

- [ ] **Step 1:** Update lines 146-161 — change order status values:

Replace:
```typescript
    const orderStatus = status === 'delivered' ? 'delivered' : 'failed';
```
With:
```typescript
    const orderStatus = status === 'delivered' ? 'entregado' : 'cancelado';
```

Replace:
```typescript
      .neq('status', 'delivered'); // Never downgrade from delivered
```
With:
```typescript
      .neq('status', 'entregado'); // Never downgrade from entregado
```

- [ ] **Step 2:** Commit: `git commit -m "feat(epic5): update beetrack-webhook order status writes to new enum values"`

#### Task 9: Update OrdersDetailTable to use new enum values

**Files:** Modify `apps/frontend/src/components/dashboard/OrdersDetailTable.tsx`

- [ ] **Step 1:** Update STATUS_LABELS map (lines 15-21):

```typescript
const STATUS_LABELS: Record<string, string> = {
  ingresado: 'Ingresado',
  verificado: 'Verificado',
  en_bodega: 'En Bodega',
  asignado: 'Asignado',
  en_carga: 'En Carga',
  listo: 'Listo',
  en_ruta: 'En Ruta',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};
```

- [ ] **Step 2:** Update STATUS_COLORS map (lines 23-29):

```typescript
const STATUS_COLORS: Record<string, string> = {
  ingresado: 'bg-slate-100 text-slate-700',
  verificado: 'bg-blue-100 text-blue-700',
  en_bodega: 'bg-cyan-100 text-cyan-700',
  asignado: 'bg-indigo-100 text-indigo-700',
  en_carga: 'bg-purple-100 text-purple-700',
  listo: 'bg-teal-100 text-teal-700',
  en_ruta: 'bg-amber-100 text-amber-700',
  entregado: 'bg-emerald-100 text-emerald-700',
  cancelado: 'bg-red-100 text-red-700',
};
```

- [ ] **Step 3:** Update filter dropdown options (lines 134-140):

```html
<option value="">Todos los estados</option>
<option value="entregado">Entregado</option>
<option value="cancelado">Cancelado</option>
<option value="ingresado">Ingresado</option>
<option value="en_ruta">En Ruta</option>
<option value="en_bodega">En Bodega</option>
<option value="asignado">Asignado</option>
```

- [ ] **Step 4:** Update test file `OrdersDetailTable.test.tsx` — change MOCK_ROWS statuses: `'delivered'→'entregado'`, `'failed'→'cancelado'`, `'pending'→'ingresado'`. Update `initialStatus="failed"` → `initialStatus="cancelado"` and assertion `.toBe('failed')` → `.toBe('cancelado')`.
- [ ] **Step 5:** Commit: `git commit -m "feat(epic5): update OrdersDetailTable status maps to new enum values"`

#### Task 10: Update DeliveryTab to use new enum values

**Files:** Modify `apps/frontend/src/components/dashboard/DeliveryTab.tsx`

- [ ] **Step 1:** Update scrollToOrders calls (lines 104, 113, 122):

```typescript
onClick={() => scrollToOrders('entregado')}   // was 'delivered'
onClick={() => scrollToOrders('cancelado')}    // was 'failed'
onClick={() => scrollToOrders('ingresado')}    // was 'pending'
```

- [ ] **Step 2:** Update test file `DeliveryTab.test.tsx` — change assertion `.toBe('failed')` → `.toBe('cancelado')`.
- [ ] **Step 3:** Update `indexedDB.test.ts` — change mock order `status: 'delivered'` → `'entregado'`, `status: 'pending'` → `'ingresado'`.
- [ ] **Step 4:** Commit: `git commit -m "feat(epic5): update DeliveryTab and test fixtures to new enum values"`

---

### Chunk 3: TypeScript Types & dispatch-order-status

#### Task 11: Create pipeline TypeScript types and constants

**Files:**
- Create: `apps/frontend/src/lib/types/pipeline.ts`
- Create: `apps/frontend/src/lib/types/pipeline.test.ts`

- [ ] **Step 1:** Write failing test (see "TypeScript Types" section above for the types to test):

```typescript
// apps/frontend/src/lib/types/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES, TERMINAL_PACKAGE_STATUSES, PRIORITY_CONFIG,
  type PackageStatus, type OrderStatus, type OrderPriority,
} from './pipeline';

describe('pipeline types and constants', () => {
  it('PIPELINE_STAGES has exactly 8 active stages in order', () => {
    expect(PIPELINE_STAGES).toHaveLength(8);
    expect(PIPELINE_STAGES[0].status).toBe('ingresado');
    expect(PIPELINE_STAGES[7].status).toBe('entregado');
  });

  it('PIPELINE_STAGES positions are sequential 1-8', () => {
    PIPELINE_STAGES.forEach((stage, i) => {
      expect(stage.position).toBe(i + 1);
    });
  });

  it('TERMINAL_PACKAGE_STATUSES contains exactly 4 terminal statuses', () => {
    expect(TERMINAL_PACKAGE_STATUSES).toHaveLength(4);
    expect(TERMINAL_PACKAGE_STATUSES).toContain('cancelado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('devuelto');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('dañado');
    expect(TERMINAL_PACKAGE_STATUSES).toContain('extraviado');
  });

  it('PRIORITY_CONFIG covers all four priority levels', () => {
    const keys = Object.keys(PRIORITY_CONFIG) as OrderPriority[];
    expect(keys).toHaveLength(4);
    expect(keys).toContain('urgent');
    expect(keys).toContain('alert');
    expect(keys).toContain('ok');
    expect(keys).toContain('late');
  });

  it('each PRIORITY_CONFIG entry has label, color, and dotColor', () => {
    Object.values(PRIORITY_CONFIG).forEach((config) => {
      expect(config).toHaveProperty('label');
      expect(config).toHaveProperty('color');
      expect(config).toHaveProperty('dotColor');
      expect(config.dotColor).toMatch(/^bg-/);
    });
  });
});
```

- [ ] **Step 2:** Run test: `cd apps/frontend && pnpm test:run src/lib/types/pipeline.test.ts` → FAIL (module not found)
- [ ] **Step 3:** Write implementation (use code from "TypeScript Types" section above)
- [ ] **Step 4:** Run test → PASS (5 tests)
- [ ] **Step 5:** Commit: `git commit -m "feat(epic5): add pipeline TypeScript types and constants"`

#### Task 12: Update dispatch-order-status to use new enum values

**Files:**
- Modify: `apps/frontend/src/lib/dispatch-order-status.ts`
- Modify: `apps/frontend/src/lib/dispatch-order-status.test.ts`

- [ ] **Step 1:** Update tests to expect `'entregado'`/`'cancelado'` instead of `'delivered'`/`'failed'`. Update `shouldSkipOrderUpdate` tests to use new enum values (`'entregado'`, `'ingresado'`, `'asignado'`, `'en_ruta'`, etc.)
- [ ] **Step 2:** Run tests → FAIL (code still returns old values)
- [ ] **Step 3:** Update `dispatch-order-status.ts`:
  - Change `OrderStatusUpdate.orderStatus` type to `'entregado' | 'cancelado'`
  - Change return value: `status === 'delivered' ? 'entregado' : 'cancelado'`
  - Change `shouldSkipOrderUpdate`: check `currentOrderStatus === 'entregado'`
- [ ] **Step 4:** Run tests → PASS
- [ ] **Step 5:** Commit: `git commit -m "feat(epic5): update dispatch-order-status to use new pipeline enum values"`

---

### Chunk 4: Frontend Hooks

#### Task 13: Create useRealtimeOrders hook

**Files:**
- Create: `apps/frontend/src/hooks/useRealtimeOrders.ts`
- Create: `apps/frontend/src/hooks/useRealtimeOrders.test.ts`

- [ ] **Step 1:** Write failing test (mock supabase client, verify channel subscription with operator filter, verify cleanup on unmount)
- [ ] **Step 2:** Run test → FAIL
- [ ] **Step 3:** Write implementation (use code from "Frontend Hook" section above — import `createSPAClient` from `@/lib/supabase/client`, add 1s debounce on invalidation)
- [ ] **Step 4:** Run test → PASS
- [ ] **Step 5:** Commit: `git commit -m "feat(epic5): add useRealtimeOrders hook with debounced invalidation"`

#### Task 14: Create useRealtimeStatus hook

**Files:**
- Create: `apps/frontend/src/hooks/useRealtimeStatus.ts`
- Create: `apps/frontend/src/hooks/useRealtimeStatus.test.ts`

- [ ] **Step 1:** Write failing test (verify starts as 'disconnected', becomes 'connected' on SUBSCRIBED callback, cleans up on unmount)
- [ ] **Step 2:** Run test → FAIL
- [ ] **Step 3:** Write implementation — track connection via `subscribe()` callback status (SUBSCRIBED → connected, CLOSED/CHANNEL_ERROR → disconnected). 30s timeout fallback via interval.
- [ ] **Step 4:** Run test → PASS
- [ ] **Step 5:** Commit: `git commit -m "feat(epic5): add useRealtimeStatus hook for WebSocket connection monitoring"`

---

### Chunk 5: Regenerate Types, Build & PR

#### Task 15: Regenerate Supabase TypeScript types and verify

- [ ] **Step 1:** `cd apps/frontend && npx supabase gen types typescript --local > src/lib/types.ts`
- [ ] **Step 2:** Verify enums: `grep -c "order_status_enum\|package_status_enum" src/lib/types.ts` → matches
- [ ] **Step 3:** Run full test suite: `cd apps/frontend && pnpm test:run` → all pass
- [ ] **Step 4:** Run build: `cd apps/frontend && pnpm build 2>&1 | tail -20` → succeeds
- [ ] **Step 5:** Commit: `git commit -m "chore(epic5): regenerate Supabase TypeScript types with new enums"`

#### Task 16: Push and open PR

- [ ] **Step 1:** Push: `git push origin feat/epic5-db-realtime-foundation`
- [ ] **Step 2:** Open PR with auto-merge:

```bash
gh pr create --title "feat(epic5): DB & Realtime foundation for Operations Control Center" --body "$(cat <<'EOF'
## Summary
- Migrate `order_status_enum` from old 5-value to new 8-stage pipeline model
- Add `package_status_enum` with 12 values (8 active + 4 terminal)
- Add dual status tracking: `packages.status` + `orders.status`/`leading_status`
- Add `recalculate_order_status` trigger (cascades package→order status)
- Add `calculate_order_priority` function (time-based urgency)
- Add `retailer_daily_capacities` table with RLS and audit
- Add `get_pipeline_counts` and `get_capacity_utilization` RPCs
- Update OTIF/delivery RPCs to use new enum values
- Update beetrack-webhook edge function for new enum
- Update OrdersDetailTable and DeliveryTab for new enum
- Enable Supabase Realtime on orders table
- Add `useRealtimeOrders` and `useRealtimeStatus` frontend hooks
- Update `dispatch-order-status.ts` to use new enum values

## Test plan
- [ ] `cd apps/frontend && pnpm test:run` — all tests pass
- [ ] `cd apps/frontend && pnpm build` — no TypeScript errors
- [ ] `cd apps/frontend && npx supabase db reset` — all migrations apply cleanly
- [ ] Verify order status recalculation: insert packages with different statuses, confirm order.status = MIN, order.leading_status = MAX
- [ ] Verify terminal exclusion: set package to 'cancelado', confirm it's excluded from order status calculation
- [ ] Verify OTIF dashboard still works with new enum values

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --auto --squash
```

- [ ] **Step 3:** Verify CI: `gh pr checks <N>` + `gh pr view <N> --json state,mergedAt` → green + merged
- [ ] **Step 4:** Update status at top of this file: `**Status:** backlog` → `**Status:** in progress`
