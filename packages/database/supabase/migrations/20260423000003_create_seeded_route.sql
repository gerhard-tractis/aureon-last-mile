-- create_seeded_route: atomically inserts a draft route and its dispatches.
-- Called by POST /api/dispatch/routes when order_ids are provided.
-- Validation (ownership, already-routed) is done in the API layer before
-- calling this function; the function only handles the write.

CREATE OR REPLACE FUNCTION public.create_seeded_route(
  p_operator_id uuid,
  p_order_ids   text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_route_id         uuid;
  v_external_id      text;
  v_route_date       date;
  v_route            jsonb;
BEGIN
  v_external_id := 'draft_' || gen_random_uuid()::text;
  v_route_date  := CURRENT_DATE;

  -- Insert the draft route
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
    'draft',
    array_length(p_order_ids, 1),
    0
  )
  RETURNING id INTO v_route_id;

  -- Insert one dispatch per order atomically in the same transaction
  INSERT INTO dispatches (route_id, order_id, operator_id, status, provider)
  SELECT
    v_route_id,
    order_id,
    p_operator_id,
    'pending',
    'dispatchtrack'
  FROM unnest(p_order_ids) AS order_id;

  -- Return the route row as JSONB
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
