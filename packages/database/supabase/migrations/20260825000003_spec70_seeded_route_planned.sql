-- spec-70 phase 2 — a seeded route is `planned`, and it is dated by the wave.
--
-- Template: 20260423000003_create_seeded_route.sql, the LATEST definition of
-- this function, per the project rule that a CREATE OR REPLACE must be built
-- from the newest version rather than the original.
--
-- Two changes.
--
-- 1. The route is created at `planned`, not `draft`. Under spec-70's machine
--    `draft` means "an empty shell with no orders on it", which a seeded route
--    is not. It also matters mechanically: `draft -> loading` is not a legal
--    edge, so the first stage scan on a seeded route would have been refused by
--    transition_route_status.
--
-- 2. The route date comes from the caller. It was CURRENT_DATE, which ignored
--    the date filter Pre-ruta was planning under — so building tomorrow's wave
--    silently produced a route dated today, and it then failed to show up in
--    tomorrow's lists. NULL still means today, so an omitted argument behaves
--    as before.
--
-- 3. The order ids are cast to uuid. THIS FUNCTION HAS NEVER WORKED. The
--    parameter is text[] and dispatches.order_id is uuid, and PostgreSQL does
--    not coerce text to uuid in an INSERT ... SELECT target list:
--
--      ERROR: column "order_id" is of type uuid but expression is of type text
--
--    So every call has thrown since 20260423000003 shipped, the API layer
--    caught it as INTERNAL_ERROR, and Pre-ruta's "Armar ruta" has produced a
--    500 rather than a route for its entire life. Found by running the function
--    against a real database rather than reading it. spec70_seeded_route.test.sql
--    asserts it, so it cannot regress silently again.
--
-- DROP first: adding a parameter creates an overload rather than replacing the
-- function, and existing two-argument callers would keep silently resolving to
-- the old definition.

DROP FUNCTION IF EXISTS public.create_seeded_route(uuid, text[]);

CREATE OR REPLACE FUNCTION public.create_seeded_route(
  p_operator_id uuid,
  p_order_ids   text[],
  p_route_date  date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route_id    uuid;
  v_external_id text;
  v_route_date  date;
  v_route       jsonb;
BEGIN
  v_external_id := 'draft_' || gen_random_uuid()::text;
  v_route_date  := COALESCE(p_route_date, CURRENT_DATE);

  INSERT INTO routes (
    operator_id,
    provider,
    external_route_id,
    route_date,
    status,
    planned_stops,
    completed_stops
  )
  VALUES (
    p_operator_id,
    'dispatchtrack',
    v_external_id,
    v_route_date,
    'planned',
    array_length(p_order_ids, 1),
    0
  )
  RETURNING id INTO v_route_id;

  -- stage defaults to 'planned' (20260825000002), which is exactly right here:
  -- these stops are on the plan and nothing has been physically confirmed.
  INSERT INTO dispatches (route_id, order_id, operator_id, status, provider)
  SELECT
    v_route_id,
    order_id::uuid,
    p_operator_id,
    'pending',
    'dispatchtrack'
  FROM unnest(p_order_ids) AS order_id;

  SELECT to_jsonb(r)
  INTO v_route
  FROM (
    SELECT id, status, route_date, created_at
    FROM routes
    WHERE id = v_route_id
  ) r;

  RETURN v_route;
END;
$$;

COMMENT ON FUNCTION public.create_seeded_route(uuid, text[], date) IS
  'spec-70 phase 2. Creates a route at `planned` with one dispatch per order at '
  'stage `planned`. Ownership and already-routed validation stay in the API '
  'layer; this function only writes.';

GRANT EXECUTE ON FUNCTION public.create_seeded_route(uuid, text[], date) TO authenticated;
