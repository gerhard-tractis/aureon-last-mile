-- spec-61 Task 7 — a load already on a route is not offered as available.
--
-- Two operators on purpose: with one, the `o.operator_id = get_operator_id()`
-- filter inside get_pending_manifests cannot be shown to matter (delete it and
-- a single-tenant fixture stays green). TEST 1 runs in the OWNER context,
-- where RLS is bypassed, so that filter is the only thing standing between
-- operator A's caller and operator B's load — which makes the cross-tenant
-- assertion falsifiable rather than decorative.
--
-- TEST 2 repeats the core assertion under `SET LOCAL role = 'authenticated'`,
-- the role that actually runs this SECURITY INVOKER function in production.
-- That is not a duplicate: the new exclusion reads `manifests` through a
-- subquery, and if RLS hid the routed manifests row from a normal caller the
-- subquery would return nothing and the routed load would come back — TEST 1
-- (owner, RLS off) cannot see that failure mode at all.
BEGIN;

-- ─── Operator A: the caller ─────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000640','Spec61 Pending','spec61-pending')
ON CONFLICT (slug) DO NOTHING;

-- ─── Operator B: exists only so the tenant filter has something to exclude ──
INSERT INTO public.operators (id, name, slug)
VALUES ('bbbbbbbb-0000-4000-b000-000000000640','Spec61 Pending Other','spec61-pending-other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000641','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','pend-leader@spec61.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider Pend"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000000641','aaaaaaaa-0000-4000-a000-000000000640',
        'pickup_leader','pend-leader@spec61.test','Lider Pend',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('99999999-0000-4000-9000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','VEH-64', true)
ON CONFLICT DO NOTHING;

-- Three CARGAs. trg_ensure_manifest_for_order (20260814000001) creates the
-- manifests rows from these inserts -- do not insert manifests by hand.
-- customer_name/customer_phone/delivery_address/comuna/delivery_date/raw_data/
-- imported_via/imported_at are all NOT NULL on public.orders
-- (20260217000003:50) -- a shorter INSERT does not parse. `status` is omitted
-- on purpose rather than because it is absent: it exists, as
-- order_status_enum NOT NULL DEFAULT 'ingresado' (20260223000001:338, retyped
-- by 20260313000001), and nothing in this test depends on its value, so the
-- default is the honest choice. Note the enum's members are
-- ingresado/verificado/en_bodega/asignado/en_carga/listo/en_ruta/entregado/
-- cancelado -- 'pendiente' is not one of them.
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('66666666-0000-4000-6000-000000000641','aaaaaaaa-0000-4000-a000-000000000640','ORD-641',
   'Cliente Uno','+56900000641','Calle Falsa 641','Providencia',CURRENT_DATE,
   'SPEC61-T7-FREE','Cliente A','{}'::jsonb,'MANUAL',NOW()),
  ('66666666-0000-4000-6000-000000000642','aaaaaaaa-0000-4000-a000-000000000640','ORD-642',
   'Cliente Dos','+56900000642','Calle Falsa 642','Providencia',CURRENT_DATE,
   'SPEC61-T7-ROUTED','Cliente A','{}'::jsonb,'MANUAL',NOW()),
  ('66666666-0000-4000-6000-000000000643','bbbbbbbb-0000-4000-b000-000000000640','ORD-643',
   'Cliente Tres','+56900000643','Calle Falsa 643','Providencia',CURRENT_DATE,
   'SPEC61-T7-OTHEROP','Cliente B','{}'::jsonb,'MANUAL',NOW());

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('77777777-0000-4000-7000-000000000641','aaaaaaaa-0000-4000-a000-000000000640',
        'PR-61-P','aaaaaaaa-0000-4000-a000-000000000641',
        '99999999-0000-4000-9000-000000000641','in_progress');

UPDATE public.manifests
   SET pickup_route_id = '77777777-0000-4000-7000-000000000641'
 WHERE operator_id = 'aaaaaaaa-0000-4000-a000-000000000640'
   AND external_load_id = 'SPEC61-T7-ROUTED';

-- ─── GUARD: TEST 1 assumes the connection role bypasses RLS ─────────────────
-- Copied in spirit from rls_operators_test.sql:75-88. TEST 1's cross-tenant
-- assertion only proves the function's own operator_id filter if RLS is NOT
-- doing that work. Pin the assumption: as the owner, with no claims at all, we
-- must be able to see both fixture operators. If this ever fails, TEST 1's
-- third assertion has silently become a test of RLS instead.
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('spec61-pending','spec61-pending-other');
  IF c <> 2 THEN
    RAISE EXCEPTION
      'owner context saw % of 2 fixture operators — TEST 1 assumes the connection role bypasses RLS and no longer proves the function''s own operator_id filter', c;
  END IF;
END $$;

-- ─── TEST 1 — owner context (RLS bypassed): the predicate itself ────────────
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-4000-a000-000000000641","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}';

