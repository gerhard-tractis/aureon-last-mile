-- Migration: JWT Claims Configuration
-- Created: 2026-02-09
-- Purpose: Automatically add operator_id to JWT claims for multi-tenant RLS
-- Ensures every user has operator_id in their JWT token

-- ============================================================================
-- PART 0: Ensure public.operators exists (fresh-rebuild ordering fix, spec-48)
-- ============================================================================
-- This file FK-references public.operators, but the migration that bootstraps
-- that table (20260209000004_bootstrap_operators_audit_logs.sql, added by C3)
-- sorts AFTER this one — so a fresh replay (supabase db reset, QA
-- apply-migrations.sh) failed here. On production the table has always
-- existed, so this guarded CREATE is a no-op there. Column DDL is an exact
-- copy of 20260209000004, which still owns the indexes/RLS/comments.
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

-- ============================================================================
-- PART 1: Add operator_id to user profiles
-- ============================================================================

-- Create user profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  operator_id UUID NOT NULL REFERENCES public.operators(id) ON DELETE CASCADE,
  full_name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE public.user_profiles IS 'User profiles with operator assignment for multi-tenancy';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_operator_id ON public.user_profiles(operator_id);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_own_profile_read" ON public.user_profiles
  FOR SELECT
  USING (id = auth.uid());

-- Users can update their own profile (but not operator_id!)
CREATE POLICY "users_own_profile_update" ON public.user_profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND operator_id = (SELECT operator_id FROM public.user_profiles WHERE id = auth.uid()));

-- ============================================================================
-- PART 2: Trigger to create profile on user signup
-- ============================================================================

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_operator_id UUID;
BEGIN
  -- Get the demo operator for development (in production, this would come from signup form)
  SELECT id INTO default_operator_id
  FROM public.operators
  WHERE slug = 'demo-chile'
  LIMIT 1;

  -- If no demo operator, use the first available operator
  IF default_operator_id IS NULL THEN
    SELECT id INTO default_operator_id
    FROM public.operators
    WHERE is_active = TRUE
    LIMIT 1;
  END IF;

  -- Create user profile with operator assignment
  INSERT INTO public.user_profiles (id, operator_id, full_name, role)
  VALUES (
    NEW.id,
    default_operator_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'user')
  );

  -- Update auth.users metadata to include operator_id (for JWT)
  UPDATE auth.users
  SET raw_app_metadata =
    COALESCE(raw_app_metadata, '{}'::jsonb) ||
    jsonb_build_object('operator_id', default_operator_id::text)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user IS 'Automatically assigns new users to an operator and adds operator_id to JWT';

-- Create trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- PART 3: Update get_operator_id to use app_metadata
-- ============================================================================

-- Update the function to extract from app_metadata (more reliable than custom claims)
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(
    -- Try custom claim first (for manual JWT configuration)
    NULLIF(current_setting('request.jwt.claims', true)::json->>'operator_id', '')::uuid,
    -- Fallback to app_metadata (set by trigger)
    NULLIF(current_setting('request.jwt.claims', true)::json->'app_metadata'->>'operator_id', '')::uuid
  );
$$;

-- ============================================================================
-- PART 4: Create test users for RLS validation (Development only)
-- ============================================================================

-- NOTE: In production, users sign up via the app
-- This is just for testing RLS isolation

-- Test User 1: Demo Logistics driver
DO $$
DECLARE
  demo_operator_id UUID;
  test_user_1_id UUID := '10000000-0000-0000-0000-000000000001';
BEGIN
  -- Get demo operator
  SELECT id INTO demo_operator_id FROM public.operators WHERE slug = 'demo-chile';

  -- spec-48 fresh-rebuild fix: the demo operator only exists when seed.sql has
  -- run (it has not, during migration replay), and the original INSERT used a
  -- nonexistent column name (raw_app_metadata) — so this block could never
  -- replay on a fresh database. Skip when the operator is absent and use the
  -- real GoTrue column name (raw_app_meta_data). No-op on production.
  IF demo_operator_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = test_user_1_id) THEN
    -- Insert test user (this would normally happen via Supabase Auth signup)
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      test_user_1_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'driver@demologistics.cl',
      crypt('testpassword123', gen_salt('bf')),
      NOW(),
      jsonb_build_object('operator_id', demo_operator_id::text),
      jsonb_build_object('full_name', 'Pedro Driver', 'role', 'driver'),
      NOW(),
      NOW(),
      '',
      ''
    );

    -- Create profile
    INSERT INTO public.user_profiles (id, operator_id, full_name, role)
    VALUES (test_user_1_id, demo_operator_id, 'Pedro Driver', 'driver');
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Test that get_operator_id() function exists and is callable
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'get_operator_id'
    AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Function public.get_operator_id() not found!';
  END IF;

  RAISE NOTICE 'JWT claims configuration complete ✓';
END $$;
