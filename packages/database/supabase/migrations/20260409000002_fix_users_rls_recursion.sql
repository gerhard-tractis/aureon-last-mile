-- ============================================================================
-- Migration: fix infinite recursion in users_admin_full_access RLS policy
--
-- Root cause:
--   The "users_admin_full_access" policy uses
--     (SELECT role FROM public.users WHERE id = auth.uid() ...)
--   This sub-select triggers the same policy on public.users, causing
--   PostgreSQL error 42P17 "infinite recursion detected in policy for
--   relation users". Any PostgREST query that embeds public.users data
--   (e.g. the hub_receptions → delivered_by_user join in useReceptionManifests)
--   fails with a 500 and the caller silently gets an empty result set.
--
-- Fix:
--   Introduce get_current_user_role() as SECURITY DEFINER so it reads
--   public.users bypassing RLS, then rewrite the policy to call that
--   function instead of the recursive inline sub-select.
-- ============================================================================

-- 1. SECURITY DEFINER helper — reads public.users without triggering RLS
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE id = auth.uid()
    AND deleted_at IS NULL
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_current_user_role() IS
  'Returns the role of the currently authenticated user without triggering '
  'RLS on public.users (SECURITY DEFINER). Used by the users_admin_full_access '
  'policy to avoid infinite recursion.';

-- 2. Recreate the admin policy using the safe helper
DROP POLICY IF EXISTS "users_admin_full_access" ON public.users;

CREATE POLICY "users_admin_full_access" ON public.users
  FOR ALL
  USING (
    operator_id = public.get_operator_id()
    AND public.get_current_user_role() IN ('admin', 'operations_manager')
  )
  WITH CHECK (
    operator_id = public.get_operator_id()
    AND public.get_current_user_role() IN ('admin', 'operations_manager')
  );

-- Smoke test
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_current_user_role') THEN
    RAISE EXCEPTION 'Function get_current_user_role not found!';
  END IF;
  RAISE NOTICE '✓ users_admin_full_access policy rewritten without recursion';
END $$;