DO $$
DECLARE loads TEXT[];
BEGIN
  SELECT array_agg(external_load_id ORDER BY external_load_id)
    INTO loads FROM public.get_pending_manifests();
  loads := COALESCE(loads, '{}');

  IF 'SPEC61-T7-ROUTED' = ANY(loads) THEN
    RAISE EXCEPTION 'a load already on a route must not be offered as available: %', loads;
  END IF;
  IF NOT ('SPEC61-T7-FREE' = ANY(loads)) THEN
    RAISE EXCEPTION 'an unrouted load must still be offered: %', loads;
  END IF;
  IF 'SPEC61-T7-OTHEROP' = ANY(loads) THEN
    RAISE EXCEPTION 'another operator''s load leaked into the pending list: %', loads;
  END IF;
END $$;

-- ─── TEST 2 — as `authenticated`, with RLS on ───────────────────────────────
DO $$
DECLARE loads TEXT[];
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000641","operator_id":"aaaaaaaa-0000-4000-a000-000000000640","role":"authenticated","claims":{"operator_id":"aaaaaaaa-0000-4000-a000-000000000640"}}', true);
  SET LOCAL role = 'authenticated';

  SELECT array_agg(external_load_id ORDER BY external_load_id)
    INTO loads FROM public.get_pending_manifests();
  loads := COALESCE(loads, '{}');

  IF 'SPEC61-T7-ROUTED' = ANY(loads) THEN
    RAISE EXCEPTION 'under RLS the routed load came back — the caller cannot SELECT the manifests row the exclusion subquery reads: %', loads;
  END IF;
  IF NOT ('SPEC61-T7-FREE' = ANY(loads)) THEN
    RAISE EXCEPTION 'under RLS a real authenticated caller sees no unrouted load at all: %', loads;
  END IF;
  RESET role;
END $$;
RESET role;

-- ─── TEST 3 — the return contract the frontend types against ────────────────
-- useManifests.ts's PendingManifest. The live risk this guards is CLAUDE.md's
-- CREATE OR REPLACE rule: templating on a pre-spec-53 definition drops
-- id/labels_printed_at/labels_printed_by_name and blanks the "Imprimir
-- etiquetas" button, with no test failing anywhere else.
DO $$
DECLARE v_cols TEXT;
BEGIN
  SELECT array_to_string(p.proargnames, ',') INTO v_cols
  FROM   pg_proc p
  WHERE  p.oid = 'public.get_pending_manifests()'::regprocedure;

  IF v_cols IS DISTINCT FROM
     'id,external_load_id,retailer_name,order_count,package_count,created_at,pickup_point,verified_count,labels_printed_at,labels_printed_by_name'
  THEN
    RAISE EXCEPTION 'get_pending_manifests no longer returns the spec-53 column set, got: %', v_cols;
  END IF;
END $$;

DO $$
DECLARE r RECORD; v_manifest_id UUID;
BEGIN
  SELECT m.id INTO v_manifest_id FROM public.manifests m
   WHERE m.operator_id = 'aaaaaaaa-0000-4000-a000-000000000640'
     AND m.external_load_id = 'SPEC61-T7-FREE';

  SELECT * INTO r FROM public.get_pending_manifests()
   WHERE external_load_id = 'SPEC61-T7-FREE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the unrouted load is missing from the result set entirely';
  END IF;

  -- IS DISTINCT FROM, not <>: a NULL id (the pre-20260814000001 lazy-manifest
  -- state, or a mis-wired column) makes `<>` evaluate to NULL and the IF never
  -- fires — the assertion would pass on exactly the defect it exists to catch.
  IF r.id IS DISTINCT FROM v_manifest_id THEN
    RAISE EXCEPTION 'id must be the manifests row id for the load: expected %, got %', v_manifest_id, r.id;
  END IF;

  -- There is deliberately NO verified_count assertion here. The plan's draft
  -- had `IF r.verified_count <> 0`, and an earlier revision of this file kept
  -- it as `IS DISTINCT FROM 0`. Both are dead: verified_count is
  -- COALESCE(...,0)::BIGINT, so it cannot be NULL, and this fixture seeds no
  -- pickup_scans, so it cannot be anything but 0 -- no plausible defect makes
  -- it fail. Real coverage would mean seeding a verified pickup_scan and
  -- asserting the count follows, which belongs to spec-53's tests, not to a
  -- test about which rows the exclusion predicate returns.
END $$;

ROLLBACK;
