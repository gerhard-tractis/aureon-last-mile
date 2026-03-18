-- Migration: Create Users Table with Role-Based Access Control
-- Created: 2026-02-16
-- Story: 1.3 - Implement Role-Based Authentication (5 Roles)
-- Purpose: Replace user_profiles with users table, add ENUM roles, RLS policies, JWT custom claims
-- Dependencies:
--   - 20260209000001_auth_function.sql (public.get_operator_id)
--   - 20260209_multi_tenant_rls.sql (operators table)
--   - 20260216170541_add_deleted_at_column.sql (soft delete pattern)

-- ============================================================================
-- PART 1: Create Role ENUM Type (Task 1.2)
-- ============================================================================

-- Create user_role ENUM with 5 logistics roles (idempotent)
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'pickup_crew',        -- Pickup drivers - scan manifests, confirm pickups
    'warehouse_staff',    -- Warehouse workers - receive shipments, sort packages
    'loading_crew',       -- Loading dock workers - load trucks, confirm dispatch
    'operations_manager', -- Operations oversight - dashboards, manage users
    'admin'               -- System administrator - full access, configure settings
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE user_role IS 'Role-based access control ENUM for logistics workflow mapping';

-- ============================================================================
-- PART 2: Create Users Table (Task 1.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'pickup_crew',
  email VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE NULL  -- Soft delete (7-year retention compliance)
);

COMMENT ON TABLE public.users IS 'User table with multi-tenant RBAC - replaces user_profiles';
COMMENT ON COLUMN public.users.operator_id IS 'Tenant identifier for multi-tenant isolation';
COMMENT ON COLUMN public.users.role IS 'User role mapped to logistics job function';
COMMENT ON COLUMN public.users.deleted_at IS 'Soft delete timestamp (7-year data retention for Chilean compliance)';

-- ============================================================================
-- PART 3: Add Constraints and Indexes (Task 1.4)
-- ============================================================================

-- UNIQUE constraint: Prevent duplicate emails per operator
ALTER TABLE public.users ADD CONSTRAINT unique_email_per_operator UNIQUE (operator_id, email);

-- Index on operator_id for RLS policy optimization
CREATE INDEX IF NOT EXISTS idx_users_operator_id ON public.users(operator_id);

-- Index on deleted_at for active user queries (WHERE deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON public.users(deleted_at);

-- Index on role for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);

