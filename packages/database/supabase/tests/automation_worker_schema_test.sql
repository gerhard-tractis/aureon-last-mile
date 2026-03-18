-- Automation Worker Schema Test Suite
-- Story: 2.4 - Create Automation Worker Database Schema
-- Date: 2026-02-23
-- Purpose: Verify tenant_clients, jobs, raw_files tables and orders extensions exist with
--          correct structure, RLS, indexes, constraints, FKs, triggers, and seed data.
-- Review fixes: Added tests for constraints (M3), updated_at triggers (H1), jobs.updated_at (M2),
--               raw_files.created_at (M1), raw_files.file_size_bytes BIGINT (M4), order_status_enum (H3)

-- =============================================================================
-- TEST 1-3: ENUM types exist (including order_status_enum from H3 fix)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type_enum') THEN
    RAISE EXCEPTION 'TEST 1 FAILED: ENUM connector_type_enum not found';
  END IF;
  RAISE NOTICE 'TEST 1 PASSED: connector_type_enum ENUM exists';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status_enum') THEN
    RAISE EXCEPTION 'TEST 2 FAILED: ENUM job_status_enum not found';
  END IF;
  RAISE NOTICE 'TEST 2 PASSED: job_status_enum ENUM exists';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status_enum') THEN
    RAISE EXCEPTION 'TEST 3 FAILED: ENUM order_status_enum not found';
  END IF;
  RAISE NOTICE 'TEST 3 PASSED: order_status_enum ENUM exists';
END $$;

-- =============================================================================
-- TEST 4-6: tenant_clients table structure
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'name', 'slug', 'connector_type',
    'connector_config', 'is_active', 'created_at', 'updated_at'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenant_clients' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 4 FAILED: tenant_clients.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 4 PASSED: tenant_clients has all required columns';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'tenant_clients' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 5 FAILED: RLS not enabled on tenant_clients';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: RLS enabled on tenant_clients';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'tenant_clients' AND indexname = 'idx_tenant_clients_operator_id'
  ) THEN
    RAISE EXCEPTION 'TEST 6 FAILED: idx_tenant_clients_operator_id not found';
  END IF;
  RAISE NOTICE 'TEST 6 PASSED: idx_tenant_clients_operator_id exists';
END $$;

-- =============================================================================
-- TEST 7: tenant_clients UNIQUE constraint on (operator_id, slug) (FIX M3)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'unique_client_slug_per_operator'
    AND contype = 'u'
  ) THEN
    RAISE EXCEPTION 'TEST 7 FAILED: UNIQUE constraint unique_client_slug_per_operator not found';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: UNIQUE constraint (operator_id, slug) exists on tenant_clients';
END $$;

-- =============================================================================
-- TEST 8-11: jobs table structure
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'client_id', 'job_type', 'status',
    'priority', 'scheduled_at', 'started_at', 'completed_at',
    'result', 'error_message', 'retry_count', 'max_retries', 'created_at', 'updated_at'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 8 FAILED: jobs.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 8 PASSED: jobs has all required columns (including updated_at)';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'jobs' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 9 FAILED: RLS not enabled on jobs';
  END IF;
  RAISE NOTICE 'TEST 9 PASSED: RLS enabled on jobs';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'jobs' AND indexname = 'idx_jobs_worker_poll'
  ) THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Partial index idx_jobs_worker_poll not found';
  END IF;
  RAISE NOTICE 'TEST 10 PASSED: idx_jobs_worker_poll partial index exists';
END $$;

-- =============================================================================
-- TEST 11: jobs FK to tenant_clients (FIX M3)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'jobs'
    AND c.contype = 'f'
    AND c.conname LIKE '%client_id%'
  ) THEN
    RAISE EXCEPTION 'TEST 11 FAILED: FK jobs.client_id → tenant_clients not found';
  END IF;
  RAISE NOTICE 'TEST 11 PASSED: FK jobs.client_id → tenant_clients exists';
END $$;

-- =============================================================================
-- TEST 12-14: raw_files table structure
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'client_id', 'job_id',
    'file_name', 'storage_path', 'file_size_bytes', 'row_count', 'received_at', 'created_at'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_files' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 12 FAILED: raw_files.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 12 PASSED: raw_files has all required columns (including created_at)';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'raw_files' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 13 FAILED: RLS not enabled on raw_files';
  END IF;
  RAISE NOTICE 'TEST 13 PASSED: RLS enabled on raw_files';
END $$;

