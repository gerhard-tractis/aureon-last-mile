-- Migration: Create Routes, Dispatches, Fleet Vehicles Tables
-- Created: 2026-03-06
-- Story: 3B.1 - Schema Design — Routes, Dispatches, Fleet Vehicles
-- Epic: 3B - Delivery & Fleet Intelligence
-- Purpose: Provider-agnostic tables for route tracking, dispatch events, and fleet management.
--          Replaces delivery_attempts table — RPCs rewritten to query dispatches directly.
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators table)
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql (audit_trigger_func)
--   - 20260217000003_create_orders_table.sql (orders table)
--   - 20260223000001_create_automation_worker_schema.sql (set_updated_at function)
--   - 20260224000001_create_performance_metrics_tables.sql (delivery_attempts — being replaced)

-- ============================================================================
-- PART 1: Create ENUM Types (idempotent)
-- ============================================================================

-- routing_provider_enum: Supported routing providers
DO $$ BEGIN
  CREATE TYPE routing_provider_enum AS ENUM ('dispatchtrack', 'simpliroute', 'drivin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE routing_provider_enum IS 'Supported last-mile routing providers (Story 3B.1)';

-- route_status_enum: Route lifecycle states
DO $$ BEGIN
  CREATE TYPE route_status_enum AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE route_status_enum IS 'Route lifecycle states derived from started/ended webhook fields (Story 3B.1)';

-- dispatch_status_enum: Dispatch/delivery outcome states
DO $$ BEGIN
  CREATE TYPE dispatch_status_enum AS ENUM (
    'pending',      -- Assigned to route, not yet attempted (DT status=1)
    'delivered',    -- Successfully delivered (DT status=2, terminal)
    'failed',       -- Delivery failed/rejected (DT status=3, terminal)
    'partial'       -- Partial delivery (DT status=4, terminal)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE dispatch_status_enum IS 'Dispatch outcome states mapped from DispatchTrack status codes 1-4 (Story 3B.1)';

-- ============================================================================
-- PART 2: Create fleet_vehicles Table (BEFORE routes — routes references it)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  provider            routing_provider_enum NOT NULL,
  external_vehicle_id VARCHAR(100),      -- truck_identifier from webhook (e.g. "ZALDUENDO")
  plate_number        VARCHAR(20),       -- license plate if known
  vehicle_type        VARCHAR(50),       -- truck_type from webhook (e.g. "Furgón")
  driver_name         VARCHAR(255),      -- last known driver
  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT unique_vehicle_per_operator UNIQUE (operator_id, provider, external_vehicle_id)
);

COMMENT ON TABLE  public.fleet_vehicles IS 'Provider-agnostic fleet vehicle registry. Upserted from webhook truck_identifier field.';
COMMENT ON COLUMN public.fleet_vehicles.external_vehicle_id IS 'Vehicle identifier from routing provider (e.g. truck_identifier in DispatchTrack)';
COMMENT ON COLUMN public.fleet_vehicles.plate_number IS 'License plate number if known (may differ from external_vehicle_id)';

-- ============================================================================
-- PART 3: Create routes Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.routes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  provider            routing_provider_enum NOT NULL,
  external_route_id   VARCHAR(100) NOT NULL,  -- route_id from webhook (integer as string)
  route_date          DATE NOT NULL,
  driver_name         VARCHAR(255),            -- truck_driver from route webhook
  vehicle_id          UUID REFERENCES public.fleet_vehicles(id) ON DELETE SET NULL,
  status              route_status_enum NOT NULL DEFAULT 'planned',
  planned_stops       INTEGER,
  completed_stops     INTEGER DEFAULT 0,
  start_time          TIMESTAMPTZ,             -- started_at from route webhook
  end_time            TIMESTAMPTZ,             -- ended_at from route webhook
  total_km            DECIMAL(10,2),           -- kpi_distance from route webhook
  idle_time_minutes   INTEGER,
  raw_data            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,
  CONSTRAINT unique_route_per_operator_provider UNIQUE (operator_id, provider, external_route_id)
);