-- Composite index for common query pattern (operator + active users)
CREATE INDEX IF NOT EXISTS idx_users_operator_active ON public.users(operator_id, deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- PART 4: Enable Row-Level Security (Task 2.1)
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART 5: Create RLS Policies for Multi-Tenant RBAC (Task 2.2, 2.3, 2.4)
-- ============================================================================

-- Policy 1: Tenant isolation for SELECT (all users can read users from their own operator)
CREATE POLICY "users_tenant_isolation_select" ON public.users
  FOR SELECT
  USING (
    operator_id = public.get_operator_id()
    AND deleted_at IS NULL  -- Auto-filter soft-deleted users
  );

-- Policy 2: Admin and operations_manager can manage all users in their operator
CREATE POLICY "users_admin_full_access" ON public.users
  FOR ALL
  USING (
    operator_id = public.get_operator_id()
    AND (SELECT role FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL) IN ('admin', 'operations_manager')
  )
  WITH CHECK (
    operator_id = public.get_operator_id()
    AND (SELECT role FROM public.users WHERE id = auth.uid() AND deleted_at IS NULL) IN ('admin', 'operations_manager')
  );

-- Grant permissions
GRANT SELECT ON public.users TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.users TO authenticated;  -- Controlled by RLS policies
REVOKE ALL ON public.users FROM anon;

-- ============================================================================
-- PART 6: Database Trigger for Auto User Creation (Task 3.1, 3.2)
-- ============================================================================

-- Drop old trigger if exists (from user_profiles migration)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create new trigger function for users table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator_id UUID;
  v_role user_role;
  v_full_name VARCHAR(255);
BEGIN
  -- Extract operator_id from raw_app_meta_data (required for signup)
  v_operator_id := (NEW.raw_app_meta_data->>'operator_id')::uuid;

  -- Fail-secure: operator_id is MANDATORY
  IF v_operator_id IS NULL THEN
    RAISE EXCEPTION 'User creation failed: operator_id required in signup metadata';
  END IF;

  -- Extract role from raw_app_meta_data (default to pickup_crew if not provided)
  v_role := COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'pickup_crew');

  -- Extract full_name (fallback to email if not provided)
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

  -- Insert into public.users table
  INSERT INTO public.users (id, operator_id, role, email, full_name)
  VALUES (
    NEW.id,
    v_operator_id,
    v_role,
    NEW.email,
    v_full_name
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-secure: If trigger fails, entire auth.users creation rolls back
    RAISE EXCEPTION 'User creation failed: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS 'Trigger: Auto-create users record on auth.users INSERT (validates operator_id)';

-- Attach trigger to auth.users table
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- PART 7: Custom Access Token Hook for JWT Claims (Task 4.1)
-- ============================================================================

-- Create PostgreSQL function for Custom Access Token Auth Hook
-- NOTE: Must be registered manually in Supabase Dashboard (Authentication > Hooks > Custom Access Token)
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  user_operator_id uuid;
  user_role text;
BEGIN
  -- Extract user_id from event
  -- Query public.users for operator_id and role (exclude soft-deleted users)
  SELECT operator_id, role::text INTO user_operator_id, user_role
  FROM public.users
  WHERE id = (event->>'user_id')::uuid
    AND deleted_at IS NULL;  -- Fail-secure: deleted users get no claims

  -- Build custom claims object
  claims := jsonb_build_object(
    'operator_id', user_operator_id,
    'role', user_role
  );

  -- Merge claims into event and return
  RETURN jsonb_set(event, '{claims}', claims);
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-secure: Return event without custom claims (auth will fail downstream)
    RAISE WARNING 'custom_access_token_hook failed: %', SQLERRM;
    RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook IS 'Auth Hook: Add operator_id and role to JWT custom claims (register in Supabase Dashboard)';

-- ============================================================================
-- PART 8: Seed Demo Users for Development (Task 1.5)
-- ============================================================================

-- Insert demo users for testing (idempotent with ON CONFLICT)
-- NOTE: These are for development only. In production, users sign up via frontend.

-- Demo admin user (manually insert since auth.users creation normally happens via Supabase Auth API)
-- This assumes the demo operator exists from previous migrations
DO $$
DECLARE
  demo_operator_id UUID := '00000000-0000-0000-0000-000000000001';
  demo_admin_user_id UUID := '00000000-0000-0000-0000-000000000010';
  demo_pickup_user_id UUID := '00000000-0000-0000-0000-000000000011';
BEGIN
  -- Admin user
  INSERT INTO public.users (id, operator_id, role, email, full_name)
  VALUES (
    demo_admin_user_id,
    demo_operator_id,
    'admin',
    'admin@demo-chile.com',
    'Demo Admin User'
  )
  ON CONFLICT (operator_id, email) DO NOTHING;

  -- Pickup crew user
  INSERT INTO public.users (id, operator_id, role, email, full_name)
  VALUES (
    demo_pickup_user_id,
    demo_operator_id,
    'pickup_crew',
    'pickup@demo-chile.com',
    'Demo Pickup Driver'
  )
  ON CONFLICT (operator_id, email) DO NOTHING;

  RAISE NOTICE 'Demo users seeded for operator %', demo_operator_id;
END $$;

-- ============================================================================
-- PART 9: Migration from user_profiles to users (Backward Compatibility)
-- ============================================================================

-- Optional: Migrate existing user_profiles data to users table
-- Uncomment if user_profiles has production data

-- INSERT INTO public.users (id, operator_id, role, email, full_name, created_at)
-- SELECT
--   up.id,
--   up.operator_id,
--   CASE up.role
--     WHEN 'admin' THEN 'admin'::user_role
--     WHEN 'manager' THEN 'operations_manager'::user_role
--     ELSE 'pickup_crew'::user_role
--   END,
--   au.email,
--   COALESCE(up.full_name, au.email),
--   up.created_at
-- FROM public.user_profiles up
-- JOIN auth.users au ON au.id = up.id
-- WHERE NOT EXISTS (SELECT 1 FROM public.users WHERE id = up.id)
-- ON CONFLICT (operator_id, email) DO NOTHING;

-- Update get_operator_id to use users table instead of user_profiles
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT operator_id
  FROM public.users
  WHERE id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_operator_id IS 'Extract operator_id from users table for RLS policies (updated for Story 1.3)';

-- ============================================================================
-- PART 10: Security Validation
-- ============================================================================

DO $$
BEGIN
  -- Verify RLS is enabled on users table
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
    AND c.relname = 'users'
    AND c.relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS not enabled on public.users table!';
  END IF;

  -- Verify user_role ENUM exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'user_role'
  ) THEN
    RAISE EXCEPTION 'ENUM type user_role not found!';
  END IF;

  -- Verify custom_access_token_hook function exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'custom_access_token_hook'
    AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Function public.custom_access_token_hook() not found!';
  END IF;

  RAISE NOTICE '✓ Story 1.3 migration complete - users table with RBAC created';
  RAISE NOTICE '⚠️  NEXT STEP: Register custom_access_token_hook in Supabase Dashboard (Authentication > Hooks)';
END $$;
