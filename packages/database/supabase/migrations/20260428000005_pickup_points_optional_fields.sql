-- ============================================================================
-- Migration: drop NOT NULL on pickup_points.name, code, tenant_client_id
-- Purpose:   Operators want to save partial pickup-point records as they
--            collect data — name, code, and parent client are no longer
--            required at insert time. The unique (operator_id, code) constraint
--            still applies, but PostgreSQL treats NULLs as distinct so multiple
--            pickup points without a code can coexist.
-- ============================================================================

ALTER TABLE public.pickup_points
  ALTER COLUMN name             DROP NOT NULL,
  ALTER COLUMN code             DROP NOT NULL,
  ALTER COLUMN tenant_client_id DROP NOT NULL;

-- Validation
DO $$
BEGIN
  IF (
    SELECT is_nullable
    FROM   information_schema.columns
    WHERE  table_schema = 'public' AND table_name = 'pickup_points' AND column_name = 'name'
  ) <> 'YES' THEN
    RAISE EXCEPTION 'pickup_points.name is still NOT NULL';
  END IF;
  IF (
    SELECT is_nullable
    FROM   information_schema.columns
    WHERE  table_schema = 'public' AND table_name = 'pickup_points' AND column_name = 'code'
  ) <> 'YES' THEN
    RAISE EXCEPTION 'pickup_points.code is still NOT NULL';
  END IF;
  IF (
    SELECT is_nullable
    FROM   information_schema.columns
    WHERE  table_schema = 'public' AND table_name = 'pickup_points' AND column_name = 'tenant_client_id'
  ) <> 'YES' THEN
    RAISE EXCEPTION 'pickup_points.tenant_client_id is still NOT NULL';
  END IF;
  RAISE NOTICE '✓ pickup_points.name, code, tenant_client_id are now nullable';
END $$;
