-- =============================================================================
-- spec-85 fase 3a — Solo el jefe de operaciones puede declarar `lost`
-- =============================================================================
-- TEMPLATED ON THE LATEST DEFINITION: 20260913000003_spec85_discrepancies_rpcs.sql:227
-- (the only migration that has ever defined public.resolve_discrepancy —
-- verified 2026-09-08 by `git grep 'FUNCTION public.resolve_discrepancy'`
-- across packages/database/supabase/migrations/, one hit). Everything below
-- is byte-for-byte that body except the new role guard, placed where noted.
--
-- WHAT WAS WRONG
-- resolve_discrepancy validated the tenant (operator_id) and whether the row
-- was already closed, and NOTHING about the caller's role. EXECUTE is
-- granted to `authenticated` (20260913000003:316). Any authenticated user of
-- the operator — a pickup_crew member on the dock, a warehouse_staff member
-- — could therefore declare ANY open discrepancy of that operator 'lost'.
-- 'lost' is the branch spec-85's "Para qué sirve realmente" section names as
-- the trigger for a future indemnification workflow — a decision with
-- economic consequence had no authorisation behind it at all.
--
-- WHO MAY DECLARE `lost`, AND WHY
-- User decision, 2026-09-08 (spec-85-discrepancias.md, "Decisión del usuario
-- (2026-09-08): quién declara lost"): "Lost must be declared by the ops
-- manager". `operations_manager` already exists in the RBAC enum
-- (20260216170542_create_users_table_with_rbac.sql) — nothing new to invent.
--
-- Allowed: operations_manager, admin, super_admin. This is the exact
-- elevated-role list this repo already uses everywhere an operational gate
-- needs an escape hatch above the specific named role — cancel_pickup_route
-- (20260821000001), add/remove_manifest_from_route
-- (20260822000001/20260824000004), start_pickup_route's ops_leader variant
-- (20260824000003), the spec-73 adjacency/top-up RPCs. admin/super_admin are
-- not named in the user's sentence, but every one of those precedents treats
-- them as retaining whatever a more specific operational role can do — this
-- is not the migration to make discrepancy resolution the first exception to
-- that convention. If that turns out wrong, it is a decision to take on
-- purpose in its own change, not an inconsistency to leave standing here.
--
-- `resolved` is DELIBERATELY NOT gated. Decision, argued in
-- spec-85-discrepancias.md Fase 3a: resolving a discrepancy means the bulto
-- physically turned up — dock work, done by whoever is holding it, same as
-- today. Declaring `lost` is a determination that it will NOT turn up, and
-- that has economic consequence (the indemnification branch). Restricting
-- `resolved` too would block the exact retry/close flow spec-81's offline
-- queue and TEST 9/9b in this suite depend on, for no gain — nobody's
-- economic exposure changes when a bulto is found.
--
-- WHERE THE GUARD SITS, AND WHY THAT ORDER
-- After the "already resolved" 23505 check, before the UPDATE — NOT before
-- p_status/p_resolution validation, and NOT before the ownership fetch.
-- Reasons, both load-bearing for existing tests in this suite:
--   1. p_resolution validation (RESOLUTION_REQUIRED, P0001) stays reachable
--      for ANY caller regardless of role — a pickup_crew caller submitting a
--      blank reason on 'lost' still gets told the reason is missing, not
--      that they lack authority, matching TEST 22's existing expectation.
--   2. The "already resolved" guard (DISCREPANCY_ALREADY_RESOLVED, 23505)
--      fires before the role check for the SAME reason it fires before
--      anything else: a resolved->lost retry (TEST 8, part b) must keep
--      returning 23505 regardless of who is retrying, so an offline queue
--      (spec-81) can keep telling "already closed, stop retrying" apart from
--      "you are not allowed to do this" without the two colliding.
-- Net effect: the role guard only fires on a *fresh* open->lost transition
-- attempted by an unauthorised caller — exactly the case that matters.
--
-- NOT a data risk: a function body, no constraint and no index, so it cannot
-- abort a deploy on production rows. The behaviour change is a strict
-- NARROWING of who may successfully call resolve_discrepancy(..., 'lost',
-- ...) — resolve_discrepancy(..., 'resolved', ...) is untouched, and no
-- caller of 'lost' existed in the frontend before this fase (spec-85 fase 3b,
-- the UI screen, is still `[blocked]` on design as of this migration).
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_discrepancy(
  p_id         UUID,
  p_status     public.discrepancy_status_enum,
  p_resolution TEXT
) RETURNS public.discrepancies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_operator     UUID;
  v_actor        UUID;
  v_row          public.discrepancies%ROWTYPE;
  v_actor_role   public.user_role;
BEGIN
  v_operator := public.get_operator_id();
  IF v_operator IS NULL THEN
    RAISE EXCEPTION 'NO_OPERATOR_IN_JWT: no operator in JWT' USING ERRCODE = '42501';
  END IF;

  v_actor := NULLIF(auth.jwt() ->> 'sub', '')::UUID;

  -- M3: `NULL NOT IN (...)` evaluates to NULL, not TRUE — this IF would
  -- never fire for p_status = NULL (reachable from PostgREST as
  -- {"p_status": null}), and execution would fall through to the UPDATE
  -- below, which raises a raw 23502 not-null violation instead of a clean
  -- validation error. Check IS NULL explicitly.
  IF p_status IS NULL OR p_status NOT IN ('resolved', 'lost') THEN
    RAISE EXCEPTION 'INVALID_STATUS: p_status must be resolved or lost, got %', p_status USING ERRCODE = 'P0001';
  END IF;

  IF p_resolution IS NULL OR length(trim(p_resolution)) = 0 THEN
    RAISE EXCEPTION 'RESOLUTION_REQUIRED: p_resolution is required' USING ERRCODE = 'P0001';
  END IF;

  -- Ownership + lock: filtered by operator_id here, because the table's
  -- effective RLS is SELECT-only and this function runs as postgres. A
  -- discrepancy belonging to another operator is indistinguishable from one
  -- that does not exist — same as expand_carton's "package not found".
  SELECT * INTO v_row
    FROM public.discrepancies
   WHERE id = p_id AND operator_id = v_operator AND deleted_at IS NULL
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISCREPANCY_NOT_FOUND: discrepancy % not found for this operator', p_id USING ERRCODE = '42501';
  END IF;

  -- A closed discrepancy is evidence; editing it afterward destroys its
  -- probative value (see docs/specs/spec-85-discrepancias.md). This gets its
  -- own ERRCODE, 23505 (unique_violation — the repo's idiom for "this
  -- already happened", maps to HTTP 409), distinct from the P0001
  -- validation failures above, so an offline retry queue (spec-81) can tell
  -- "already closed, stop retrying" apart from "malformed request, do not
  -- retry blindly" — same split spec-80's close_manifest uses. Deliberately
  -- NOT P0002 (no_data_found): PostgREST maps that to HTTP 404, and a
  -- retrying client would read "already resolved" as "doesn't exist" and
  -- discard the item instead of stopping.
  IF v_row.status <> 'open' THEN
    RAISE EXCEPTION 'DISCREPANCY_ALREADY_RESOLVED: discrepancy % is already % — a closed discrepancy is evidence and cannot be reopened or changed', p_id, v_row.status
      USING ERRCODE = '23505';
  END IF;

  -- spec-85 fase 3a: only operations_manager/admin/super_admin may declare
  -- 'lost' — see the header for why 'resolved' stays open to any role, and
  -- why this guard sits here (after ownership + already-resolved, before
  -- the UPDATE). Role is read from public.users, not the JWT claim: the
  -- claim is minted at login, so a freshly promoted manager would still be
  -- carrying the old role. SECURITY DEFINER, so RLS does not hide the row.
  IF p_status = 'lost' THEN
    SELECT role INTO v_actor_role
      FROM public.users
     WHERE id = v_actor AND operator_id = v_operator AND deleted_at IS NULL;

    IF v_actor_role IS NULL
       OR v_actor_role::text NOT IN ('operations_manager', 'admin', 'super_admin') THEN
      RAISE EXCEPTION 'LOST_REQUIRES_OPERATIONS_MANAGER: declaring a discrepancy lost requires operations_manager, admin or super_admin (caller role: %)', COALESCE(v_actor_role::text, 'none')
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- m1: operator_id and deleted_at repeated here even though the FOR UPDATE
  -- select above already scoped and locked this exact row — "operator_id on
  -- every query" is a repo non-negotiable, not just a safety net for this
  -- particular call site.
  UPDATE public.discrepancies
     SET status              = p_status,
         resolution          = p_resolution,
         resolved_at         = NOW(),
         resolved_by_user_id = v_actor
   WHERE id = p_id AND operator_id = v_operator AND deleted_at IS NULL
  RETURNING * INTO v_row;

  RETURN v_row;
END $$;

COMMENT ON FUNCTION public.resolve_discrepancy(UUID, public.discrepancy_status_enum, TEXT) IS
'spec-85 fase 2/3a. Transiciona una discrepancia de open a resolved o lost.
Rechaza reabrir o cambiar una discrepancia ya cerrada (resolved/lost -> open,
o resolved -> lost) con ERRCODE 23505 (unique_violation, "esto ya pasó" ->
HTTP 409): una discrepancia cerrada es evidencia y no se reabre. p_status
distinto de resolved/lost (incluido NULL), o p_resolution vacío, es una
validación aparte y usa P0001. p_resolution es obligatorio.
Declarar p_status = lost requiere que el rol del caller (public.users.role)
sea operations_manager, admin o super_admin — cualquier otro rol recibe
LOST_REQUIRES_OPERATIONS_MANAGER (42501). p_status = resolved sigue abierto a
cualquier rol del operador. Mensajes con prefijo centinela
(NO_OPERATOR_IN_JWT, INVALID_STATUS, RESOLUTION_REQUIRED,
DISCREPANCY_NOT_FOUND, DISCREPANCY_ALREADY_RESOLVED,
LOST_REQUIRES_OPERATIONS_MANAGER), mismo patrón que record_discrepancies y
close_manifest (20260913000002).';

-- CREATE OR REPLACE preserves the function's ACL — no REVOKE/GRANT needed
-- here, and re-issuing them would be a no-op at best. Left implicit rather
-- than repeated, unlike a newly-created function (see fase 2's own note on
-- why REVOKE ... FROM anon has to be explicit THERE: a brand-new function
-- gets Supabase's default privileges, which this one does not, because it
-- already existed before this migration ran).

-- ─── Verification ────────────────────────────────────────────────────────────
-- Assert the guard this migration exists to add is really in the installed
-- body, and that everything it was templated on survived. "The function
-- exists" would stay green if this file had dropped the reopen guard, or if
-- a later CREATE OR REPLACE removed the role check.
DO $$
DECLARE v_src TEXT;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM   pg_proc p
  WHERE  p.oid = 'public.resolve_discrepancy(uuid,public.discrepancy_status_enum,text)'::regprocedure;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'resolve_discrepancy(UUID, discrepancy_status_enum, TEXT) is missing';
  END IF;
  IF v_src NOT LIKE '%LOST_REQUIRES_OPERATIONS_MANAGER%' THEN
    RAISE EXCEPTION 'resolve_discrepancy has no lost-requires-operations_manager gate — any authenticated user of the operator could declare a discrepancy lost';
  END IF;
  IF v_src NOT LIKE '%operations_manager%' OR v_src NOT LIKE '%admin%' OR v_src NOT LIKE '%super_admin%' THEN
    RAISE EXCEPTION 'resolve_discrepancy lost part of the elevated-role list (operations_manager/admin/super_admin)';
  END IF;
  IF v_src NOT LIKE '%DISCREPANCY_ALREADY_RESOLVED%' THEN
    RAISE EXCEPTION 'resolve_discrepancy no longer rejects reopening — this file was templated on an earlier definition';
  END IF;
  IF v_src NOT LIKE '%RESOLUTION_REQUIRED%' THEN
    RAISE EXCEPTION 'resolve_discrepancy no longer requires p_resolution — this file was templated on an earlier definition';
  END IF;

  RAISE NOTICE '✓ resolve_discrepancy: lost-requires-operations_manager gate installed, prior guards intact';
END $$;

COMMIT;
