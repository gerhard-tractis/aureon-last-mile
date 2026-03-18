-- Migration: Create Hub Reception & Chain of Custody Tables
-- Created: 2026-03-18
-- Story: R.1 - Hub Reception Schema
-- Spec: spec-08-hub-reception-design
-- Purpose: Tables for hub reception scanning, package handoff tracking, and chain of custody.
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260216170542_create_users_table_with_rbac.sql (operators, users tables)
--   - 20260217000001_enhance_audit_logging_with_triggers_and_partitioning.sql (audit_trigger_func)
--   - 20260217000003_create_orders_table.sql (orders, packages tables)
--   - 20260310100000_create_pickup_verification_tables.sql (manifests table)
--   - 20260310100001_add_permissions_to_users.sql (permissions column)

-- ============================================================================
-- PART 0: Add status, status_updated_at, updated_at to packages (prereq R.0)
-- ============================================================================
-- These columns are needed for package status tracking (verificado → en_bodega).
-- The packages table was created without them; this adds them idempotently.

DO $$ BEGIN
  CREATE TYPE package_status_enum AS ENUM (
    'ingresado', 'verificado', 'en_bodega', 'asignado',
    'en_carga', 'listo', 'en_ruta', 'entregado',
    'cancelado', 'devuelto', 'dañado', 'extraviado'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE package_status_enum IS 'Package lifecycle states for chain of custody tracking';

ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS status package_status_enum NOT NULL DEFAULT 'ingresado';
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;
ALTER TABLE public.packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_packages_operator_status ON public.packages(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_packages_order_status ON public.packages(order_id, status);

-- set_updated_at trigger for packages (if not already present)
DO $$ BEGIN
  CREATE TRIGGER set_packages_updated_at
    BEFORE UPDATE ON public.packages
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 1: Create ENUM Types
-- ============================================================================

-- hub_reception_status_enum: Hub reception lifecycle states
DO $$ BEGIN
  CREATE TYPE hub_reception_status_enum AS ENUM ('pending', 'in_progress', 'completed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE hub_reception_status_enum IS 'Hub reception lifecycle states (Story R.1)';

-- reception_scan_result_enum: Reception barcode scan outcome states
DO $$ BEGIN
  CREATE TYPE reception_scan_result_enum AS ENUM ('received', 'not_found', 'duplicate');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE reception_scan_result_enum IS 'Reception scan result states: received at hub, not found in manifest, or duplicate scan (Story R.1)';

-- reception_status_enum: Manifest reception lifecycle (on manifests table)
DO $$ BEGIN
  CREATE TYPE reception_status_enum AS ENUM ('awaiting_reception', 'reception_in_progress', 'received');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE reception_status_enum IS 'Manifest reception lifecycle: tracks reception status separately from hub_receptions row (Story R.1)';

-- ============================================================================
-- PART 2: Extend manifests table with reception_status column
-- ============================================================================

ALTER TABLE public.manifests ADD COLUMN IF NOT EXISTS reception_status reception_status_enum;

COMMENT ON COLUMN public.manifests.reception_status IS 'Reception lifecycle status. Set to awaiting_reception when manifest status becomes completed.';

CREATE INDEX IF NOT EXISTS idx_manifests_reception_status ON public.manifests(operator_id, reception_status);

-- ============================================================================
-- PART 3: Create hub_receptions Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_receptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id         UUID NOT NULL REFERENCES public.manifests(id),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  received_by         UUID REFERENCES public.users(id),
  delivered_by        UUID REFERENCES public.users(id),
  status              hub_reception_status_enum NOT NULL DEFAULT 'pending',
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  expected_count      INT NOT NULL DEFAULT 0,
  received_count      INT NOT NULL DEFAULT 0,
  discrepancy_notes   TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.hub_receptions IS 'Hub reception records tracking package handoff from driver to warehouse receiver.';
COMMENT ON COLUMN public.hub_receptions.manifest_id IS 'The manifest being received at the hub';
COMMENT ON COLUMN public.hub_receptions.received_by IS 'Hub receiver (warehouse staff)';
COMMENT ON COLUMN public.hub_receptions.delivered_by IS 'Driver who handed off the packages';
COMMENT ON COLUMN public.hub_receptions.expected_count IS 'Count of verificado packages in the manifest';
COMMENT ON COLUMN public.hub_receptions.received_count IS 'Number of packages scanned/received at hub';
COMMENT ON COLUMN public.hub_receptions.discrepancy_notes IS 'Notes about in-transit loss or missing packages';

-- ============================================================================
-- PART 4: Create reception_scans Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reception_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reception_id        UUID NOT NULL REFERENCES public.hub_receptions(id),
  package_id          UUID REFERENCES public.packages(id),
  operator_id         UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  scanned_by          UUID REFERENCES public.users(id),
  barcode             TEXT NOT NULL,
  scan_result         reception_scan_result_enum NOT NULL,
  scanned_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ
);

COMMENT ON TABLE  public.reception_scans IS 'Individual barcode scan records during hub reception. Each scan validates a package at the hub.';
COMMENT ON COLUMN public.reception_scans.reception_id IS 'The hub reception session this scan belongs to';
COMMENT ON COLUMN public.reception_scans.package_id IS 'Nullable — NULL when scan_result is not_found (barcode not in manifest)';
COMMENT ON COLUMN public.reception_scans.barcode IS 'Raw barcode string as scanned by the device';

-- ============================================================================
-- PART 5: Create Indexes
-- ============================================================================

-- hub_receptions
CREATE INDEX IF NOT EXISTS idx_hub_receptions_operator_id ON public.hub_receptions(operator_id);
CREATE INDEX IF NOT EXISTS idx_hub_receptions_manifest_id ON public.hub_receptions(manifest_id);
CREATE INDEX IF NOT EXISTS idx_hub_receptions_received_by ON public.hub_receptions(received_by);
CREATE INDEX IF NOT EXISTS idx_hub_receptions_delivered_by ON public.hub_receptions(delivered_by);
CREATE INDEX IF NOT EXISTS idx_hub_receptions_status ON public.hub_receptions(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_hub_receptions_deleted_at ON public.hub_receptions(deleted_at);

-- reception_scans
CREATE INDEX IF NOT EXISTS idx_reception_scans_operator_id ON public.reception_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_reception_scans_reception_id ON public.reception_scans(reception_id);
CREATE INDEX IF NOT EXISTS idx_reception_scans_package_id ON public.reception_scans(package_id);
CREATE INDEX IF NOT EXISTS idx_reception_scans_scanned_by ON public.reception_scans(scanned_by);
CREATE INDEX IF NOT EXISTS idx_reception_scans_reception_barcode ON public.reception_scans(reception_id, barcode);
CREATE INDEX IF NOT EXISTS idx_reception_scans_deleted_at ON public.reception_scans(deleted_at);

-- ============================================================================
-- PART 6: Enable RLS + Create Tenant Isolation Policies
-- ============================================================================

-- hub_receptions RLS
ALTER TABLE public.hub_receptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "hub_receptions_tenant_isolation" ON public.hub_receptions
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "hub_receptions_tenant_select" ON public.hub_receptions
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- reception_scans RLS
ALTER TABLE public.reception_scans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "reception_scans_tenant_isolation" ON public.reception_scans
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "reception_scans_tenant_select" ON public.reception_scans
    FOR SELECT
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 7: GRANT/REVOKE Permissions
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_receptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reception_scans TO authenticated;
REVOKE ALL ON public.hub_receptions FROM anon;
REVOKE ALL ON public.reception_scans FROM anon;

GRANT ALL ON public.hub_receptions TO service_role;
GRANT ALL ON public.reception_scans TO service_role;

-- ============================================================================
-- PART 8: Attach Audit Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER audit_hub_receptions_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.hub_receptions
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_reception_scans_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.reception_scans
    FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 9: Attach set_updated_at Triggers
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_hub_receptions_updated_at
    BEFORE UPDATE ON public.hub_receptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER set_reception_scans_updated_at
    BEFORE UPDATE ON public.reception_scans
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 10: Trigger — Advance package status on reception scan
-- ============================================================================
-- When a reception_scan is inserted with scan_result = 'received' and package_id IS NOT NULL,
-- advance the package status to 'en_bodega'.

CREATE OR REPLACE FUNCTION public.trg_reception_scan_advance_package_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.scan_result = 'received' AND NEW.package_id IS NOT NULL THEN
    UPDATE public.packages
    SET status = 'en_bodega',
        status_updated_at = NOW()
    WHERE id = NEW.package_id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_reception_scan_advance_package_status IS 'Advance package status to en_bodega on successful reception scan (spec-08)';

DO $$ BEGIN
  CREATE TRIGGER trg_reception_scan_advance_status
    AFTER INSERT ON public.reception_scans
    FOR EACH ROW EXECUTE FUNCTION public.trg_reception_scan_advance_package_status();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 11: Trigger — Set manifest reception_status on manifest completion
-- ============================================================================
-- When a manifest's status changes to 'completed', set reception_status = 'awaiting_reception'.

CREATE OR REPLACE FUNCTION public.trg_manifest_set_reception_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'completed' AND (OLD.status IS NULL OR OLD.status::text <> 'completed') THEN
    IF NEW.reception_status IS NULL THEN
      NEW.reception_status := 'awaiting_reception';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_manifest_set_reception_status IS 'Auto-set reception_status to awaiting_reception when manifest completes (spec-08)';

DO $$ BEGIN
  CREATE TRIGGER trg_manifest_reception_status
    BEFORE UPDATE ON public.manifests
    FOR EACH ROW EXECUTE FUNCTION public.trg_manifest_set_reception_status();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 12: Permission backfill — warehouse users get reception permission
-- ============================================================================

UPDATE public.users
SET permissions = array_append(permissions, 'reception')
WHERE 'warehouse' = ANY(permissions)
  AND NOT ('reception' = ANY(permissions))
  AND deleted_at IS NULL;

-- Admins also get reception permission
UPDATE public.users
SET permissions = array_append(permissions, 'reception')
WHERE 'admin' = ANY(permissions)
  AND NOT ('reception' = ANY(permissions))
  AND deleted_at IS NULL;

-- ============================================================================
-- PART 13: Migration Validation
-- ============================================================================

DO $$
BEGIN
  -- 1. Verify ENUMs
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'hub_reception_status_enum') THEN
    RAISE EXCEPTION 'ENUM hub_reception_status_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reception_scan_result_enum') THEN
    RAISE EXCEPTION 'ENUM reception_scan_result_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reception_status_enum') THEN
    RAISE EXCEPTION 'ENUM reception_status_enum not created!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'package_status_enum') THEN
    RAISE EXCEPTION 'ENUM package_status_enum not created!';
  END IF;

  -- 2. Verify tables exist
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'hub_receptions') THEN
    RAISE EXCEPTION 'Table public.hub_receptions not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reception_scans') THEN
    RAISE EXCEPTION 'Table public.reception_scans not found!';
  END IF;

  -- 3. Verify manifests.reception_status column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manifests' AND column_name = 'reception_status'
  ) THEN
    RAISE EXCEPTION 'Column manifests.reception_status not found!';
  END IF;

  -- 4. Verify packages status columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'packages' AND column_name = 'status'
  ) THEN
    RAISE EXCEPTION 'Column packages.status not found!';
  END IF;

  -- 5. Verify RLS enabled
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'hub_receptions' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.hub_receptions!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'reception_scans' AND c.relrowsecurity = true) THEN
    RAISE EXCEPTION 'RLS not enabled on public.reception_scans!';
  END IF;

  -- 6. Verify key indexes
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hub_receptions_operator_id') THEN
    RAISE EXCEPTION 'Index idx_hub_receptions_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hub_receptions_manifest_id') THEN
    RAISE EXCEPTION 'Index idx_hub_receptions_manifest_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reception_scans_operator_id') THEN
    RAISE EXCEPTION 'Index idx_reception_scans_operator_id not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_reception_scans_reception_id') THEN
    RAISE EXCEPTION 'Index idx_reception_scans_reception_id not found!';
  END IF;

  -- 7. Verify audit triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_hub_receptions_changes') THEN
    RAISE EXCEPTION 'Trigger audit_hub_receptions_changes not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_reception_scans_changes') THEN
    RAISE EXCEPTION 'Trigger audit_reception_scans_changes not found!';
  END IF;

  -- 8. Verify set_updated_at triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_hub_receptions_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_hub_receptions_updated_at not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_reception_scans_updated_at') THEN
    RAISE EXCEPTION 'Trigger set_reception_scans_updated_at not found!';
  END IF;

  -- 9. Verify domain triggers
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_reception_scan_advance_status') THEN
    RAISE EXCEPTION 'Trigger trg_reception_scan_advance_status not found!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_manifest_reception_status') THEN
    RAISE EXCEPTION 'Trigger trg_manifest_reception_status not found!';
  END IF;

  RAISE NOTICE '✓ Story R.1 migration validation complete';
  RAISE NOTICE '  ENUMs: package_status_enum, hub_reception_status_enum, reception_scan_result_enum, reception_status_enum';
  RAISE NOTICE '  Tables: hub_receptions, reception_scans';
  RAISE NOTICE '  Columns: manifests.reception_status, packages.status/status_updated_at/updated_at';
  RAISE NOTICE '  RLS enabled on hub_receptions, reception_scans';
  RAISE NOTICE '  Indexes: 14 standard';
  RAISE NOTICE '  Triggers: 2 audit + 2 set_updated_at + 2 domain (package status, manifest reception)';
  RAISE NOTICE '  Permission backfill: warehouse + admin users received reception permission';
END $$;
