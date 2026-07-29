-- Migration: Bootstrap operators + audit_logs (the two tables with no DDL in the applied set)
--
-- Why this file exists
-- --------------------
-- `operators` and `audit_logs` were only ever created by
-- `20260209_multi_tenant_rls.sql.bak`. The `.bak` extension makes the Supabase
-- CLI skip that file, so production only has these tables because the SQL was
-- pasted into the dashboard by hand (see the old migrations/README.md).
--
-- The consequence was that the repo could not rebuild its own database:
-- `supabase db reset` failed at the first FK-bearing migration
-- (20260216170542_create_users_table_with_rbac.sql references public.operators),
-- so there was no working local reset and no path to a staging environment.
--
-- This migration restores reproducibility with the minimum necessary DDL. It
-- deliberately does NOT replay the rest of the `.bak` — `orders`, `manifests`,
-- and `barcode_scans` are all created (and in some cases dropped and recreated)
-- by later migrations, and replaying them here would fight those files.
--
-- Ordering: after 20260209000001_auth_function.sql, which defines
-- public.get_operator_id() used by the policies below, and before
-- 20260216170541_add_deleted_at_column.sql, which alters public.operators.
--
-- Idempotent by construction: on production every object below already exists,
-- so this migration is a no-op there.

-- ============================================================================
-- operators — the tenant table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.operators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  country_code VARCHAR(2) DEFAULT 'CL',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  settings JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.operators IS 'Multi-tenant operators (logistics companies)';

CREATE INDEX IF NOT EXISTS idx_operators_slug ON public.operators(slug);
CREATE INDEX IF NOT EXISTS idx_operators_is_active ON public.operators(is_active);

ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY has no IF NOT EXISTS, so guard against the policy already
-- existing on production.
DO $$
BEGIN
  CREATE POLICY "operators_isolation" ON public.operators
    FOR ALL
    USING (id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'policy operators_isolation already exists, skipping';
END;
$$;

-- ============================================================================
-- audit_logs — append-only trail, 7-year retention (Chilean commercial law)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  changes_json JSONB,
  ip_address VARCHAR(50),
  user_agent TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.audit_logs IS 'Audit trail with 7-year retention (compliance requirement)';

CREATE INDEX IF NOT EXISTS idx_audit_operator_id ON public.audit_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.audit_logs(operator_id, user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON public.audit_logs(operator_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON public.audit_logs(operator_id, resource_type, resource_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "audit_tenant_isolation" ON public.audit_logs
    FOR ALL
    USING (operator_id = public.get_operator_id());
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'policy audit_tenant_isolation already exists, skipping';
END;
$$;

-- ============================================================================
-- Validation
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['operators', 'audit_logs'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t
    ) THEN
      RAISE EXCEPTION 'bootstrap failed: public.% was not created', t;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'bootstrap failed: RLS not enabled on public.%', t;
    END IF;
  END LOOP;
END;
$$;
