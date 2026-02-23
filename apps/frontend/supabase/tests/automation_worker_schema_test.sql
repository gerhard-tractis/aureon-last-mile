-- Automation Worker Schema Test Suite
-- Story: 2.4 - Create Automation Worker Database Schema
-- Date: 2026-02-23
-- Purpose: Verify tenant_clients, jobs, raw_files tables and orders extensions exist with
--          correct structure, RLS, indexes, and seed data.

-- =============================================================================
-- TEST 1: ENUM types exist
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

-- =============================================================================
-- TEST 3-5: tenant_clients table structure
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
      RAISE EXCEPTION 'TEST 3 FAILED: tenant_clients.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 3 PASSED: tenant_clients has all required columns';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'tenant_clients' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 4 FAILED: RLS not enabled on tenant_clients';
  END IF;
  RAISE NOTICE 'TEST 4 PASSED: RLS enabled on tenant_clients';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'tenant_clients' AND indexname = 'idx_tenant_clients_operator_id'
  ) THEN
    RAISE EXCEPTION 'TEST 5 FAILED: idx_tenant_clients_operator_id not found';
  END IF;
  RAISE NOTICE 'TEST 5 PASSED: idx_tenant_clients_operator_id exists';
END $$;

-- =============================================================================
-- TEST 6-9: jobs table structure
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'client_id', 'job_type', 'status',
    'priority', 'scheduled_at', 'started_at', 'completed_at',
    'result', 'error_message', 'retry_count', 'max_retries', 'created_at'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'jobs' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 6 FAILED: jobs.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 6 PASSED: jobs has all required columns';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'jobs' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 7 FAILED: RLS not enabled on jobs';
  END IF;
  RAISE NOTICE 'TEST 7 PASSED: RLS enabled on jobs';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'jobs' AND indexname = 'idx_jobs_worker_poll'
  ) THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Partial index idx_jobs_worker_poll not found';
  END IF;
  RAISE NOTICE 'TEST 8 PASSED: idx_jobs_worker_poll partial index exists';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'jobs' AND indexname = 'idx_jobs_operator_id'
  ) THEN
    RAISE EXCEPTION 'TEST 9 FAILED: idx_jobs_operator_id not found';
  END IF;
  RAISE NOTICE 'TEST 9 PASSED: idx_jobs_operator_id exists';
END $$;

-- =============================================================================
-- TEST 10-12: raw_files table structure
-- =============================================================================

DO $$
DECLARE
  required_cols TEXT[] := ARRAY[
    'id', 'operator_id', 'client_id', 'job_id',
    'file_name', 'storage_path', 'file_size_bytes', 'row_count', 'received_at'
  ];
  col TEXT;
BEGIN
  FOREACH col IN ARRAY required_cols LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raw_files' AND column_name = col
    ) THEN
      RAISE EXCEPTION 'TEST 10 FAILED: raw_files.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 10 PASSED: raw_files has all required columns';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'raw_files' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'TEST 11 FAILED: RLS not enabled on raw_files';
  END IF;
  RAISE NOTICE 'TEST 11 PASSED: RLS enabled on raw_files';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE tablename = 'raw_files' AND indexname = 'idx_raw_files_job_id'
  ) THEN
    RAISE EXCEPTION 'TEST 12 FAILED: idx_raw_files_job_id not found';
  END IF;
  RAISE NOTICE 'TEST 12 PASSED: idx_raw_files_job_id exists';
END $$;

-- =============================================================================
-- TEST 13: orders table new columns exist
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
      RAISE EXCEPTION 'TEST 13 FAILED: orders.% column not found', col;
    END IF;
  END LOOP;
  RAISE NOTICE 'TEST 13 PASSED: orders has all 9 new automation worker columns';
END $$;

-- =============================================================================
-- TEST 14: orders.status default is 'pending'
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name = 'status'
    AND column_default LIKE '%pending%'
  ) THEN
    RAISE EXCEPTION 'TEST 14 FAILED: orders.status default is not ''pending''';
  END IF;
  RAISE NOTICE 'TEST 14 PASSED: orders.status default is pending';
END $$;

-- =============================================================================
-- TEST 15: Seed data — Transportes Musan + Easy + Paris
-- =============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Verify Musan operator
  IF NOT EXISTS (SELECT 1 FROM public.operators WHERE slug = 'transportes-musan') THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Transportes Musan operator (slug=transportes-musan) not found';
  END IF;

  -- Verify Easy + Paris tenant_clients
  SELECT COUNT(*) INTO v_count
  FROM public.tenant_clients tc
  JOIN public.operators o ON o.id = tc.operator_id
  WHERE o.slug = 'transportes-musan'
  AND tc.slug IN ('easy', 'paris');

  IF v_count < 2 THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Expected 2 Musan tenant_clients, found %', v_count;
  END IF;

  -- Verify connector types
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_clients tc
    JOIN public.operators o ON o.id = tc.operator_id
    WHERE o.slug = 'transportes-musan' AND tc.slug = 'easy' AND tc.connector_type = 'csv_email'
  ) THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Easy connector_type should be csv_email';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_clients tc
    JOIN public.operators o ON o.id = tc.operator_id
    WHERE o.slug = 'transportes-musan' AND tc.slug = 'paris' AND tc.connector_type = 'browser'
  ) THEN
    RAISE EXCEPTION 'TEST 15 FAILED: Paris connector_type should be browser';
  END IF;

  RAISE NOTICE 'TEST 15 PASSED: Seed data OK — Musan operator + Easy (csv_email) + Paris (browser)';
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '==========================================================';
  RAISE NOTICE 'Story 2.4 Test Suite: ALL 15 TESTS PASSED';
  RAISE NOTICE '  tenant_clients: columns, RLS, indexes';
  RAISE NOTICE '  jobs: columns, RLS, partial index (worker poll)';
  RAISE NOTICE '  raw_files: columns, RLS, indexes';
  RAISE NOTICE '  orders: 9 new columns, status default';
  RAISE NOTICE '  seed data: Musan + Easy + Paris';
  RAISE NOTICE '==========================================================';
END $$;
