-- Migration: Add permissions array to users table
-- Created: 2026-03-10
-- Story: 4.0 - Migrate RBAC from roles to permissions
-- Epic: 4A - Pickup Verification (Core Scanning Flow)
-- Purpose: Add permissions TEXT[] column alongside existing role column.
--          Users can have multiple permissions. Role kept for backward compat.
-- Dependencies:
--   - 20260216170542_create_users_table_with_rbac.sql (users table, custom_access_token_hook)

-- Add permissions column
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

-- Backfill existing users based on their role
UPDATE public.users SET permissions = CASE role::text
  WHEN 'pickup_crew' THEN ARRAY['pickup']
  WHEN 'warehouse_staff' THEN ARRAY['warehouse']
  WHEN 'loading_crew' THEN ARRAY['loading']
  WHEN 'operations_manager' THEN ARRAY['operations']
  WHEN 'admin' THEN ARRAY['pickup','warehouse','loading','operations','admin']
END
WHERE permissions = '{}' AND deleted_at IS NULL;

-- Update custom_access_token_hook to include permissions in JWT claims
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
  user_permissions text[];
BEGIN
  SELECT operator_id, role::text, permissions
  INTO user_operator_id, user_role, user_permissions
  FROM public.users
  WHERE id = (event->>'user_id')::uuid
    AND deleted_at IS NULL;

  claims := jsonb_build_object(
    'operator_id', user_operator_id,
    'role', user_role,
    'permissions', to_jsonb(COALESCE(user_permissions, ARRAY[]::text[]))
  );

  RETURN jsonb_set(event, '{claims}', claims);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'custom_access_token_hook failed: %', SQLERRM;
    RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook IS 'Auth Hook: Add operator_id, role, and permissions to JWT custom claims (register in Supabase Dashboard)';

-- Index for permissions queries (GIN for array containment)
CREATE INDEX IF NOT EXISTS idx_users_permissions ON public.users USING GIN (permissions);

-- Validation
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'permissions'
  ) THEN
    RAISE EXCEPTION 'Column users.permissions not found!';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_permissions') THEN
    RAISE EXCEPTION 'Index idx_users_permissions not found!';
  END IF;

  RAISE NOTICE '✓ Story 4.0 migration complete - permissions column added to users';
  RAISE NOTICE '  Backfilled existing users based on role';
  RAISE NOTICE '  custom_access_token_hook updated with permissions claim';
END $$;
