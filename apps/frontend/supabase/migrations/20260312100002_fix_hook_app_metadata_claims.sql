-- Migration: Fix custom_access_token_hook to set claims inside app_metadata
-- Created: 2026-03-12
-- Problem: The frontend reads operator_id/role/permissions from
--          session.user.app_metadata.claims (i.e. JWT field app_metadata.claims).
--          The previous fix merged custom claims at the JWT root level, but the
--          frontend convention reads from the nested app_metadata.claims path.
-- Fix: After merging into JWT root, also set app_metadata.claims with the same values.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb;
  custom_claims jsonb;
  user_operator_id uuid;
  user_role text;
  user_permissions text[];
BEGIN
  SELECT operator_id, role::text, permissions
  INTO user_operator_id, user_role, user_permissions
  FROM public.users
  WHERE id = (event->>'user_id')::uuid
    AND deleted_at IS NULL;

  custom_claims := jsonb_build_object(
    'operator_id', user_operator_id,
    'role', user_role,
    'permissions', to_jsonb(COALESCE(user_permissions, ARRAY[]::text[]))
  );

  -- Start from EXISTING claims (preserves aud, exp, iat, sub, etc.)
  claims := event->'claims';

  -- Merge custom claims at JWT root level
  claims := claims || custom_claims;

  -- Also set app_metadata.claims so frontend can read via
  -- session.user.app_metadata.claims.operator_id / .role / .permissions
  claims := jsonb_set(
    claims,
    '{app_metadata,claims}',
    custom_claims
  );

  RETURN jsonb_set(event, '{claims}', claims);
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'custom_access_token_hook failed: %', SQLERRM;
    RETURN event;
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook IS 'Auth Hook: Set operator_id, role, and permissions in JWT root and app_metadata.claims';
