-- Migration: Multi-Tenant RLS Policies
-- Created: 2026-02-09
-- Purpose: Implement operator-level data isolation for multi-tenant SaaS
-- Security: Row-Level Security (RLS) ensures operator data is isolated at DB level

-- ============================================================================
-- PART 1: Create Operators Table (Tenants)
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

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_operators_slug ON public.operators(slug);
CREATE INDEX IF NOT EXISTS idx_operators_is_active ON public.operators(is_active);

-- Enable RLS on operators table
ALTER TABLE public.operators ENABLE ROW LEVEL SECURITY;

-- Operators can only see their own record
CREATE POLICY "operators_isolation" ON public.operators
  FOR ALL
  USING (id = auth.operator_id());

-- ============================================================================
-- PART 2: Extend auth.users with operator_id (Multi-Tenant User Assignment)
-- ============================================================================

-- Add operator_id to user metadata via trigger
-- Note: Supabase auth.users table is managed, so we use app_metadata

-- Helper function to get operator_id from JWT
CREATE OR REPLACE FUNCTION auth.operator_id()
RETURNS UUID
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'operator_id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION auth.operator_id IS 'Extract operator_id from JWT claims for RLS policies';

-- ============================================================================
-- PART 3: Create Core Tables with operator_id
-- ============================================================================

-- Orders table
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  order_number VARCHAR(50) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  delivery_address TEXT NOT NULL,
  barcode VARCHAR(100) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  priority VARCHAR(20) DEFAULT 'normal',
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  delivered_at TIMESTAMP WITH TIME ZONE,
  CONSTRAINT unique_order_number_per_operator UNIQUE (operator_id, order_number)
);

COMMENT ON TABLE public.orders IS 'Multi-tenant orders table with RLS isolation';

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_operator_id ON public.orders(operator_id);
CREATE INDEX IF NOT EXISTS idx_orders_barcode ON public.orders(barcode);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(operator_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Tenant isolation
CREATE POLICY "orders_tenant_isolation" ON public.orders
  FOR ALL
  USING (operator_id = auth.operator_id());

-- Manifests table
CREATE TABLE IF NOT EXISTS public.manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_number VARCHAR(50) NOT NULL,
  driver_id UUID,
  vehicle_plate VARCHAR(20),
  route_name VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  expected_packages INTEGER DEFAULT 0,
  scanned_packages INTEGER DEFAULT 0,
  signature_data TEXT,
  signed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT unique_manifest_number_per_operator UNIQUE (operator_id, manifest_number)
);

COMMENT ON TABLE public.manifests IS 'Pickup manifests for drivers with RLS isolation';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manifests_operator_id ON public.manifests(operator_id);
CREATE INDEX IF NOT EXISTS idx_manifests_status ON public.manifests(operator_id, status);
CREATE INDEX IF NOT EXISTS idx_manifests_created_at ON public.manifests(operator_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.manifests ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "manifests_tenant_isolation" ON public.manifests
  FOR ALL
  USING (operator_id = auth.operator_id());

-- Barcode Scans table
CREATE TABLE IF NOT EXISTS public.barcode_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  manifest_id UUID REFERENCES public.manifests(id) ON DELETE CASCADE,
  order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  barcode VARCHAR(100) NOT NULL,
  scanned_by UUID NOT NULL,
  scanned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  metadata JSONB DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.barcode_scans IS 'Barcode scan events with geolocation and RLS isolation';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scans_operator_id ON public.barcode_scans(operator_id);
CREATE INDEX IF NOT EXISTS idx_scans_manifest_id ON public.barcode_scans(manifest_id);
CREATE INDEX IF NOT EXISTS idx_scans_barcode ON public.barcode_scans(operator_id, barcode);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON public.barcode_scans(operator_id, scanned_at DESC);

-- Enable RLS
ALTER TABLE public.barcode_scans ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "scans_tenant_isolation" ON public.barcode_scans
  FOR ALL
  USING (operator_id = auth.operator_id());

-- Audit Logs table (7-year retention for compliance)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_operator_id ON public.audit_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON public.audit_logs(operator_id, user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON public.audit_logs(operator_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON public.audit_logs(operator_id, resource_type, resource_id);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "audit_tenant_isolation" ON public.audit_logs
  FOR ALL
  USING (operator_id = auth.operator_id());

-- ============================================================================
-- PART 4: Create Seed Data (Development Only)
-- ============================================================================

-- Insert test operator
INSERT INTO public.operators (id, name, slug, country_code)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Demo Logistics Chile', 'demo-chile', 'CL')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- PART 5: Utility Functions
-- ============================================================================

-- Function to audit log inserts
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action VARCHAR,
  p_resource_type VARCHAR,
  p_resource_id UUID,
  p_changes JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.audit_logs (operator_id, user_id, action, resource_type, resource_id, changes_json, ip_address)
  VALUES (
    auth.operator_id(),
    auth.uid(),
    p_action,
    p_resource_type,
    p_resource_id,
    p_changes,
    current_setting('request.headers', true)::json->>'x-forwarded-for'
  );
END;
$$;

COMMENT ON FUNCTION public.log_audit_event IS 'Helper function to log audit events with automatic operator_id';

-- ============================================================================
-- SECURITY VALIDATION
-- ============================================================================

-- Verify all tenant-scoped tables have RLS enabled
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOR table_name IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
    AND tablename IN ('operators', 'orders', 'manifests', 'barcode_scans', 'audit_logs')
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      AND c.relname = table_name
      AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'RLS not enabled on table: %', table_name;
    END IF;
  END LOOP;
END;
$$;