COMMENT ON TABLE  public.routes IS 'Provider-agnostic route records. Each route has multiple dispatches (stops).';
COMMENT ON COLUMN public.routes.external_route_id IS 'Route ID from routing provider (e.g. route_id integer from DispatchTrack)';

-- ============================================================================
-- PART 4: Create dispatches Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dispatches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id           UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  route_id              UUID REFERENCES public.routes(id) ON DELETE SET NULL,
  order_id              UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  provider              routing_provider_enum NOT NULL,
  external_dispatch_id  VARCHAR(100),           -- dispatch_id from webhook (integer as string)
  status                dispatch_status_enum NOT NULL DEFAULT 'pending',
  substatus             VARCHAR(255),            -- substatus text from webhook
  substatus_code        VARCHAR(10),             -- substatus_code from webhook (e.g. "07")
  planned_sequence      INTEGER,                 -- position from webhook
  estimated_at          TIMESTAMPTZ,             -- estimated_at from webhook (for OTIF)
  arrived_at            TIMESTAMPTZ,             -- arrived_at from webhook
  completed_at          TIMESTAMPTZ,             -- time_of_management from webhook
  failure_reason        VARCHAR(255),            -- derived from substatus for failed dispatches
  driver_notes          TEXT,
  is_pickup             BOOLEAN NOT NULL DEFAULT false,  -- is_pickup from webhook
  latitude              DECIMAL(10,7),           -- management_latitude from webhook
  longitude             DECIMAL(10,7),           -- management_longitude from webhook
  raw_data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ,
  CONSTRAINT unique_dispatch_per_operator UNIQUE (operator_id, provider, external_dispatch_id)
);

COMMENT ON TABLE  public.dispatches IS 'Provider-agnostic dispatch events. Each dispatch links a route stop to an order.';
COMMENT ON COLUMN public.dispatches.route_id IS 'Nullable — dispatch event may arrive before route event';
COMMENT ON COLUMN public.dispatches.order_id IS 'Nullable — order may not exist yet (webhook before CSV import)';
COMMENT ON COLUMN public.dispatches.estimated_at IS 'Planned delivery time from routing provider. Used for OTIF calculation.';
COMMENT ON COLUMN public.dispatches.is_pickup IS 'True if this is a pickup movement, not a delivery';

-- ============================================================================
-- PART 5: Create Indexes
-- ============================================================================

-- Routes
CREATE INDEX IF NOT EXISTS idx_routes_operator_id ON public.routes(operator_id);
CREATE INDEX IF NOT EXISTS idx_routes_operator_date ON public.routes(operator_id, route_date);
CREATE INDEX IF NOT EXISTS idx_routes_operator_provider ON public.routes(operator_id, provider);
CREATE INDEX IF NOT EXISTS idx_routes_deleted_at ON public.routes(deleted_at);

