-- =============================================================================
-- spec-61 Task 1.2 fix — pickup_route_crew: authenticated must be SELECT-only
-- =============================================================================
-- 20260820000002 has already been applied to QA -- it cannot be edited, so
-- this is a follow-up migration, not a correction in place. Caught by
-- spec61_pickup_route_crew.sql:127 ("authenticated should not be able to
-- INSERT into pickup_route_crew (SELECT-only grant)") failing against the
-- real QA database: the test PR #470 shipped, against the table PR #470
-- created, asserting exactly the property that migration's own comment
-- (:146-153) said it was providing. It wasn't.
--
-- WHY THE ADDITIVE GRANT WAS INSUFFICIENT -- read this before granting
-- access to any new table in this schema:
-- 20260820000002:155 did `GRANT SELECT ON public.pickup_route_crew TO
-- authenticated` with no matching REVOKE first. A GRANT only ADDS
-- privileges; it can never remove one the role already has from another
-- source. Supabase's `authenticated` role carries broad default privileges
-- on new tables created in `public` (unlike `anon`, which starts with
-- nothing and is why :156's bare `REVOKE ALL ... FROM anon` was already
-- correct without a preceding GRANT to cancel). So the GRANT SELECT changed
-- nothing: `authenticated` could INSERT and UPDATE this table before that
-- line ran, and could still INSERT and UPDATE it after. The migration's own
-- comment named exactly the two exploits this enabled -- seating yourself on
-- any route, and freeing your own seat by writing removed_at -- and got the
-- reasoning right while shipping code that didn't achieve it. The fix for
-- "grant a role less than it has" is always REVOKE ALL first, THEN GRANT
-- back only what should remain; an additive GRANT is a no-op against a role
-- that already has more.
--
-- The RLS policy has the same shape problem, independently: it was created
-- FOR ALL, so even with the grant gap closed, RLS itself was WILLING to
-- permit a same-operator INSERT/UPDATE (its WITH CHECK matches operator_id,
-- which any authenticated member of the operator satisfies) -- RLS was never
-- the thing stopping this. Narrowed to FOR SELECT below.
--
-- This costs the writers nothing: start_pickup_route (20260820000003) and
-- trg_pickup_route_crew_sync's function, sync_pickup_route_crew_seats
-- (20260820000002:77-80), are both SECURITY DEFINER. A SECURITY DEFINER
-- function runs as its OWNER, and Postgres has a table owner bypass RLS
-- policies entirely unless the table has FORCE ROW LEVEL SECURITY set --
-- confirmed absent for pickup_route_crew (no such statement exists in
-- 20260820000002 or anywhere else in this schema). So neither writer path
-- ever evaluates this policy, narrowed or not; only a direct PostgREST
-- call from `authenticated` does, and that call is exactly what must be
-- refused.
-- =============================================================================

BEGIN;

-- REVOKE ALL, not a targeted REVOKE INSERT/UPDATE: additive-only privilege
-- changes are the exact mistake this migration exists to undo. Starting
-- from nothing and granting back only SELECT is the one form that cannot
-- silently under-revoke if `authenticated` ever picks up a third privilege
-- (e.g. DELETE) from some other default-privilege source later.
REVOKE ALL ON public.pickup_route_crew FROM authenticated;
GRANT SELECT ON public.pickup_route_crew TO authenticated;

-- Narrow FOR ALL to FOR SELECT. DROP + CREATE, not ALTER POLICY: Postgres
-- has no ALTER POLICY ... FOR <cmd> to change the command a policy applies
-- to, only RENAME and USING/WITH CHECK expression changes.
DROP POLICY IF EXISTS pickup_route_crew_tenant_isolation ON public.pickup_route_crew;

CREATE POLICY pickup_route_crew_tenant_isolation ON public.pickup_route_crew
  FOR SELECT USING (operator_id = public.get_operator_id());

-- No WITH CHECK: that clause only applies to INSERT/UPDATE, which this
-- policy no longer covers. A FOR SELECT policy takes USING only.

COMMIT;
