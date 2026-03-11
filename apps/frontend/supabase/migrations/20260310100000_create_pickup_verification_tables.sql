-- Migration: Create Pickup Verification Tables (manifests, pickup_scans, discrepancy_notes)
-- Created: 2026-03-10
-- Story: 4.1 - Pickup Verification Schema
-- Epic: 4A - Pickup Verification (Core Scanning Flow)
-- Purpose: Tables for manifest tracking, barcode scan validation, and discrepancy documentation.
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators, users tables)
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql (audit_trigger_func)
--   - 20260217000003_create_orders_table.sql (orders table — external_load_id)
--   - 20260223000001_create_automation_worker_schema.sql (set_updated_at, packages table)

-- ============================================================================
-- PART 1: Create ENUM Types (idempotent)
-- ============================================================================

-- manifest_status_enum: Manifest lifecycle states
DO $$ BEGIN
  CREATE TYPE manifest_status_enum AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE manifest_status_enum IS 'Manifest lifecycle states for pickup verification (Story 4.1)';

-- scan_result_enum: Barcode scan outcome states
DO $$ BEGIN
  CREATE TYPE scan_result_enum AS ENUM ('verified', 'not_found', 'duplicate');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE scan_result_enum IS 'Barcode scan result states: verified match, not found in manifest, or duplicate scan (Story 4.1)';

-- ============================================================================
-- PART 2: Create manifests Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.manifests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id             UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  external_load_id        VARCHAR(100) NOT NULL,
  retailer_name           VARCHAR(50),
  pickup_location         TEXT,
  total_orders            INT,
  total_packages          INT,
  assigned_to_user_id     UUID REFERENCES public.users(id),
  status                  manifest_status_enum NOT NULL DEFAULT 'pending',
  signature_operator      TEXT,                -- URL to signature PNG in Supabase Storage
  signature_operator_name VARCHAR(255),
  signature_client        TEXT,                -- nullable
  signature_client_name   VARCHAR(255),        -- nullable
  started_at              TIMESTAMPTZ,
  completed_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  CONSTRAINT unique_manifest_per_operator UNIQUE (operator_id, external_load_id)
);

COMMENT ON TABLE  public.manifests IS 'Pickup verification manifests. Each manifest represents a load to be verified via barcode scanning.';
COMMENT ON COLUMN public.manifests.external_load_id IS 'Load identifier from orders table (e.g. "CARGA-001"). Links manifest to its orders.';
COMMENT ON COLUMN public.manifests.signature_operator IS 'URL to operator signature PNG stored in Supabase Storage';
COMMENT ON COLUMN public.manifests.signature_client IS 'URL to client/retailer signature PNG stored in Supabase Storage (optional)';

-- ============================================================================
-- PART 3: Create pickup_scans Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pickup_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id         UUID NOT NULL REFERENCES public.manifests(id),
  package_id          UUID REFERENCES public.packages(id),       -- nullable — null for 'not_found'
  barcode_scanned     VARCHAR(100) NOT NULL,
  scan_result         scan_result_enum NOT NULL,
  scanned_by_user_id  UUID REFERENCES public.users(id),
  scanned_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.pickup_scans IS 'Individual barcode scan records during pickup verification. Each scan validates a package against a manifest.';
COMMENT ON COLUMN public.pickup_scans.package_id IS 'Nullable — NULL when scan_result is not_found (barcode not in manifest)';
COMMENT ON COLUMN public.pickup_scans.barcode_scanned IS 'Raw barcode string as scanned by the device';

-- ============================================================================
-- PART 4: Create discrepancy_notes Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.discrepancy_notes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id         UUID NOT NULL REFERENCES public.manifests(id),
  package_id          UUID NOT NULL REFERENCES public.packages(id),
  note                TEXT NOT NULL,
  created_by_user_id  UUID REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.discrepancy_notes IS 'Free-text notes documenting discrepancies found during pickup verification.';
COMMENT ON COLUMN public.discrepancy_notes.package_id IS 'The package with a discrepancy (e.g. damaged, wrong quantity)';

-- ============================================================================
-- PART 5: Create Indexes
-- ============================================================================