-- Dispatches
CREATE INDEX IF NOT EXISTS idx_dispatches_operator_id ON public.dispatches(operator_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_route_id ON public.dispatches(route_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_order_id ON public.dispatches(order_id);
CREATE INDEX IF NOT EXISTS idx_dispatches_operator_status ON public.dispatches(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_dispatches_completed_at ON public.dispatches(operator_id, completed_at);
CREATE INDEX IF NOT EXISTS idx_dispatches_deleted_at ON public.dispatches(deleted_at);

-- Fleet Vehicles
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_operator_id ON public.fleet_vehicles(operator_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_plate ON public.fleet_vehicles(operator_id, plate_number);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_deleted_at ON public.fleet_vehicles(deleted_at);

-- ============================================================================
-- PART 6: Enable RLS + Create Tenant Isolation Policies
-- ============================================================================

-- fleet_vehicles RLS
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "fleet_vehicles_tenant_isolation" ON public.fleet_vehicles
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "fleet_vehicles_tenant_select" ON public.fleet_vehicles
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- routes RLS
ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "routes_tenant_isolation" ON public.routes
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "routes_tenant_select" ON public.routes
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- dispatches RLS
ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "dispatches_tenant_isolation" ON public.dispatches
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "dispatches_tenant_select" ON public.dispatches
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 7: GRANT/REVOKE Permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_vehicles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatches TO authenticated;
REVOKE ALL ON public.fleet_vehicles FROM anon;
REVOKE ALL ON public.routes FROM anon;
REVOKE ALL ON public.dispatches FROM anon;

-- Service role needs full access for edge function upserts
GRANT ALL ON public.fleet_vehicles TO service_role;
GRANT ALL ON public.routes TO service_role;
GRANT ALL ON public.dispatches TO service_role;

-- ============================================================================
-- PART 8: Attach Audit Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER audit_fleet_vehicles_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.fleet_vehicles
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_routes_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.routes
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dispatches_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.dispatches
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 9: Attach set_updated_at Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_fleet_vehicles_updated_at
    BEFORE UPDATE ON public.fleet_vehicles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_routes_updated_at
    BEFORE UPDATE ON public.routes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_dispatches_updated_at
    BEFORE UPDATE ON public.dispatches
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 10: Drop delivery_attempts table and rewrite RPCs
-- ============================================================================
-- delivery_attempts is now redundant — dispatches captures all delivery events.
-- The 2 RPCs that queried delivery_attempts are rewritten to query dispatches directly.
-- The edge function (beetrack-webhook) still writes to delivery_attempts — Story 3B.2
-- will update it to write to dispatches instead. Until then, webhook upserts will fail
-- but payloads are logged and not lost.

-- 10a: Drop audit trigger on delivery_attempts first
DROP TRIGGER IF EXISTS audit_delivery_attempts_changes ON public.delivery_attempts;

-- 10b: Drop RLS policies
DROP POLICY IF EXISTS "delivery_attempts_tenant_isolation" ON public.delivery_attempts;
DROP POLICY IF EXISTS "delivery_attempts_tenant_select" ON public.delivery_attempts;

-- 10c: Migrate existing delivery_attempts data into dispatches
-- This preserves historical delivery data that was already captured
INSERT INTO public.dispatches (
  operator_id,
  order_id,
  provider,
  external_dispatch_id,
  status,
  failure_reason,
  completed_at,
  created_at,
  deleted_at
)
SELECT
  da.operator_id,
  da.order_id,
  'dispatchtrack'::routing_provider_enum,
  -- Use order_id + attempt_number as synthetic dispatch ID to avoid conflicts
  da.order_id::text || '_legacy_' || da.attempt_number::text,
  CASE da.status
    WHEN 'success' THEN 'delivered'::dispatch_status_enum
    WHEN 'failed'  THEN 'failed'::dispatch_status_enum
    WHEN 'returned' THEN 'failed'::dispatch_status_enum  -- no 'returned' in dispatch_status_enum
  END,
  da.failure_reason,
  da.attempted_at,
  da.created_at,
  da.deleted_at
FROM public.delivery_attempts da
ON CONFLICT (operator_id, provider, external_dispatch_id) DO NOTHING;

-- 10d: Drop the delivery_attempts table
DROP TABLE IF EXISTS public.delivery_attempts CASCADE;

-- 10e: Drop the old enum (no longer needed — dispatch_status_enum replaces it)
DROP TYPE IF EXISTS delivery_attempt_status_enum;

-- 10f: Drop the unique constraint/index migrations that were for delivery_attempts
-- (These would have been dropped CASCADE with the table, but be explicit)

-- ============================================================================
-- PART 11: Rewrite get_failure_reasons to query dispatches
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_failure_reasons(
  p_operator_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH failure_counts AS (
    SELECT
      COALESCE(failure_reason, substatus, 'Unknown') AS reason,
      COUNT(*) AS count
    FROM public.dispatches
    WHERE operator_id = p_operator_id
      AND completed_at >= p_start_date::TIMESTAMPTZ
      AND completed_at < (p_end_date + INTERVAL '1 day')::TIMESTAMPTZ
      AND status = 'failed'
      AND deleted_at IS NULL
    GROUP BY COALESCE(failure_reason, substatus, 'Unknown')
  ),
  total AS (
    SELECT COALESCE(SUM(count), 0) AS total_failures FROM failure_counts
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'reason', fc.reason,
        'count', fc.count,
        'percentage', ROUND(fc.count::NUMERIC / NULLIF(t.total_failures, 0) * 100, 2)
      )
      ORDER BY fc.count DESC
    ),
    '[]'::jsonb
  )
  FROM failure_counts fc
  CROSS JOIN total t;
$$;

COMMENT ON FUNCTION public.get_failure_reasons(UUID, DATE, DATE) IS 'Get failure reasons breakdown from dispatches table. Returns JSON array [{reason, count, percentage}].';

-- ============================================================================
-- PART 12: Rewrite calculate_daily_metrics to query dispatches
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_daily_metrics(p_date DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator RECORD;
  v_retailer RECORD;
  v_metrics RECORD;
BEGIN
  -- Loop over all operators
  FOR v_operator IN
    SELECT id FROM public.operators WHERE deleted_at IS NULL
  LOOP
    -- Per-retailer breakdown
    FOR v_retailer IN
      SELECT DISTINCT retailer_name
      FROM public.orders
      WHERE operator_id = v_operator.id
        AND delivery_date = p_date
        AND deleted_at IS NULL
        AND retailer_name IS NOT NULL
    LOOP
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.dispatches d
          WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
        )) AS delivered,
        COUNT(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM public.dispatches d
          WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
          -- For FADR: first-attempt delivery = no prior failed dispatch for this order
          AND NOT EXISTS (
            SELECT 1 FROM public.dispatches d2
            WHERE d2.order_id = o.id AND d2.status = 'failed' AND d2.deleted_at IS NULL
              AND d2.completed_at < d.completed_at
          )
        )) AS first_attempt,
        COUNT(*) FILTER (WHERE
          EXISTS (
            SELECT 1 FROM public.dispatches d
            WHERE d.order_id = o.id AND d.status = 'failed' AND d.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.dispatches d
            WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
          )
        ) AS failed
      INTO v_metrics
      FROM public.orders o
      WHERE o.operator_id = v_operator.id
        AND o.delivery_date = p_date
        AND o.retailer_name = v_retailer.retailer_name
        AND o.deleted_at IS NULL;

      INSERT INTO public.performance_metrics (
        operator_id, metric_date, retailer_name,
        total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries,
        shortage_claims_count, shortage_claims_amount_clp, avg_delivery_time_minutes
      ) VALUES (
        v_operator.id, p_date, v_retailer.retailer_name,
        v_metrics.total, v_metrics.delivered, v_metrics.first_attempt, v_metrics.failed,
        0, 0, NULL
      )
      ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
      DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        delivered_orders = EXCLUDED.delivered_orders,
        first_attempt_deliveries = EXCLUDED.first_attempt_deliveries,
        failed_deliveries = EXCLUDED.failed_deliveries,
        shortage_claims_count = performance_metrics.shortage_claims_count,
        shortage_claims_amount_clp = performance_metrics.shortage_claims_amount_clp,
        avg_delivery_time_minutes = performance_metrics.avg_delivery_time_minutes,
        updated_at = NOW();
    END LOOP;

    -- Aggregate row (retailer_name = NULL → all retailers combined)
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.dispatches d
        WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
      )) AS delivered,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM public.dispatches d
        WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.dispatches d2
          WHERE d2.order_id = o.id AND d2.status = 'failed' AND d2.deleted_at IS NULL
            AND d2.completed_at < d.completed_at
        )
      )) AS first_attempt,
      COUNT(*) FILTER (WHERE
        EXISTS (
          SELECT 1 FROM public.dispatches d
          WHERE d.order_id = o.id AND d.status = 'failed' AND d.deleted_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.dispatches d
          WHERE d.order_id = o.id AND d.status = 'delivered' AND d.deleted_at IS NULL
        )
      ) AS failed
    INTO v_metrics
    FROM public.orders o
    WHERE o.operator_id = v_operator.id
      AND o.delivery_date = p_date
      AND o.deleted_at IS NULL;

    IF v_metrics.total > 0 THEN
      INSERT INTO public.performance_metrics (
        operator_id, metric_date, retailer_name,
        total_orders, delivered_orders, first_attempt_deliveries, failed_deliveries,
        shortage_claims_count, shortage_claims_amount_clp, avg_delivery_time_minutes
      ) VALUES (
        v_operator.id, p_date, NULL,
        v_metrics.total, v_metrics.delivered, v_metrics.first_attempt, v_metrics.failed,
        0, 0, NULL
      )
      ON CONFLICT (operator_id, metric_date, COALESCE(retailer_name, '__ALL__'))
      DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        delivered_orders = EXCLUDED.delivered_orders,
        first_attempt_deliveries = EXCLUDED.first_attempt_deliveries,
        failed_deliveries = EXCLUDED.failed_deliveries,
        shortage_claims_count = performance_metrics.shortage_claims_count,
        shortage_claims_amount_clp = performance_metrics.shortage_claims_amount_clp,
        avg_delivery_time_minutes = performance_metrics.avg_delivery_time_minutes,
        updated_at = NOW();
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.calculate_daily_metrics(DATE) IS 'Nightly cron target: aggregates orders + dispatches into performance_metrics via upsert. SECURITY DEFINER for pg_cron context.';

