-- =============================================================================
-- spec-61 Task 4 — get_my_active_pickup_route(): leader OR active crew
-- =============================================================================
-- Numbered ...0005, not ...0004 as the spec text says: ...0004 was already
-- taken on disk by 20260820000004_spec61_pickup_route_crew_grant_fix.sql
-- (the Task 1.2 follow-up). Two files sharing a timestamp prefix have no
-- defined order relative to each other.
--
-- Replaces the PostgREST query in
-- apps/frontend/src/hooks/pickup/useActivePickupRoute.ts, which filtered
-- driver_id = auth.uid() and so showed a crew member NO active route --
-- dropping them on 3j, where they would open a second route for the same van.
--
-- Why an RPC and not a richer .select(): "I lead it OR I am active crew on it"
-- is an OR across a join. PostgREST's .or() cannot filter a parent row on an
-- embedded table's column (referencedTable filters the embed, not the parent),
-- and pickup_route_crew!inner would drop a leader who took no crew. The
-- alternatives are two round-trips or this. One round trip, and it carries the
-- crew list that 3h needs (spec-61 Task 6) in the same payload.
--
-- SECURITY INVOKER, deliberately: every table it reads already has a tenant
-- SELECT policy for authenticated users -- pickup_routes
-- (20260625000001:115), pickup_route_crew (20260820000004, which narrowed the
-- FOR ALL policy 20260820000002 created down to FOR SELECT), vehicles
-- (20260812000001:36), users (20260216170542:78). None of them is
-- driver-scoped; all four are operator-scoped, so a crew member reading the
-- leader's route, plate and name passes RLS. A DEFINER function here would
-- hand out cross-operator data if the operator scoping below ever regressed;
-- INVOKER keeps RLS as the backstop.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_active_pickup_route()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, auth
AS $$
  WITH me AS (
    SELECT NULLIF(auth.jwt() ->> 'sub','')::UUID AS uid,
           public.get_operator_id()              AS op
  ),
  mine AS (
    SELECT pr.*
      FROM public.pickup_routes pr, me
     WHERE pr.operator_id = me.op
       AND pr.status = 'in_progress'
       AND pr.deleted_at IS NULL
       AND (
         pr.driver_id = me.uid
         OR EXISTS (
           SELECT 1 FROM public.pickup_route_crew c
            WHERE c.pickup_route_id = pr.id
              AND c.user_id    = me.uid
              AND c.removed_at IS NULL
              AND c.deleted_at IS NULL
         )
       )
     -- Ordered + LIMIT 1 because two rows here are REACHABLE, unlike the
     -- comment the hook carried: uniq_pickup_routes_one_active_per_driver and
     -- uniq_pickup_route_crew_one_active_per_user are separate indexes and
     -- neither excludes the other, so one person can lead route B while
     -- holding an active seat on route A. Newest wins; pr.id breaks a
     -- started_at tie so the answer is at least stable across calls.
     ORDER BY pr.started_at DESC, pr.id DESC
     LIMIT 1
  )
  SELECT to_jsonb(m.*) || jsonb_build_object(
    -- `plate`, not vehicle_label: vehicle_label is a deprecated expand-phase
    -- mirror (spec-52). LEFT-join semantics -- a route whose vehicle row was
    -- removed still resolves, with plate NULL, matching
    -- ActivePickupRoute['vehicle'] being nullable.
    'plate',       (SELECT v.plate     FROM public.vehicles v WHERE v.id = m.vehicle_id),
    'driver_name', (SELECT u.full_name FROM public.users   u WHERE u.id = m.driver_id),
    -- LEFT JOIN, not JOIN: users_tenant_isolation_select filters
    -- deleted_at IS NULL, so an inner join would make a soft-deleted
    -- colleague VANISH from the crew array and quietly shorten the head
    -- count a leader reads on 3h. The seat is the fact; the name is the
    -- decoration, and RouteCrewMember.full_name is nullable to say so.
    -- NULL names sort last under ORDER BY ... ASC.
    'crew', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('user_id', c.user_id, 'full_name', u.full_name)
               ORDER BY u.full_name)
        FROM public.pickup_route_crew c
        LEFT JOIN public.users u ON u.id = c.user_id
       WHERE c.pickup_route_id = m.id
         AND c.removed_at IS NULL
         AND c.deleted_at IS NULL
    ), '[]'::jsonb)
  )
  FROM mine m;
$$;

COMMENT ON FUNCTION public.get_my_active_pickup_route() IS
  'The caller''s open pickup route -- the one they LEAD or are active CREW on '
  '(spec-61) -- with the vehicle plate, the leader''s name and the crew, in one '
  'round trip. NULL when there is none. Contract of ActivePickupRoute in '
  'apps/frontend/src/hooks/pickup/useActivePickupRoute.ts.';

-- FROM PUBLIC first, then grant back. Postgres gives EXECUTE on every new
-- function to PUBLIC, and `anon` inherits it from there -- so a bare
-- `REVOKE ... FROM anon` (what the spec text said, and what 20260820000003
-- does) leaves anon able to call it, exactly the additive-privilege trap
-- 20260820000004 exists to undo. Harmless here in practice, since INVOKER +
-- get_operator_id() means anon would only ever get NULL back, but the shape
-- should not be copied forward as if it worked.
REVOKE ALL ON FUNCTION public.get_my_active_pickup_route() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_active_pickup_route() TO authenticated;

-- No service_role grant, following 20260812000004:100-104: service_role is
-- not assumed to hold EXECUTE, and nothing needs it here anyway -- this
-- function answers "who am I and what is my route" from auth.jwt() and
-- get_operator_id(), so a service-role connection would only ever get NULL.
-- If a job ever needs it, add an explicit GRANT here.

COMMIT;
