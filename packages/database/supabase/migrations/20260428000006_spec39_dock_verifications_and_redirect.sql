-- Migration: Add dock_verifications + dock_scans redirect/manual_override columns (spec-39)
-- Created: 2026-04-28
-- Spec: spec-39 — Distribution pending list & binary destination scan
-- Purpose:
--   1. New `dock_verifications` table mirrors the Reception/Pickup verification pattern,
--      letting operators eyes-on / pre-verify packages without committing them to a destination.
--   2. Adds `redirect_reason` and `manual_override` to `dock_scans` so we can record when a
--      package is sent to consolidación instead of its suggested anden, or when a manager
--      uses the UI fallback.
-- Dependencies:
--   - 20260319000001_create_distribution_tables.sql (dock_scans, dock_zones)
--   - 20260209000001_auth_function.sql (public.get_operator_id)

-- ============================================================================
-- PART 1: dock_verifications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dock_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id  UUID NOT NULL REFERENCES public.operators(id),
  package_id   UUID NOT NULL REFERENCES public.packages(id),
  verified_by  UUID NOT NULL REFERENCES public.users(id),
  verified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source       TEXT NOT NULL CHECK (source IN ('scan', 'tap')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

COMMENT ON TABLE public.dock_verifications IS
  'Eyes-on verification of packages before distribution scan (spec-39). One active row per (operator_id, package_id).';
COMMENT ON COLUMN public.dock_verifications.source IS
  'How the verification happened: scan = barcode scan; tap = list-tap (no working scanner).';

-- Soft-delete-aware unique index: only one active verification per (operator_id, package_id)
CREATE UNIQUE INDEX IF NOT EXISTS dock_verifications_unique_active
  ON public.dock_verifications (operator_id, package_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dock_verifications_operator_date_idx
  ON public.dock_verifications (operator_id, verified_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS dock_verifications_package_idx
  ON public.dock_verifications (package_id)
  WHERE deleted_at IS NULL;

-- ============================================================================
-- PART 2: RLS for dock_verifications
-- ============================================================================

ALTER TABLE public.dock_verifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY dock_verifications_tenant_isolation ON public.dock_verifications
    FOR ALL
    USING (operator_id = public.get_operator_id())
    WITH CHECK (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 3: GRANTs for dock_verifications
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dock_verifications TO authenticated;
GRANT ALL ON public.dock_verifications TO service_role;
REVOKE ALL ON public.dock_verifications FROM anon;

-- ============================================================================
-- PART 4: Triggers for dock_verifications
-- ============================================================================

DO $$ BEGIN
  CREATE TRIGGER set_dock_verifications_updated_at
    BEFORE UPDATE ON public.dock_verifications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER audit_dock_verifications_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.dock_verifications
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PART 5: Realtime publication
-- ============================================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.dock_verifications;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- ============================================================================
-- PART 6: dock_scans additions for redirect + manual override
-- ============================================================================

ALTER TABLE public.dock_scans
  ADD COLUMN IF NOT EXISTS redirect_reason TEXT,
  ADD COLUMN IF NOT EXISTS manual_override BOOLEAN NOT NULL DEFAULT FALSE;

DO $$ BEGIN
  ALTER TABLE public.dock_scans
    ADD CONSTRAINT dock_scans_redirect_reason_chk
    CHECK (redirect_reason IS NULL OR redirect_reason IN ('manual_consolidation'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.dock_scans.redirect_reason IS
  'Set when a package was redirected from its suggested anden — currently only ''manual_consolidation'' (spec-39).';
COMMENT ON COLUMN public.dock_scans.manual_override IS
  'TRUE when a manager used the UI fallback (⋯ menu) instead of scanning. Audit-only flag (spec-39).';

-- ============================================================================
-- PART 7: Validation
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'dock_verifications') THEN
    RAISE EXCEPTION 'Table public.dock_verifications not found!';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'dock_verifications' AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on public.dock_verifications!';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'dock_verifications_unique_active') THEN
    RAISE EXCEPTION 'Unique index dock_verifications_unique_active not found!';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dock_scans' AND column_name = 'redirect_reason'
  ) THEN
    RAISE EXCEPTION 'Column dock_scans.redirect_reason not added!';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'dock_scans' AND column_name = 'manual_override'
  ) THEN
    RAISE EXCEPTION 'Column dock_scans.manual_override not added!';
  END IF;
  RAISE NOTICE '✓ spec-39 migration validation complete';
END $$;