-- Manifests
CREATE INDEX IF NOT EXISTS idx_manifests_operator_id ON public.manifests(operator_id);
CREATE INDEX IF NOT EXISTS idx_manifests_assigned_to_user_id ON public.manifests(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_manifests_operator_load ON public.manifests(operator_id, external_load_id);
CREATE INDEX IF NOT EXISTS idx_manifests_deleted_at ON public.manifests(deleted_at);

-- Pickup Scans
CREATE INDEX IF NOT EXISTS idx_pickup_scans_operator_id ON public.pickup_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_manifest_id ON public.pickup_scans(manifest_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_package_id ON public.pickup_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_scanned_by_user_id ON public.pickup_scans(scanned_by_user_id);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_manifest_barcode ON public.pickup_scans(manifest_id, barcode_scanned);
CREATE INDEX IF NOT EXISTS idx_pickup_scans_deleted_at ON public.pickup_scans(deleted_at);

-- Discrepancy Notes
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_operator_id ON public.discrepancy_notes(operator_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_manifest_id ON public.discrepancy_notes(manifest_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_package_id ON public.discrepancy_notes(package_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_created_by_user_id ON public.discrepancy_notes(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_discrepancy_notes_deleted_at ON public.discrepancy_notes(deleted_at);

-- ============================================================================
-- PART 6: Enable RLS + Create Tenant Isolation Policies
-- ============================================================================

-- manifests RLS
ALTER TABLE public.manifests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "manifests_tenant_isolation" ON public.manifests
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "manifests_tenant_select" ON public.manifests
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- pickup_scans RLS
ALTER TABLE public.pickup_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "pickup_scans_tenant_isolation" ON public.pickup_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "pickup_scans_tenant_select" ON public.pickup_scans
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- discrepancy_notes RLS
ALTER TABLE public.discrepancy_notes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "discrepancy_notes_tenant_isolation" ON public.discrepancy_notes
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "discrepancy_notes_tenant_select" ON public.discrepancy_notes
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 7: GRANT/REVOKE Permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manifests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pickup_scans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discrepancy_notes TO authenticated;
REVOKE ALL ON public.manifests FROM anon;
REVOKE ALL ON public.pickup_scans FROM anon;
REVOKE ALL ON public.discrepancy_notes FROM anon;

-- Service role needs full access for edge function operations
GRANT ALL ON public.manifests TO service_role;
GRANT ALL ON public.pickup_scans TO service_role;
GRANT ALL ON public.discrepancy_notes TO service_role;

-- ============================================================================
-- PART 8: Attach Audit Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER audit_manifests_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.manifests
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_pickup_scans_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.pickup_scans
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_discrepancy_notes_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.discrepancy_notes
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 9: Attach set_updated_at Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_manifests_updated_at
    BEFORE UPDATE ON public.manifests
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_pickup_scans_updated_at
    BEFORE UPDATE ON public.pickup_scans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_discrepancy_notes_updated_at
    BEFORE UPDATE ON public.discrepancy_notes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 10: Migration Validation
-- ============================================================================

DO $$
BEGIN
  -- 1. Verify ENUMs
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'manifest_status_enum') THEN
    RAISE EXCEPTION 'ENUM manifest_status_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scan_result_enum') THEN
    RAISE EXCEPTION 'ENUM scan_result_enum not created!';
  END IF;

  -- 2. Verify tables exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'manifests') THEN
    RAISE EXCEPTION 'Table public.manifests not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pickup_scans') THEN
    RAISE EXCEPTION 'Table public.pickup_scans not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'discrepancy_notes') THEN
    RAISE EXCEPTION 'Table public.discrepancy_notes not found!';
  END IF;

  -- 3. Verify RLS enabled on all three tables
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'manifests' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.manifests!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'pickup_scans' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.pickup_scans!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'discrepancy_notes' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.discrepancy_notes!';
  END IF;

  -- 4. Verify key indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_manifests_operator_id') THEN
    RAISE EXCEPTION 'Index idx_manifests_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pickup_scans_operator_id') THEN
    RAISE EXCEPTION 'Index idx_pickup_scans_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_pickup_scans_manifest_barcode') THEN
    RAISE EXCEPTION 'Index idx_pickup_scans_manifest_barcode not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_discrepancy_notes_operator_id') THEN
    RAISE EXCEPTION 'Index idx_discrepancy_notes_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_discrepancy_notes_manifest_id') THEN
    RAISE EXCEPTION 'Index idx_discrepancy_notes_manifest_id not found!';
  END IF;

  -- 5. Verify audit triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_manifests_changes') THEN
    RAISE EXCEPTION 'Trigger audit_manifests_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_pickup_scans_changes') THEN
    RAISE EXCEPTION 'Trigger audit_pickup_scans_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_discrepancy_notes_changes') THEN
    RAISE EXCEPTION 'Trigger audit_discrepancy_notes_changes not found!';
  END IF;

  -- 6. Verify set_updated_at triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_manifests_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_manifests_updated_at not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_pickup_scans_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_pickup_scans_updated_at not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_discrepancy_notes_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_discrepancy_notes_updated_at not found!';
  END IF;

  RAISE NOTICE '✓ Story 4.1 migration validation complete';
  RAISE NOTICE '  ENUMs: manifest_status_enum, scan_result_enum';
  RAISE NOTICE '  Tables: manifests, pickup_scans, discrepancy_notes';
  RAISE NOTICE '  RLS enabled on all 3 tables with tenant isolation policies';
  RAISE NOTICE '  Indexes: 15 standard';
  RAISE NOTICE '  Triggers: 3 audit + 3 set_updated_at';
END $$;
