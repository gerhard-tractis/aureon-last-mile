-- =============================================================================
-- spec-66: ops_leader's default permissions
-- =============================================================================
-- Template is 20260820000002 (spec-61), the LATEST definition of
-- handle_new_user, per CLAUDE.md. Not 20260216170542 and not 20260811000001 —
-- re-issuing either of those would silently drop the pickup_leader branch that
-- spec-61 added.
--
-- Only the v_permissions CASE changes: one new branch. Everything else is
-- carried across unchanged.
--
-- These defaults apply only when the caller passes no explicit permissions.
-- app/api/users/route.ts overwrites them with the admin form's checked boxes
-- immediately after creation, so this is what a TRIGGER-created user gets —
-- the QA seed, and any direct auth.users insert.
--
-- apps/frontend/src/lib/permissions.ts ROLE_DEFAULT_PERMISSIONS mirrors this
-- CASE and its test enforces the two stay identical. Change both together.
--
-- ops_leader deliberately gets no customer_service and no admin: it is a floor
-- role that works all four stations, not a management role.
-- =============================================================================

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
  v_operator_id := (NEW.raw_app_meta_data->>'operator_id')::uuid;

  IF v_operator_id IS NULL THEN
    RAISE EXCEPTION 'User creation failed: operator_id required in signup metadata';
  END IF;

  v_role := COALESCE((NEW.raw_app_meta_data->>'role')::user_role, 'pickup_crew');
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);

  v_permissions := CASE v_role::text
    WHEN 'pickup_crew'        THEN ARRAY['pickup']
    WHEN 'pickup_leader'      THEN ARRAY['pickup']
    -- spec-66: all four stations, no management tokens.
    WHEN 'ops_leader'         THEN ARRAY['pickup','reception','distribution','dispatch']
    WHEN 'warehouse_staff'    THEN ARRAY['reception','distribution']
    WHEN 'loading_crew'       THEN ARRAY['distribution','dispatch']
    WHEN 'operations_manager' THEN ARRAY['pickup','reception','distribution','dispatch','customer_service']
    WHEN 'admin'              THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    WHEN 'super_admin'        THEN ARRAY['pickup','reception','distribution','dispatch','customer_service','admin']
    ELSE ARRAY[]::text[]
  END;

  INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
  VALUES (NEW.id, v_operator_id, v_role, NEW.email, v_full_name, v_permissions);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'User creation failed: %', SQLERRM;
END;
$function$;
