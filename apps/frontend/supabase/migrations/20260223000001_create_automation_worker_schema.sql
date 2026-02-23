-- Migration: Create Automation Worker Database Schema
-- Created: 2026-02-23
-- Story: 2.4 - Create Automation Worker Database Schema
-- Epic: 2 - Order Data Ingestion & Automation Worker
-- Purpose: Create tenant_clients, jobs, raw_files tables for connector framework and job queue.
--          Extend orders table with automation worker columns.
--          Seed Transportes Musan operator + Easy/Paris tenant_clients.
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators table)
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql (audit_trigger_func)
--   - 20260217000003_create_orders_table.sql (orders table)

-- ============================================================================
-- PART 1: Create ENUM Types (idempotent)
-- ============================================================================

-- connector_type_enum: Connector framework types
DO $$ BEGIN
  CREATE TYPE connector_type_enum AS ENUM (
    'csv_email',  -- Email-based CSV manifest ingestion (e.g., Easy/Cencosud)
    'api',        -- REST API integration
    'browser'     -- Browser automation / scraping (e.g., Paris/Beetrack)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE connector_type_enum IS 'Automation worker connector type for Story 2.4-2.6 ingestion framework';

-- job_status_enum: Job queue lifecycle states
DO $$ BEGIN
  CREATE TYPE job_status_enum AS ENUM (
    'pending',    -- Waiting to be picked up by worker
    'running',    -- Currently being processed
    'completed',  -- Successfully finished
    'failed',     -- Terminal failure (retry_count >= max_retries)
    'retrying'    -- Scheduled for retry after transient failure
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE job_status_enum IS 'Job queue status lifecycle for Story 2.4-2.7 orchestration';

-- ============================================================================
-- PART 2: Create tenant_clients Table
-- ============================================================================
-- Represents a client/retailer configured for a specific operator (tenant).
-- Each client has a connector type and encrypted connector_config.

CREATE TABLE IF NOT EXISTS public.tenant_clients (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id    UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  name           VARCHAR(255) NOT NULL,
  slug           VARCHAR(100) NOT NULL,
  connector_type connector_type_enum NOT NULL,
  -- Stores connector-specific config (credentials use ENCRYPTED: prefix, decrypted by worker at runtime)
  -- Example csv_email: {"email_filter": {...}, "csv_encoding": "latin-1", "column_map": {...}}
  -- Example browser:   {"beetrack_url": "...", "username": "ENCRYPTED:...", "password": "ENCRYPTED:..."}
  connector_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_client_slug_per_operator UNIQUE (operator_id, slug)
);

COMMENT ON TABLE  public.tenant_clients IS 'Retailer/client connector configurations per operator (tenant). One row per client/retailer.';
COMMENT ON COLUMN public.tenant_clients.operator_id      IS 'Tenant identifier for multi-tenant isolation';
COMMENT ON COLUMN public.tenant_clients.slug             IS 'URL-safe identifier unique within operator (e.g., "easy", "paris")';
COMMENT ON COLUMN public.tenant_clients.connector_type   IS 'Ingestion method: csv_email (Story 2.5), browser (Story 2.6), api (future)';
COMMENT ON COLUMN public.tenant_clients.connector_config IS 'JSONB connector settings. Credential fields prefixed with ENCRYPTED: — decrypted by worker using VPS env key at runtime. Never decrypted in DB.';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_clients_operator_id ON public.tenant_clients(operator_id);
CREATE INDEX IF NOT EXISTS idx_tenant_clients_connector_type ON public.tenant_clients(connector_type);

-- RLS
ALTER TABLE public.tenant_clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_clients_tenant_isolation" ON public.tenant_clients
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "tenant_clients_tenant_select" ON public.tenant_clients
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_clients TO authenticated;
REVOKE ALL ON public.tenant_clients FROM anon;

-- Audit trigger
CREATE TRIGGER audit_tenant_clients_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.tenant_clients
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMENT ON TRIGGER audit_tenant_clients_changes ON public.tenant_clients IS 'Audit trigger: Logs all tenant_clients changes to audit_logs table';

-- ============================================================================
-- PART 3: Create jobs Table
-- ============================================================================
-- Job queue for automation worker task orchestration and tracking.

CREATE TABLE IF NOT EXISTS public.jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id   UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.tenant_clients(id) ON DELETE CASCADE,
  job_type      connector_type_enum NOT NULL,
  status        job_status_enum NOT NULL DEFAULT 'pending',
  priority      INT NOT NULL DEFAULT 5,  -- Higher = more urgent. Worker polls ORDER BY priority DESC, scheduled_at ASC
  scheduled_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMP WITH TIME ZONE,
  completed_at  TIMESTAMP WITH TIME ZONE,
  result        JSONB,         -- Output data on success (e.g., {rows_processed: 142, orders_upserted: 140})
  error_message TEXT,          -- Human-readable error on failure
  retry_count   INT NOT NULL DEFAULT 0,
  max_retries   INT NOT NULL DEFAULT 3,
  created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.jobs IS 'Job queue for automation worker. Each row = one ingestion run (email parse, browser scrape, API call).';
COMMENT ON COLUMN public.jobs.priority      IS 'Worker poll priority (higher = more urgent). Default 5. Use 10 for critical reruns.';
COMMENT ON COLUMN public.jobs.status        IS 'Lifecycle: pending→running→completed|failed|retrying. Terminal: completed, failed (retry_count >= max_retries).';
COMMENT ON COLUMN public.jobs.result        IS 'Success payload e.g. {rows_processed: 142, orders_upserted: 140, errors: []}';
COMMENT ON COLUMN public.jobs.error_message IS 'Last error message. Preserved across retries for debugging.';
COMMENT ON COLUMN public.jobs.retry_count   IS 'Number of attempts made. Worker increments on each retry.';

-- Partial index for efficient worker polling: only pending/retrying jobs
-- Worker query: SELECT * FROM jobs WHERE status IN ('pending','retrying') ORDER BY priority DESC, scheduled_at ASC LIMIT 1
CREATE INDEX IF NOT EXISTS idx_jobs_worker_poll
  ON public.jobs(status, priority DESC, scheduled_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_jobs_operator_id ON public.jobs(operator_id);
CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON public.jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);

-- RLS
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_tenant_isolation" ON public.jobs
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "jobs_tenant_select" ON public.jobs
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.jobs TO authenticated;
REVOKE ALL ON public.jobs FROM anon;

-- Audit trigger
CREATE TRIGGER audit_jobs_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMENT ON TRIGGER audit_jobs_changes ON public.jobs IS 'Audit trigger: Logs all jobs changes to audit_logs table';

-- ============================================================================
-- PART 4: Create raw_files Table
-- ============================================================================
-- Tracks raw file metadata for every file ingested by the automation worker.
-- Actual files stored in Supabase Storage bucket `raw-files` (created in Story 2.3).

CREATE TABLE IF NOT EXISTS public.raw_files (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id      UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES public.tenant_clients(id) ON DELETE CASCADE,
  job_id           UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  file_name        VARCHAR(500) NOT NULL,
  -- Storage path pattern: raw-files/{operator_slug}/{client_slug}/{date}/{filename}
  storage_path     VARCHAR(1000) NOT NULL,
  file_size_bytes  INT,
  row_count        INT,
  received_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.raw_files IS 'Metadata for raw ingested files. Actual files in Supabase Storage bucket raw-files.';
COMMENT ON COLUMN public.raw_files.storage_path IS 'Supabase Storage path: raw-files/{operator_slug}/{client_slug}/{YYYY-MM-DD}/{filename}';
COMMENT ON COLUMN public.raw_files.row_count    IS 'Number of data rows in file (NULL for binary files or before parsing)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_raw_files_operator_id ON public.raw_files(operator_id);
CREATE INDEX IF NOT EXISTS idx_raw_files_client_id ON public.raw_files(client_id);
CREATE INDEX IF NOT EXISTS idx_raw_files_job_id ON public.raw_files(job_id);

-- RLS
ALTER TABLE public.raw_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "raw_files_tenant_isolation" ON public.raw_files
  FOR ALL
  USING (operator_id = public.get_operator_id())
  WITH CHECK (operator_id = public.get_operator_id());

CREATE POLICY "raw_files_tenant_select" ON public.raw_files
  FOR SELECT
  USING (operator_id = public.get_operator_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.raw_files TO authenticated;
REVOKE ALL ON public.raw_files FROM anon;

-- Audit trigger
CREATE TRIGGER audit_raw_files_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.raw_files
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

COMMENT ON TRIGGER audit_raw_files_changes ON public.raw_files IS 'Audit trigger: Logs all raw_files changes to audit_logs table';

-- ============================================================================
-- PART 5: Extend orders Table with Automation Worker Columns
-- ============================================================================
-- Uses ADD COLUMN IF NOT EXISTS for safe idempotent migration.

-- Retailer's internal load/manifest identifier (e.g., Easy load number "CARGA-00123")
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_load_id VARCHAR(100);
COMMENT ON COLUMN public.orders.external_load_id IS 'Retailer internal load/manifest ID (e.g., Easy CARGA number). Nullable.';

-- Delivery region for routing (e.g., "RM Norte", "Valparaíso")
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS recipient_region VARCHAR(100);
COMMENT ON COLUMN public.orders.recipient_region IS 'Geographic delivery region for routing (populated by connectors).';

-- Service type from retailer SLA (e.g., "STANDARD", "EXPRESS", "SAME_DAY")
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS service_type VARCHAR(50);
COMMENT ON COLUMN public.orders.service_type IS 'Retailer service level (STANDARD, EXPRESS, SAME_DAY). From connector_config column_map.';

-- Weight from manifest (may differ from verified weight in packages table)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_weight_kg DECIMAL(10,3);
COMMENT ON COLUMN public.orders.total_weight_kg IS 'Retailer-declared total order weight in kg (from manifest, may be inaccurate).';

-- Volume from manifest
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS total_volume_m3 DECIMAL(10,6);
COMMENT ON COLUMN public.orders.total_volume_m3 IS 'Retailer-declared total order volume in m³ (from manifest, may be inaccurate).';

-- Order processing status (separate from delivery status in packages)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'pending';
COMMENT ON COLUMN public.orders.status IS 'Order processing status: pending (imported), processing (being dispatched), dispatched, delivered, failed. Managed by worker+app.';

-- Human-readable detail for current status
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status_detail VARCHAR(255);
COMMENT ON COLUMN public.orders.status_detail IS 'Status detail message (e.g., "Assigned to route #42", "Failed: address not found").';

-- Source filename that originated this order (for traceability)
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS source_file VARCHAR(500);
COMMENT ON COLUMN public.orders.source_file IS 'Original source filename (e.g., "manifiesto_easy_2026-02-23_1200.csv"). Links order to raw_files table.';

-- FK to tenant_client that sourced this order
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tenant_client_id UUID REFERENCES public.tenant_clients(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.orders.tenant_client_id IS 'FK to tenant_clients: which retailer/connector sourced this order. NULL for manual/CSV upload orders.';

-- Index for efficient queries by client
CREATE INDEX IF NOT EXISTS idx_orders_tenant_client_id ON public.orders(tenant_client_id)
  WHERE tenant_client_id IS NOT NULL;

-- ============================================================================
-- PART 6: Seed Data — Transportes Musan Operator + Easy/Paris Clients
-- ============================================================================
-- Seeds the first real-world tenant for Story 2.5 (Easy) and Story 2.6 (Paris/Beetrack).
-- All credential values use ENCRYPTED: prefix — actual secrets set by DevOps on VPS env.

DO $$
DECLARE
  v_musan_operator_id UUID;
BEGIN
  -- Step 1: Ensure Transportes Musan operator exists
  -- In production, this operator was created during onboarding (Story 1.3/1.4).
  -- This seed uses INSERT ... ON CONFLICT to be safe in all environments.
  INSERT INTO public.operators (name, slug)
  VALUES ('Transportes Musan', 'transportes-musan')
  ON CONFLICT (slug) DO NOTHING;

  -- Get the operator_id (either just inserted or pre-existing)
  SELECT id INTO v_musan_operator_id
  FROM public.operators
  WHERE slug = 'transportes-musan';

  IF v_musan_operator_id IS NULL THEN
    RAISE EXCEPTION 'Seed failed: Could not find or create Transportes Musan operator';
  END IF;

  -- Step 2: Easy/Cencosud — csv_email connector
  INSERT INTO public.tenant_clients (operator_id, name, slug, connector_type, connector_config)
  VALUES (
    v_musan_operator_id,
    'Easy (Cencosud)',
    'easy',
    'csv_email',
    '{
      "email_filter": {
        "from": "ENCRYPTED:easy_sender_email",
        "subject_contains": "Manifiesto"
      },
      "csv_encoding": "latin-1",
      "csv_delimiter": ";",
      "imap_host": "ENCRYPTED:easy_imap_host",
      "imap_user": "ENCRYPTED:easy_imap_user",
      "imap_password": "ENCRYPTED:easy_imap_password",
      "column_map": {
        "order_number":      "N° CARGA",
        "customer_name":     "NOMBRE CLIENTE",
        "customer_phone":    "TELEFONO",
        "delivery_address":  "DIRECCION ENTREGA",
        "comuna":            "COMUNA",
        "delivery_date":     "FECHA ENTREGA",
        "external_load_id":  "N° CARGA",
        "service_type":      "TIPO SERVICIO",
        "total_weight_kg":   "PESO KG"
      }
    }'::jsonb
  )
  ON CONFLICT (operator_id, slug) DO NOTHING;

  -- Step 3: Paris/Beetrack — browser connector
  INSERT INTO public.tenant_clients (operator_id, name, slug, connector_type, connector_config)
  VALUES (
    v_musan_operator_id,
    'Paris (Beetrack)',
    'paris',
    'browser',
    '{
      "beetrack_url": "https://www.beetrack.com/",
      "username": "ENCRYPTED:paris_beetrack_username",
      "password": "ENCRYPTED:paris_beetrack_password",
      "tenant_id": "ENCRYPTED:paris_beetrack_tenant_id",
      "export_format": "csv",
      "scrape_interval_minutes": 60
    }'::jsonb
  )
  ON CONFLICT (operator_id, slug) DO NOTHING;

  RAISE NOTICE '✓ Seed complete: Transportes Musan (id: %) + Easy + Paris tenant_clients', v_musan_operator_id;
END $$;

-- ============================================================================
-- PART 7: Migration Validation
-- ============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  -- 1. Verify ENUM types exist
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connector_type_enum') THEN
    RAISE EXCEPTION 'ENUM connector_type_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status_enum') THEN
    RAISE EXCEPTION 'ENUM job_status_enum not created!';
  END IF;

  -- 2. Verify tenant_clients table + RLS
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'tenant_clients') THEN
    RAISE EXCEPTION 'Table public.tenant_clients not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'tenant_clients' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.tenant_clients!';
  END IF;

  -- 3. Verify jobs table + RLS + partial index
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'jobs') THEN
    RAISE EXCEPTION 'Table public.jobs not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'jobs' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.jobs!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'jobs' AND indexname = 'idx_jobs_worker_poll') THEN
    RAISE EXCEPTION 'Partial index idx_jobs_worker_poll not found!';
  END IF;

  -- 4. Verify raw_files table + RLS
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'raw_files') THEN
    RAISE EXCEPTION 'Table public.raw_files not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'raw_files' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.raw_files!';
  END IF;

  -- 5. Verify orders new columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'status') THEN
    RAISE EXCEPTION 'Column orders.status not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'tenant_client_id') THEN
    RAISE EXCEPTION 'Column orders.tenant_client_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'external_load_id') THEN
    RAISE EXCEPTION 'Column orders.external_load_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'source_file') THEN
    RAISE EXCEPTION 'Column orders.source_file not found!';
  END IF;

  -- 6. Verify seed data
  IF NOT EXISTS (SELECT 1 FROM public.operators WHERE slug = 'transportes-musan') THEN
    RAISE EXCEPTION 'Seed data missing: Transportes Musan operator not found!';
  END IF;
  SELECT COUNT(*) INTO v_count
  FROM public.tenant_clients tc
  JOIN public.operators o ON o.id = tc.operator_id
  WHERE o.slug = 'transportes-musan' AND tc.slug IN ('easy', 'paris');
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Seed data missing: Expected 2 Musan tenant_clients (easy + paris), found %', v_count;
  END IF;

  RAISE NOTICE '✓ Story 2.4 migration validation complete';
  RAISE NOTICE '  Tables created: tenant_clients, jobs, raw_files';
  RAISE NOTICE '  RLS enabled on all 3 new tables';
  RAISE NOTICE '  orders extended with 9 new columns';
  RAISE NOTICE '  Seed data: Transportes Musan + Easy (csv_email) + Paris (browser)';
  RAISE NOTICE '  Ready for Stories 2.5 (Easy connector) and 2.6 (Paris/Beetrack connector)';
END $$;
