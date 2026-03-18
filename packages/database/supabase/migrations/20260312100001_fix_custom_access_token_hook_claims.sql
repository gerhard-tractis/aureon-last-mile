-- Migration: Fix custom_access_token_hook to MERGE claims instead of replacing
-- Created: 2026-03-12
-- Bug: The hook was building a new jsonb_build_object and using jsonb_set to
--      REPLACE event.claims entirely. This wiped out required JWT fields
--      (aud, exp, iat, sub, email, phone, aal, session_id, is_anonymous),
--      causing Supabase Auth to reject every token refresh with:
--      "output claims do not conform to the expected schema"
-- Fix: Read existing claims first, then merge custom claims into them.

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

  -- Start from EXISTING claims (preserves aud, exp, iat, sub, etc.)
  claims := event->'claims';

  -- Merge custom claims into the existing ones
  claims := claims || jsonb_build_object(
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

COMMENT ON FUNCTION public.custom_access_token_hook IS 'Auth Hook: Merge operator_id, role, and permissions into JWT custom claims (register in Supabase Dashboard)';