-- ============================================================================
-- PART 13: Migration Validation
-- ============================================================================

DO $$
BEGIN
  -- 1. Verify ENUMs
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'routing_provider_enum') THEN
    RAISE EXCEPTION 'ENUM routing_provider_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'route_status_enum') THEN
    RAISE EXCEPTION 'ENUM route_status_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispatch_status_enum') THEN
    RAISE EXCEPTION 'ENUM dispatch_status_enum not created!';
  END IF;

  -- 2. Verify tables exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'fleet_vehicles') THEN
    RAISE EXCEPTION 'Table public.fleet_vehicles not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'routes') THEN
    RAISE EXCEPTION 'Table public.routes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dispatches') THEN
    RAISE EXCEPTION 'Table public.dispatches not found!';
  END IF;

  -- 3. Verify delivery_attempts table is gone
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'delivery_attempts') THEN
    RAISE EXCEPTION 'Table delivery_attempts should have been dropped!';
  END IF;

  -- 4. Verify RLS enabled on all three tables
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'fleet_vehicles' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.fleet_vehicles!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'routes' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.routes!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'dispatches' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.dispatches!';
  END IF;

  -- 5. Verify key indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_routes_operator_id') THEN
    RAISE EXCEPTION 'Index idx_routes_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dispatches_operator_id') THEN
    RAISE EXCEPTION 'Index idx_dispatches_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_fleet_vehicles_operator_id') THEN
    RAISE EXCEPTION 'Index idx_fleet_vehicles_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_dispatches_order_id') THEN
    RAISE EXCEPTION 'Index idx_dispatches_order_id not found!';
  END IF;

  -- 6. Verify audit triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_fleet_vehicles_changes') THEN
    RAISE EXCEPTION 'Trigger audit_fleet_vehicles_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_routes_changes') THEN
    RAISE EXCEPTION 'Trigger audit_routes_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_dispatches_changes') THEN
    RAISE EXCEPTION 'Trigger audit_dispatches_changes not found!';
  END IF;

  -- 7. Verify RPCs exist (rewritten)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_failure_reasons') THEN
    RAISE EXCEPTION 'Function get_failure_reasons not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_daily_metrics') THEN
    RAISE EXCEPTION 'Function calculate_daily_metrics not found!';
  END IF;

  RAISE NOTICE '✓ Story 3B.1 migration validation complete';
  RAISE NOTICE '  ENUMs: routing_provider_enum, route_status_enum, dispatch_status_enum';
  RAISE NOTICE '  Tables: fleet_vehicles, routes, dispatches';
  RAISE NOTICE '  Dropped: delivery_attempts (data migrated to dispatches)';
  RAISE NOTICE '  RLS enabled on all 3 tables with tenant isolation policies';
  RAISE NOTICE '  Indexes: 13 standard';
  RAISE NOTICE '  Triggers: 3 audit + 3 set_updated_at';
  RAISE NOTICE '  RPCs rewritten: get_failure_reasons, calculate_daily_metrics';
END $$;
