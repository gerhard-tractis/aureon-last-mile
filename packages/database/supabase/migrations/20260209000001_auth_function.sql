-- Migration: Create auth.operator_id() function
-- Created: 2026-02-09
-- Purpose: JWT claim extraction for multi-tenant RLS policies
-- Must run BEFORE any policies that use auth.operator_id()

-- Helper function to get operator_id from JWT
-- Note: Must be in public schema (no permission for auth schema)
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT NULLIF(
    current_setting('request.jwt.claims', true)::json->>'operator_id',
    ''
  )::uuid;
$$;

COMMENT ON FUNCTION public.get_operator_id IS 'Extract operator_id from JWT claims for RLS policies';
