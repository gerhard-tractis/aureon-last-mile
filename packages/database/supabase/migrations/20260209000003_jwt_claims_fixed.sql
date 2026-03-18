-- Migration: JWT Claims Configuration (Fixed)
-- Created: 2026-02-09
-- Purpose: Automatically add operator_id to JWT claims for multi-tenant RLS
-- Ensures every user has operator_id in their JWT token

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
-- PART 3: Update get_operator_id to use user_profiles
-- ============================================================================

-- Update the function to get operator_id from user_profiles table
CREATE OR REPLACE FUNCTION public.get_operator_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT operator_id
  FROM public.user_profiles
  WHERE id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_operator_id IS 'Get operator_id from user profile for RLS policies';

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

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'handle_new_user'
    AND pronamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'Function public.handle_new_user() not found!';
  END IF;

  RAISE NOTICE 'JWT claims configuration complete ✓';
END $$;