-- =============================================================================
-- TEST 14: raw_files FK to jobs (FIX M3)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'raw_files'
    AND c.contype = 'f'
    AND c.conname LIKE '%job_id%'
  ) THEN
    RAISE EXCEPTION 'TEST 14 FAILED: FK raw_files.job_id → jobs not found';
  END IF;
  RAISE NOTICE 'TEST 14 PASSED: FK raw_files.job_id → jobs exists';
END $$;

-- =============================================================================
-- TEST 15: raw_files.file_size_bytes is BIGINT (FIX M4)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'raw_files'
    AND column_name = 'file_size_bytes'
    AND data_type = 'bigint'
  ) THEN
    RAISE EXCEPTION 'TEST 15 FAILED: raw_files.file_size_bytes is not BIGINT';
  END IF;
  RAISE NOTICE 'TEST 15 PASSED: raw_files.file_size_bytes is BIGINT';
END $$;

-- =============================================================================
-- TEST 16: orders table new columns exist
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'external_load_id', 'recipient_region', 'service_type',
    'total_weight_kg', 'total_volume_m3', 'status',
    'status_detail', 'source_file', 'tenant_client_id'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 16 FAILED: orders.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 16 PASSED: orders has all 9 new automation worker columns';
END $$;

-- =============================================================================
-- TEST 17: orders.tenant_client_id FK (FIX M3)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'orders'
    AND c.contype = 'f'
    AND c.conname LIKE '%tenant_client%'
  ) THEN
    RAISE EXCEPTION 'TEST 17 FAILED: FK orders.tenant_client_id → tenant_clients not found';
  END IF;
  RAISE NOTICE 'TEST 17 PASSED: FK orders.tenant_client_id → tenant_clients exists';
END $$;

-- =============================================================================
-- TEST 18: set_updated_at triggers exist (FIX H1)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_tenant_clients_updated_at') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: set_tenant_clients_updated_at trigger not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_jobs_updated_at') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: set_jobs_updated_at trigger not found';
  END IF;
  RAISE NOTICE 'TEST 18 PASSED: updated_at auto-update triggers exist on tenant_clients and jobs';
END $$;

-- =============================================================================
-- TEST 19: set_updated_at() function exists (FIX H1)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_updated_at'
  ) THEN
    RAISE EXCEPTION 'TEST 19 FAILED: public.set_updated_at() function not found';
  END IF;
  RAISE NOTICE 'TEST 19 PASSED: public.set_updated_at() trigger function exists';
END $$;

-- =============================================================================
-- TEST 20: Seed data — Transportes Musan + Easy + Paris
-- =============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Verify Musan operator
  IF NOT EXISTS (SELECT 1 FROM public.operators WHERE slug = 'transportes-musan') THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Transportes Musan operator (slug=transportes-musan) not found';
  END IF;

  -- Verify Easy + Paris tenant_clients
  SELECT COUNT(*) INTO v_count
  FROM public.tenant_clients tc
  JOIN public.operators o ON o.id = tc.operator_id
  WHERE o.slug = 'transportes-musan'
  AND tc.slug IN ('easy', 'paris');

  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Expected 2 Musan tenant_clients, found %', v_count;
  END IF;

  -- Verify connector types
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_clients tc
    JOIN public.operators o ON o.id = tc.operator_id
    WHERE o.slug = 'transportes-musan' AND tc.slug = 'easy' AND tc.connector_type = 'csv_email'
  ) THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Easy connector_type should be csv_email';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_clients tc
    JOIN public.operators o ON o.id = tc.operator_id
    WHERE o.slug = 'transportes-musan' AND tc.slug = 'paris' AND tc.connector_type = 'browser'
  ) THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Paris connector_type should be browser';
  END IF;

  RAISE NOTICE 'TEST 20 PASSED: Seed data OK — Musan operator + Easy (csv_email) + Paris (browser)';
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '==========================================================';
  RAISE NOTICE 'Story 2.4 Test Suite: ALL 20 TESTS PASSED';
  RAISE NOTICE '  ENUMs: connector_type, job_status, order_status (3)';
  RAISE NOTICE '  tenant_clients: columns, RLS, indexes, UNIQUE constraint (4)';
  RAISE NOTICE '  jobs: columns, RLS, partial index, FK to tenant_clients (4)';
  RAISE NOTICE '  raw_files: columns, RLS, FK to jobs, BIGINT file_size (4)';
  RAISE NOTICE '  orders: 9 new columns, FK to tenant_clients (2)';
  RAISE NOTICE '  triggers: set_updated_at function + 2 triggers (2)';
  RAISE NOTICE '  seed data: Musan + Easy + Paris (1)';
  RAISE NOTICE '==========================================================';
END $$;
