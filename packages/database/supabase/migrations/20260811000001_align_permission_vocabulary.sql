-- =============================================================================
-- Align the database's permission vocabulary with the one the app checks
-- =============================================================================
-- Two vocabularies have coexisted since March 2026:
--
--   the app checks   pickup, reception, distribution, dispatch,
--                    customer_service (+ admin)
--                    — AppLayout.tsx sidebar, VALID_PERMISSIONS in
--                      api/users/route.ts, distribution/_client-gate.tsx
--
--   the database has warehouse, loading, operations (+ pickup, admin, dispatch)
--                    — the one-time backfill in 20260310100001, plus dispatch
--                      appended by 20260324000003
--
-- warehouse / loading / operations are checked NOWHERE in the application.
-- reception / distribution are granted NOWHERE in the database. The result is
-- that a user carrying the database's vocabulary can never see Recepción or
-- Distribución in the sidebar, whatever their role — only users edited through
-- /admin (which uses the app's list) end up correct.
--
-- The app's vocabulary is authoritative: it is what every guard actually reads.
-- This migration moves the data to it.
--
-- TWO SEPARATE PROBLEMS ARE FIXED
--
--   1. Existing users hold legacy tokens. Translated below, per token, so any
--      custom grant made through /admin is preserved. Recomputing from role
--      would clobber those.
--
--   2. handle_new_user never set permissions at all — it inserts into
--      public.users without the column, so every new user gets the '{}'
--      default and sees almost nothing until an admin grants them by hand.
--      It now assigns the role's defaults.
--
-- THIS GRANTS ACCESS. A warehouse_staff user gains reception + distribution,
-- which is what the role is meant to do and what it could not do before. The
-- translation is deliberately conservative: it never removes a permission the
-- app understands, and never touches 'admin'.
-- =============================================================================

-- ── 1. Translate legacy tokens on existing users ────────────────────────────
-- Idempotent: legacy tokens are removed as they are translated, so a re-run
-- finds nothing to do.
UPDATE public.users
SET permissions = ARRAY(
  SELECT DISTINCT unnest(
    -- keep everything the app understands
    ARRAY(SELECT unnest(permissions)
           INTERSECT
          SELECT unnest(ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']))
    -- warehouse staff work reception and the dock
    || CASE WHEN 'warehouse' = ANY(permissions)
            THEN ARRAY['reception','distribution'] ELSE ARRAY[]::text[] END
    -- loading crew work the dock and load trucks
    || CASE WHEN 'loading' = ANY(permissions)
            THEN ARRAY['distribution','dispatch'] ELSE ARRAY[]::text[] END
    -- operations managers oversee the whole pipeline
    || CASE WHEN 'operations' = ANY(permissions)
            THEN ARRAY['pickup','reception','distribution','dispatch','customer_service']
            ELSE ARRAY[]::text[] END
  )
)
WHERE deleted_at IS NULL
  AND (   'warehouse'  = ANY(permissions)
       OR 'loading'    = ANY(permissions)
       OR 'operations' = ANY(permissions));

-- ── 2. Give new users their role's permissions ──────────────────────────────
-- Template: the live definition of handle_new_user (originally
-- 20260216170542). Unchanged apart from computing and inserting permissions.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_operator_id UUID;
  v_role user_role;
  v_full_name VARCHAR(255);
  v_permissions TEXT[];
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

  -- Role defaults, in the vocabulary the application checks. Without this the
  -- column falls back to '{}' and the user sees almost nothing until an admin
  -- grants permissions by hand.
  v_permissions := CASE v_role::text
    WHEN 'pickup_crew'        THEN ARRAY['pickup']
    WHEN 'warehouse_staff'    THEN ARRAY['reception','distribution']
    WHEN 'loading_crew'       THEN ARRAY['distribution','dispatch']
    WHEN 'operations_manager' THEN ARRAY['pickup','reception','distribution','dispatch','customer_service']
    WHEN 'admin'              THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    WHEN 'super_admin'        THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    ELSE ARRAY[]::text[]
  END;

  -- Insert into public.users table
  INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
  VALUES (
    NEW.id,
    v_operator_id,
    v_role,
    NEW.email,
    v_full_name,
    v_permissions
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Fail-secure: If trigger fails, entire auth.users creation rolls back
    RAISE EXCEPTION 'User creation failed: %', SQLERRM;
END;
$function$;

-- ── Report ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_legacy INT;
  v_blind  INT;
BEGIN
  SELECT count(*) INTO v_legacy FROM public.users
   WHERE deleted_at IS NULL
     AND ('warehouse' = ANY(permissions) OR 'loading' = ANY(permissions)
          OR 'operations' = ANY(permissions));

  SELECT count(*) INTO v_blind FROM public.users
   WHERE deleted_at IS NULL AND permissions = '{}';

  IF v_legacy > 0 THEN
    RAISE WARNING 'permission alignment: % user(s) still hold legacy tokens', v_legacy;
  ELSE
    RAISE NOTICE 'permission alignment: no legacy tokens remain';
  END IF;

  RAISE NOTICE 'permission alignment: % user(s) have no permissions at all (grant via /admin)', v_blind;
END $$;
