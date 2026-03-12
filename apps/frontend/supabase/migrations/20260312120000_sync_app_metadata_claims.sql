-- Migration: Sync public.users claims to auth.users.raw_app_meta_data
-- Created: 2026-03-12
--
-- Root cause: session.user.app_metadata comes from auth.users.raw_app_meta_data
-- (the database column), NOT from the custom_access_token_hook JWT modifications.
-- The hook only modifies the JWT access_token, but the frontend reads
-- session.user.app_metadata.claims which is the database value.
--
-- Fix:
--   1. Create a trigger function that syncs operator_id, role, permissions
--      from public.users into auth.users.raw_app_meta_data.claims
--   2. Fire trigger on INSERT/UPDATE of public.users
--   3. One-time backfill for all existing users

-- ============================================================================
-- PART 1: Trigger function to sync claims to auth.users.raw_app_meta_data
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sync_claims_to_auth_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_claims jsonb;
BEGIN
  -- Build the claims object from public.users data
  new_claims := jsonb_build_object(
    'operator_id', NEW.operator_id,
    'role', NEW.role::text,
    'permissions', to_jsonb(COALESCE(NEW.permissions, ARRAY[]::text[]))
  );

  -- Merge claims into auth.users.raw_app_meta_data
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('claims', new_claims)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_claims_to_auth_metadata IS
  'Trigger: Sync operator_id, role, permissions from public.users to auth.users.raw_app_meta_data.claims';

-- ============================================================================
-- PART 2: Attach trigger to public.users
-- ============================================================================

DROP TRIGGER IF EXISTS sync_claims_on_user_change ON public.users;

CREATE TRIGGER sync_claims_on_user_change
  AFTER INSERT OR UPDATE OF operator_id, role, permissions
  ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_claims_to_auth_metadata();

-- ============================================================================
-- PART 3: One-time backfill for all existing users
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  new_claims jsonb;
  updated_count integer := 0;
BEGIN
  FOR r IN
    SELECT id, operator_id, role::text AS role, permissions
    FROM public.users
    WHERE deleted_at IS NULL
  LOOP
    new_claims := jsonb_build_object(
      'operator_id', r.operator_id,
      'role', r.role,
      'permissions', to_jsonb(COALESCE(r.permissions, ARRAY[]::text[]))
    );

    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('claims', new_claims)
    WHERE id = r.id;

    updated_count := updated_count + 1;
  END LOOP;

  RAISE NOTICE 'Backfilled raw_app_meta_data.claims for % users', updated_count;
END;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  missing_count integer;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM public.users u
  JOIN auth.users au ON au.id = u.id
  WHERE u.deleted_at IS NULL
    AND (au.raw_app_meta_data->'claims'->>'operator_id') IS NULL;

  IF missing_count > 0 THEN
    RAISE WARNING 'Still % users without claims in raw_app_meta_data', missing_count;
  ELSE
    RAISE NOTICE 'All active users have claims synced to raw_app_meta_data ✓';
  END IF;

  -- Verify trigger exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'sync_claims_on_user_change'
  ) THEN
    RAISE EXCEPTION 'Trigger sync_claims_on_user_change not found!';
  END IF;

  RAISE NOTICE 'sync_claims_on_user_change trigger verified ✓';
END;
$$;
