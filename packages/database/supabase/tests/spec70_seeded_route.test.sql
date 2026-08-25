-- =============================================================================
-- spec-70 phase 2 — create_seeded_route.
--
--   npx supabase test db          (from packages/database/)
--   bash scripts/pgtap-local.sh run spec70_seeded_route.test
--
-- The point of this file is TEST 1. `create_seeded_route` had never once
-- succeeded: its parameter is text[], `dispatches.order_id` is uuid, and
-- PostgreSQL does not coerce text to uuid in an INSERT ... SELECT target list.
-- Every call raised
--
--   column "order_id" is of type uuid but expression is of type text
--
-- which the API layer caught and reported as a generic INTERNAL_ERROR, so
-- Pre-ruta's "Armar ruta" returned a 500 instead of a route from the day it
-- shipped (20260423000003) until spec-70 phase 2. Reading the SQL did not
-- reveal it; running it did.
-- =============================================================================

BEGIN;

INSERT INTO public.operators (id, name, slug, country_code)
VALUES ('aaaa0070-0000-0000-0000-000000000070', 'Test Op 70-seed', 'test-op-70-seed', 'CL')
ON CONFLICT (id) DO NOTHING;

-- orders carries several NOT NULL columns with no default; all of them have to
-- be supplied or the fixture fails before the function is ever reached.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, status, raw_data, imported_at, imported_via
)
SELECT
  ('0dd50070-0000-0000-0000-00000000007' || n)::uuid,
  'aaaa0070-0000-0000-0000-000000000070',
  'SPEC70-SEED-' || n,
  'Cliente ' || n,
  '+56900000000',
  'Av Principal ' || n,
  'Maipú',
  CURRENT_DATE,
  'en_bodega',
  '{}'::jsonb,
  NOW(),
  (SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'imported_via_enum' ORDER BY e.enumsortorder LIMIT 1)::imported_via_enum
FROM generate_series(1, 2) AS n;

-- -----------------------------------------------------------------------------
-- TEST 1: the function runs at all, and attaches every order to the route.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r jsonb; v_route_id uuid; n INT;
BEGIN
  r := public.create_seeded_route(
    'aaaa0070-0000-0000-0000-000000000070'::uuid,
    ARRAY['0dd50070-0000-0000-0000-000000000071',
          '0dd50070-0000-0000-0000-000000000072'],
    NULL);

  v_route_id := (r->>'id')::uuid;
  SELECT COUNT(*) INTO n FROM public.dispatches WHERE route_id = v_route_id;
  IF n <> 2 THEN
    RAISE EXCEPTION 'TEST 1: expected 2 dispatches, got %', n;
  END IF;
  RAISE NOTICE 'TEST 1 passed: create_seeded_route executed and attached % orders', n;
END $$;

-- -----------------------------------------------------------------------------
-- TEST 2: the route is `planned`, not `draft`.
-- `draft` means an empty shell with no orders. It also matters mechanically:
-- draft -> loading is not a legal edge, so the first stage scan on a seeded
-- route would be refused by transition_route_status.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r jsonb; st text;
BEGIN
  r := public.create_seeded_route(
    'aaaa0070-0000-0000-0000-000000000070'::uuid,
    ARRAY['0dd50070-0000-0000-0000-000000000071'], NULL);
  st := r->>'status';
  IF st <> 'planned' THEN
    RAISE EXCEPTION 'TEST 2: seeded route is %, want planned', st;
  END IF;

  -- and the transition the first scan performs must be legal from there
  PERFORM public.transition_route_status(
    (r->>'id')::uuid, 'aaaa0070-0000-0000-0000-000000000070'::uuid, 'loading'::route_status_enum);
  RAISE NOTICE 'TEST 2 passed: seeded route is planned and may move to loading';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 3: every seeded stop starts on the plan, not staged.
-- If seeding produced `staged` rows the seal guard would pass with nothing
-- physically confirmed, which is breakage #2 in the spec.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r jsonb; bad INT;
BEGIN
  r := public.create_seeded_route(
    'aaaa0070-0000-0000-0000-000000000070'::uuid,
    ARRAY['0dd50070-0000-0000-0000-000000000071'], NULL);

  SELECT COUNT(*) INTO bad
    FROM public.dispatches
   WHERE route_id = (r->>'id')::uuid
     AND (stage <> 'planned' OR staged_at IS NOT NULL);
  IF bad <> 0 THEN
    RAISE EXCEPTION 'TEST 3: % seeded stops were not left at stage=planned', bad;
  END IF;
  RAISE NOTICE 'TEST 3 passed: seeded stops start at stage=planned';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 4: the wave's date is honoured, and omitting it still means today.
-- CURRENT_DATE was hardcoded, so planning tomorrow produced a route dated
-- today which then never appeared in tomorrow's lists.
-- -----------------------------------------------------------------------------
DO $$
DECLARE r jsonb; d date;
BEGIN
  r := public.create_seeded_route(
    'aaaa0070-0000-0000-0000-000000000070'::uuid,
    ARRAY['0dd50070-0000-0000-0000-000000000071'], CURRENT_DATE + 1);
  d := (r->>'route_date')::date;
  IF d <> CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'TEST 4a: wave date ignored, route dated %', d;
  END IF;

  r := public.create_seeded_route(
    'aaaa0070-0000-0000-0000-000000000070'::uuid,
    ARRAY['0dd50070-0000-0000-0000-000000000071'], NULL);
  d := (r->>'route_date')::date;
  IF d <> CURRENT_DATE THEN
    RAISE EXCEPTION 'TEST 4b: omitted date gave %, want today', d;
  END IF;
  RAISE NOTICE 'TEST 4 passed: wave date honoured, NULL still means today';
END $$;

-- -----------------------------------------------------------------------------
-- TEST 5: the two-argument overload is gone.
-- Adding a parameter creates an overload rather than replacing the function, so
-- without the DROP every existing two-argument caller would keep resolving to
-- the old broken definition.
-- -----------------------------------------------------------------------------
DO $$
DECLARE sigs TEXT;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO sigs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_seeded_route';

  IF sigs <> 'create_seeded_route(uuid,text[],date)' THEN
    RAISE EXCEPTION 'TEST 5: expected exactly the 3-arg signature, found: %', sigs;
  END IF;
  RAISE NOTICE 'TEST 5 passed: only the 3-argument signature exists';
END $$;

DO $$ BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'All spec-70 phase 2 seeded-route tests passed!';
  RAISE NOTICE '========================================';
END $$;

ROLLBACK;
