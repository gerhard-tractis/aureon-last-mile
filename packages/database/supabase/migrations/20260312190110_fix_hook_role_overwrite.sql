-- Migration: Fix custom_access_token_hook overwriting JWT role
-- Created: 2026-03-12
-- Root cause: The hook merges custom_claims (which includes "role": "admin")
--   at the JWT root level, overwriting "role": "authenticated" that PostgREST
--   requires. PostgREST sees "role": "admin", doesn't recognize it as a valid
--   Postgres role, and returns 401 on all REST API calls.
-- Fix: After merging custom claims, restore the JWT "role" to "authenticated".
--   The user's app role is still available via app_metadata.claims.role.

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

  -- Merge custom claims at JWT root level (for backward compat with
  -- functions that read operator_id from request.jwt.claims)
  claims := claims || custom_claims;

  -- CRITICAL: Restore the JWT "role" to "authenticated".
  -- PostgREST uses this field to select the Postgres role for the request.
  -- Without this, it sees "admin" and returns 401 on all REST calls.
  claims := jsonb_set(claims, '{role}', '"authenticated"');

  -- Set app_metadata.claims so frontend can read via
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

COMMENT ON FUNCTION public.custom_access_token_hook IS 'Auth Hook: Set operator_id, role, and permissions in JWT app_metadata.claims. Preserves role=authenticated at JWT root for PostgREST.';
