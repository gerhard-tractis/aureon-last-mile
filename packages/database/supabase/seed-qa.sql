-- =============================================================================
-- seed-qa.sql — QA-ONLY business dummy data (spec-48)
-- =============================================================================
-- Applied by infra/supabase-qa/setup-qa.sh AFTER apply-migrations.sh has
-- replayed every migration. Never referenced by config.toml and never applied
-- to production or local `supabase db reset` (that uses seed.sql).
--
-- Scope: business rows ONLY. No auth.users rows here — QA login users are
-- created via the GoTrue admin API by infra/supabase-qa/create-qa-users.sh
-- (the handle_new_user trigger then creates the matching public.users rows).
--
-- Idempotent: every INSERT uses ON CONFLICT DO NOTHING on a fixed primary key
-- or unique constraint, so re-running (e.g. on every QA re-deploy) is safe.
--
-- FIXED UUIDs: the QA operator id 00000000-0000-4000-8000-000000000001 is a
-- deliberate constant — create-qa-users.sh, the QA runbook, and QA test
-- scripts all reference it literally. Do not change it. All other entity ids
-- follow the 00000000-0000-4000-8000-0000000001xx pattern for the same reason
-- (stable, greppable, obviously fake, valid UUID v4 format).
--
-- Schema notes (derived from packages/database/supabase/migrations/):
--   operators                20260209000004 (name, slug UNIQUE, country_code)
--   drivers                  20260318000004 (fleet_type_enum own|external,
--                            driver_status_enum, phone NOT NULL,
--                            UNIQUE (operator_id, phone) / (operator_id, rut))
--   pickup_points            20260318000004 as `generators`, renamed by
--                            20260329000001; name/code/tenant_client_id made
--                            nullable by 20260428000005. There is NO `hubs`
--                            table in this schema — the operator's hub /
--                            origin location is modelled as a pickup_point.
--   routes                   20260306000001 (+ 'draft' status 20260324000001;
--                            UNIQUE (operator_id, provider, external_route_id))
--   orders                   20260217000003 + status pipeline 20260313000001/2
--                            (order_status_enum: ingresado..cancelado,
--                            + en_retorno/parcialmente_entregado 20260512000001)
--   packages                 20260217000003 + status 20260318000001
--                            (package_status_enum; UNIQUE (operator_id, label))
--   dispatches               20260306000001 (links routes<->orders,
--                            UNIQUE (operator_id, provider, external_dispatch_id))
--
-- Audit triggers fire on these inserts; audit_trigger_func COALESCEs a null
-- auth.uid() to the zero UUID, so running as postgres/service_role is safe.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. QA operator (fixed UUID — referenced by create-qa-users.sh and runbook)
-- ---------------------------------------------------------------------------
INSERT INTO public.operators (id, name, slug, country_code, is_active, settings)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'QA Test Operator',
  'qa-test-operator',
  'CL',
  TRUE,
  '{"branding": {"company_name": "QA Test Operator"}}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Two drivers (fleet_type_enum: 'own' | 'external')
-- ---------------------------------------------------------------------------
INSERT INTO public.drivers (
  id, operator_id, fleet_type, full_name, rut, phone, status, zones
) VALUES
  (
    '00000000-0000-4000-8000-000000000110',
    '00000000-0000-4000-8000-000000000001',
    'own',
    'QA Driver Uno',
    '11.111.111-1',
    '+56911111101',
    'active',
    '["Maipú", "Pudahuel"]'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000001',
    'external',
    'QA Driver Dos',
    '22.222.222-2',
    '+56911111102',
    'active',
    '["Ñuñoa", "Providencia"]'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. One hub location. The schema has no `hubs` table; the operator's hub /
--    origin depot is modelled as a pickup_point (ex-generators table).
--    tenant_client_id, name and code are nullable since 20260428000005.
-- ---------------------------------------------------------------------------
INSERT INTO public.pickup_points (
  id, operator_id, name, code, intake_method, is_active, pickup_locations
) VALUES (
  '00000000-0000-4000-8000-000000000120',
  '00000000-0000-4000-8000-000000000001',
  'QA Hub Bodega Central',
  'QA-HUB-01',
  'manual',
  TRUE,
  '[{"name": "QA Hub Bodega Central", "address": "Av. Testing 123", "comuna": "Pudahuel"}]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Two routes (route_status_enum: draft|planned|in_progress|completed|cancelled)
-- ---------------------------------------------------------------------------
INSERT INTO public.routes (
  id, operator_id, provider, external_route_id, route_date, driver_name,
  status, planned_stops, completed_stops, start_time, end_time
) VALUES
  (
    '00000000-0000-4000-8000-000000000130',
    '00000000-0000-4000-8000-000000000001',
    'dispatchtrack',
    'qa-route-001',
    CURRENT_DATE - 1,
    'QA Driver Uno',
    'completed',
    1, 1,
    (CURRENT_DATE - 1) + TIME '09:00',
    (CURRENT_DATE - 1) + TIME '13:30'
  ),
  (
    '00000000-0000-4000-8000-000000000131',
    '00000000-0000-4000-8000-000000000001',
    'dispatchtrack',
    'qa-route-002',
    CURRENT_DATE,
    'QA Driver Dos',
    'in_progress',
    1, 0,
    CURRENT_DATE + TIME '09:00',
    NULL
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Five orders across the status pipeline
--    (order_status_enum: ingresado, verificado, en_bodega, asignado, en_carga,
--     listo, en_ruta, entregado, cancelado, en_retorno, parcialmente_entregado)
-- ---------------------------------------------------------------------------
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, retailer_name,
  status, leading_status, pickup_point_id,
  raw_data, imported_via, imported_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000140',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-001', 'Cliente QA Uno', '+56922222201',
    'Calle Falsa 101, depto 1', 'Maipú', CURRENT_DATE - 1, 'QA Retail',
    'entregado', 'entregado', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000141',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-002', 'Cliente QA Dos', '+56922222202',
    'Calle Falsa 102', 'Pudahuel', CURRENT_DATE, 'QA Retail',
    'en_ruta', 'en_ruta', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '1 day'
  ),
  (
    '00000000-0000-4000-8000-000000000142',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-003', 'Cliente QA Tres', '+56922222203',
    'Calle Falsa 103', 'Ñuñoa', CURRENT_DATE + 1, 'QA Retail',
    'en_bodega', 'en_bodega', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'CSV', NOW() - INTERVAL '1 day'
  ),
  (
    '00000000-0000-4000-8000-000000000143',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-004', 'Cliente QA Cuatro', '+56922222204',
    'Calle Falsa 104', 'Providencia', CURRENT_DATE + 1, 'QA Retail',
    'verificado', 'verificado', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'CSV', NOW() - INTERVAL '12 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000144',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-005', 'Cliente QA Cinco', '+56922222205',
    'Calle Falsa 105', 'Santiago', CURRENT_DATE + 2, 'QA Retail',
    'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 hours'
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Packages — one per order, two for QA-ORD-001
--    (package_status_enum mirrors the order pipeline)
-- ---------------------------------------------------------------------------
INSERT INTO public.packages (
  id, operator_id, order_id, label, status, sku_items, raw_data
) VALUES
  (
    '00000000-0000-4000-8000-000000000150',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000140',
    'QA-CTN-001-1', 'entregado',
    '[{"sku": "QA-SKU-1", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000151',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000140',
    'QA-CTN-001-2', 'entregado',
    '[{"sku": "QA-SKU-2", "description": "Caja QA", "quantity": 2}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000152',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000141',
    'QA-CTN-002-1', 'en_ruta',
    '[{"sku": "QA-SKU-3", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000153',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000142',
    'QA-CTN-003-1', 'en_bodega',
    '[{"sku": "QA-SKU-4", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000154',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000143',
    'QA-CTN-004-1', 'verificado',
    '[{"sku": "QA-SKU-5", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000155',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000144',
    'QA-CTN-005-1', 'ingresado',
    '[{"sku": "QA-SKU-6", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Dispatches — link the routed orders to their routes
--    (dispatch_status_enum: pending|delivered|failed|partial)
-- ---------------------------------------------------------------------------
INSERT INTO public.dispatches (
  id, operator_id, route_id, order_id, provider, external_dispatch_id,
  status, planned_sequence, estimated_at, arrived_at, completed_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000160',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000130',
    '00000000-0000-4000-8000-000000000140',
    'dispatchtrack', 'qa-dispatch-001',
    'delivered', 1,
    (CURRENT_DATE - 1) + TIME '11:00',
    (CURRENT_DATE - 1) + TIME '10:50',
    (CURRENT_DATE - 1) + TIME '10:55'
  ),
  (
    '00000000-0000-4000-8000-000000000161',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000131',
    '00000000-0000-4000-8000-000000000141',
    'dispatchtrack', 'qa-dispatch-002',
    'pending', 1,
    CURRENT_DATE + TIME '12:00',
    NULL, NULL
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- dock_zones + dock_zone_comunas — the Distribución module's andenes
-- =============================================================================
-- Without these, Distribución and Modo rápido both render "Sin andenes
-- configurados" and none of the sorting flow can be exercised in QA. They were
-- simply never seeded: the deploy replayed migrations but seeding happened
-- only in setup-qa.sh, the one-time bootstrap, so QA showed an empty andén
-- grid from the day the module was built. deploy-qa.sh now applies this file
-- on every run too, so a new seed row reaches QA on the next merge.
--
-- Comunas are looked up by name from chile_comunas (seeded by the
-- 20260321000001 migration, not here) so the ids stay correct whatever the
-- reference data says. A comuna that is absent just yields no row rather than
-- failing the seed.
INSERT INTO public.dock_zones (id, operator_id, name, code, is_consolidation, is_active)
VALUES
  ('00000000-0000-4000-8000-000000000180', '00000000-0000-4000-8000-000000000001',
   'Sur Oriente',   'A1', false, true),
  ('00000000-0000-4000-8000-000000000181', '00000000-0000-4000-8000-000000000001',
   'Poniente',      'A2', false, true),
  ('00000000-0000-4000-8000-000000000182', '00000000-0000-4000-8000-000000000001',
   'Norte',         'A3', false, true),
  ('00000000-0000-4000-8000-000000000183', '00000000-0000-4000-8000-000000000001',
   'Consolidación', 'CO', true,  true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dock_zone_comunas (dock_zone_id, comuna_id)
SELECT z.zone_id, c.id
FROM (VALUES
    ('00000000-0000-4000-8000-000000000180'::uuid, 'La Florida'),
    ('00000000-0000-4000-8000-000000000180'::uuid, 'Puente Alto'),
    ('00000000-0000-4000-8000-000000000181'::uuid, 'Maipú'),
    ('00000000-0000-4000-8000-000000000181'::uuid, 'Pudahuel'),
    ('00000000-0000-4000-8000-000000000182'::uuid, 'Quilicura'),
    ('00000000-0000-4000-8000-000000000182'::uuid, 'Renca')
  ) AS z(zone_id, comuna_name)
JOIN public.chile_comunas c ON c.nombre = z.comuna_name
ON CONFLICT (dock_zone_id, comuna_id) DO NOTHING;

-- =============================================================================
-- load_positions — spec-71's posiciones de carga
-- =============================================================================
-- Without these, spec-71 does nothing observable: assign_load_position finds
-- no candidate, every route stays load_position_id NULL as a best-effort miss,
-- and the staging scan, the position seal and the move-task list all have
-- nothing to point at. The table shipped in 20260827000001 and no phase of
-- spec-71 ever creates a row -- andenes have the same gap and this file is
-- where they are solved, so positions are solved here too.
--
-- This tenant has no truck bays. A position is open floor in FRONT of the
-- andenes (Decision 6), so `label` names a floor spot, not a muelle.
--
-- fronts_dock_zone_id is set deliberately so the offset rule (Decision 7) has
-- something real to exclude against in QA: a route sourcing from A1 must not
-- be given POS-01, which stands in front of A1 and would block its face.
-- POS-04 fronts nothing -- an open lane, the always-safe fallback.
--
-- Known limit (spec-71 phase 3 review, finding 3): normalizeScanCode fixes
-- the DESTINATION code (this table's `code`), but package/manifest lookups
-- (`.eq('label', barcode)`) are still unnormalized -- QA's observed
-- corruption (`CARGA'PARIS'...`) was a package code, not a position or
-- dock_zone one. That hardware problem is not solved by this phase.
INSERT INTO public.load_positions (id, operator_id, code, label, fronts_dock_zone_id, is_active)
VALUES
  ('00000000-0000-4000-8000-000000000190', '00000000-0000-4000-8000-000000000001',
   'POS-01', 'Frente a Andén A1', '00000000-0000-4000-8000-000000000180', true),
  ('00000000-0000-4000-8000-000000000191', '00000000-0000-4000-8000-000000000001',
   'POS-02', 'Frente a Andén A2', '00000000-0000-4000-8000-000000000181', true),
  ('00000000-0000-4000-8000-000000000192', '00000000-0000-4000-8000-000000000001',
   'POS-03', 'Frente a Andén A3', '00000000-0000-4000-8000-000000000182', true),
  ('00000000-0000-4000-8000-000000000193', '00000000-0000-4000-8000-000000000001',
   'POS-04', 'Pasillo central',    NULL,                                   true)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Mobile in-flight state: pending manifests to route, and returns
-- =============================================================================
-- Two mobile screens render an empty state with nothing further to test them
-- against — no pending un-routed manifest, no packages sitting in
-- retorno_hub:
--   /app/pickup (3j "no active route")  useActivePickupRoute.ts:28 reads
--     pickup_routes WHERE driver_id = auth.uid() AND status = 'in_progress'.
--     The account that walks 3j through to "Iniciar ruta de recogida" is
--     qa-pickup-leader@qa.test (fixed id 00000000-0000-4000-8000-000000000207)
--     -- created only by create-qa-users.sh, which deploy-qa.sh never calls
--     (setup-qa.sh:195 is its one caller), so that account exists only after
--     someone runs it by hand on an already-bootstrapped VPS. See
--     docs/qa-environment.md for that instruction; it is not automatic.
--     qa-pickup-crew@qa.test (fixed id 00000000-0000-4000-8000-000000000201)
--     is the account for the "crew with no route" state — someone a leader
--     can add to their crew but who cannot start a route themself. THIS
--     requires a real SQL change here, below: spec-61 Task 2's backfill
--     (20260820000003 PART 1) promotes every pickup_crew row to
--     pickup_leader in the SAME migration that gates start_pickup_route() to
--     leaders -- necessary so no real account is ever refused, but it also
--     catches this fixture, since it already exists on any QA stack that was
--     bootstrapped before this migration lands. Left alone, …201 would stop
--     being able to demonstrate the crew state at all. The demotion below
--     undoes that promotion for this one fixture, every deploy (seed-qa.sql
--     runs on every deploy; the migration's backfill does not).
--     Both …201 and …207 need NO active pickup_routes row, which is exactly
--     what this seed already asserts below. A pre-opened route made 3j
--     permanently unreachable for the account it was built for (see PR/spec
--     discussion — the route INSERT that used to live here, id
--     00000000-0000-4000-8000-000000000185, was removed for exactly this
--     reason). start_pickup_route(p_vehicle_id)
--     (body: 20260812000003_spec52_pickup_routes_vehicle.sql:138) validates
--     the vehicle is operator-owned, non-deleted and active — the QA vehicle
--     below (id …184) satisfies all three, so 3j's selector has something
--     real to choose.
--
--     Demotion: idempotent (WHERE role = 'pickup_leader' is a no-op once
--     applied), and a no-op on a fresh stack too (this UPDATE runs before
--     create-qa-users.sh in setup-qa.sh, so …201 does not exist yet there --
--     it is created straight as pickup_crew and this backfill never sees it,
--     since 20260820000003 has already run by then).
UPDATE public.users
   SET role = 'pickup_crew'
 WHERE id = '00000000-0000-4000-8000-000000000201'
   AND role = 'pickup_leader';
--   /app/pickup 3j's grouped pending list + /app/pickup/scan/[loadId]
--     get_pending_manifests() (latest def: 20260820000006) returns every
--     external_load_id with orders that are not deleted and whose manifest
--     row (if any) is not 'completed', has no reception_status set, and —
--     since spec-61 Task 7 — has no pickup_route_id. Routing state now DOES
--     decide this query: a load already attached to a route is somebody
--     else's trip, not something you can still claim. Manifests A/B/C below
--     are left completely unrouted (pickup_route_id NULL, status 'pending')
--     so all three surface as pending, un-routed loads for the driver to
--     pick up through the UI. Leaving any of them routed would empty 3j.
--   /app/reception "Retornos" tab  useReturnRoutes.ts / returnRouteResolution.ts
--     — groups packages.status = 'retorno_hub' by the route resolved through
--     dispatches.external_route_id (falling back to routes.external_route_id).
--     No return_receptions/route_receptions row is written here — the app
--     creates that session lazily via find_or_create_return_reception RPC.
--
-- No pickup_scans are seeded for A/B/C either (previously A had 2/2 verified
-- scans, B had 2/3 + one not_found). trg_pickup_scan_advance_status
-- (20260812000002) advances the SCANNED PACKAGE to 'verificado' on a verified
-- pickup_scans insert, but nothing advances the MANIFEST — get_pending_manifests
-- never filters on package status, only on manifest status/reception_status
-- (see above), so the scans were not the reason the loads would vanish from
-- 3j. They were removed anyway: a manifest with mixed scan history but no
-- route is incoherent data (partial progress toward a trip that, per the
-- app's own model, never started), and starting all three loads clean and
-- untouched matches what a driver would actually see the first time they open
-- 3j on a fresh QA environment.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 8. QA pickup vehicle (pickup_routes.vehicle_id NOT NULL — 20260812000003).
--    KEPT: 3j's vehicle selector and start_pickup_route(UUID) both need an
--    operator-owned, non-deleted, active vehicle to exist.
-- ---------------------------------------------------------------------------
INSERT INTO public.vehicles (id, operator_id, plate, vehicle_type, active)
VALUES (
  '00000000-0000-4000-8000-000000000184',
  '00000000-0000-4000-8000-000000000001',
  'QA-PICKUP-01', 'van', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Cleanup for a QA database seeded BEFORE this change (id-scoped, additive
--    ON CONFLICT DO NOTHING elsewhere in this file cannot remove a row it
--    already inserted on a prior deploy). Every statement below targets only
--    the fixed ids this file itself owns, is safe to run every deploy
--    (no-ops once applied), and never touches a route/scan/status a human
--    created by hand while testing:
--      a) drop the 5 pickup_scans this file used to seed on A/B (by fixed id)
--      b) reset the 6 packages those scans had advanced back to 'ingresado'
--         (by fixed id) so no load carries a half-scanned history
--      c) detach manifests A/B/C from the old route and put them back to
--         'pending' (by fixed id)
--      d) delete the pre-opened pickup_routes row itself (by fixed id) —
--         only now safe, since (c) already dropped the FK reference to it
--    On a brand-new QA (nothing to clean) every statement affects 0 rows.
-- ---------------------------------------------------------------------------
-- MUST NOT TOUCH A TESTER'S WORK. Every statement below is scoped to this
-- file's own fixed ids, and the two UPDATEs are additionally scoped to state
-- only the seed could have produced: the manifests are reset only while they
-- still point at the seeded route, and a package is reverted only when no
-- surviving verified scan explains its status. A route started from the app
-- gets a fresh uuid and its manifests a different pickup_route_id, so this
-- block leaves them alone. Widening either scope would silently undo a
-- tester's progress on the next deploy, and this runs on every deploy.
DELETE FROM public.pickup_scans WHERE id IN (
  '00000000-0000-4000-8000-000000000198',
  '00000000-0000-4000-8000-000000000199',
  '00000000-0000-4000-8000-000000000100',
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000102'
);

-- Only undo the status the SEEDED scans caused. A package a tester scanned
-- through the app still has its own pickup_scans row (a fresh uuid, not one
-- of the five deleted above), so NOT EXISTS leaves it alone.
UPDATE public.packages p SET status = 'ingresado', status_updated_at = NOW()
 WHERE p.id IN (
  '00000000-0000-4000-8000-000000000192',
  '00000000-0000-4000-8000-000000000193',
  '00000000-0000-4000-8000-000000000194',
  '00000000-0000-4000-8000-000000000195',
  '00000000-0000-4000-8000-000000000196',
  '00000000-0000-4000-8000-000000000197'
 )
 AND p.status <> 'ingresado'
 AND NOT EXISTS (
   SELECT 1 FROM public.pickup_scans s
    WHERE s.package_id = p.id
      AND s.scan_result = 'verified'
      AND s.deleted_at IS NULL
 );

-- reception_status is cleared alongside pickup_route_id, not left behind.
-- spec47_migration_invariants.sql asserts that a manifest carrying a
-- reception_status always has a pickup_route_id, so detaching one while
-- leaving the other set breaks that invariant. The seed never sets
-- reception_status itself, but a tester who opened a reception against the
-- seeded route does -- and then this block detaches the manifest under it on
-- the next deploy. Clearing both keeps the pair consistent either way.
UPDATE public.manifests
   SET pickup_route_id = NULL, status = 'pending', reception_status = NULL
 WHERE id IN (
  '00000000-0000-4000-8000-000000000186',
  '00000000-0000-4000-8000-000000000187',
  '00000000-0000-4000-8000-000000000188'
 )
 AND pickup_route_id = '00000000-0000-4000-8000-000000000185';

DELETE FROM public.pickup_routes WHERE id = '00000000-0000-4000-8000-000000000185';

-- ---------------------------------------------------------------------------
-- 10. Three manifests, all pending and UNROUTED (pickup_route_id NULL) —
--     3j's grouped list groups by external_load_id, not by route, so these
--     appear the moment their matching orders (step 11) exist.
--       A/B — total_packages known (2 and 3)
--       C — total_packages IS NULL — exercises the "unknown total" path
-- ---------------------------------------------------------------------------
INSERT INTO public.manifests (
  id, operator_id, external_load_id, retailer_name, pickup_location,
  total_orders, total_packages, status, pickup_route_id, created_at
)
VALUES
  ('00000000-0000-4000-8000-000000000186', '00000000-0000-4000-8000-000000000001',
   'QA-CARGA-A', 'QA Retail', 'QA Hub Bodega Central',
   1, 2, 'pending', NULL, NOW() - INTERVAL '2 hours'),
  ('00000000-0000-4000-8000-000000000187', '00000000-0000-4000-8000-000000000001',
   'QA-CARGA-B', 'QA Retail', 'QA Hub Bodega Central',
   1, 3, 'pending', NULL, NOW() - INTERVAL '90 minutes'),
  ('00000000-0000-4000-8000-000000000188', '00000000-0000-4000-8000-000000000001',
   'QA-CARGA-C', 'QA Retail', 'QA Hub Bodega Central',
   1, NULL, 'pending', NULL, NOW() - INTERVAL '30 minutes')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. One order per manifest, matched by external_load_id
--     (useManifestOrders.ts joins orders.external_load_id = manifests.external_load_id)
-- ---------------------------------------------------------------------------
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, retailer_name,
  status, leading_status, pickup_point_id, external_load_id,
  raw_data, imported_via, imported_at
)
VALUES
  ('00000000-0000-4000-8000-000000000189', '00000000-0000-4000-8000-000000000001',
   'QA-ORD-PICKA-1', 'Cliente QA Carga A', '+56922222301',
   'Calle Falsa 201', 'Maipú', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120',
   'QA-CARGA-A', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '3 hours'),
  ('00000000-0000-4000-8000-000000000190', '00000000-0000-4000-8000-000000000001',
   'QA-ORD-PICKB-1', 'Cliente QA Carga B', '+56922222302',
   'Calle Falsa 202', 'Pudahuel', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120',
   'QA-CARGA-B', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 hours'),
  ('00000000-0000-4000-8000-000000000191', '00000000-0000-4000-8000-000000000001',
   'QA-ORD-PICKC-1', 'Cliente QA Carga C', '+56922222303',
   'Calle Falsa 203', 'Ñuñoa', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120',
   'QA-CARGA-C', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Packages for those orders — A has 2, B has 3, C has 1 (its manifest
--     carries the NULL total_packages). All start 'ingresado': unscanned.
-- ---------------------------------------------------------------------------
INSERT INTO public.packages (
  id, operator_id, order_id, label, status, sku_items, raw_data
)
VALUES
  ('00000000-0000-4000-8000-000000000192', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000189', 'QA-CARGA-A-1', 'ingresado',
   '[{"sku": "QA-SKU-A1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000193', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000189', 'QA-CARGA-A-2', 'ingresado',
   '[{"sku": "QA-SKU-A2", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000194', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000190', 'QA-CARGA-B-1', 'ingresado',
   '[{"sku": "QA-SKU-B1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000195', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000190', 'QA-CARGA-B-2', 'ingresado',
   '[{"sku": "QA-SKU-B2", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000196', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000190', 'QA-CARGA-B-3', 'ingresado',
   '[{"sku": "QA-SKU-B3", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000197', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000191', 'QA-CARGA-C-1', 'ingresado',
   '[{"sku": "QA-SKU-C1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. Return route: routes + dispatches + packages in status = 'retorno_hub'
--     for the /app/reception "Retornos" tab. useReturnRoutes.ts groups
--     retorno_hub packages by the route resolved through
--     returnRouteResolution.ts (dispatches.external_route_id, falling back to
--     routes.external_route_id). No auth-user FK here, so unconditional.
--     return_reason values are the real set (see packages/database/seed-qa/
--     scenarios/journeys.ts, which drives process_failed_delivery with
--     'Cliente ausente'). recalculate_order_status (20260313000003, latest
--     def 20260810000001) fires AFTER INSERT on packages and immediately
--     recomputes each order's status from this single retorno_hub package to
--     'en_retorno' — the literal 'en_retorno' below is what that trigger is
--     expected to (re)confirm, not a value fought over with it.
-- ---------------------------------------------------------------------------
INSERT INTO public.routes (
  id, operator_id, provider, external_route_id, route_date, driver_name,
  status, planned_stops, completed_stops, start_time, end_time
) VALUES (
  '00000000-0000-4000-8000-000000000103',
  '00000000-0000-4000-8000-000000000001',
  'dispatchtrack', 'QA-RET-ROUTE-01', CURRENT_DATE - 2, 'QA Return Driver',
  'completed', 4, 4,
  (CURRENT_DATE - 2) + TIME '09:00', (CURRENT_DATE - 2) + TIME '15:00'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, retailer_name,
  status, leading_status, pickup_point_id,
  raw_data, imported_via, imported_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000104',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-RET-001', 'Cliente QA Retorno Uno', '+56922222401',
    'Calle Falsa 301', 'Maipú', CURRENT_DATE - 2, 'QA Retail',
    'en_retorno', 'en_retorno', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000105',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-RET-002', 'Cliente QA Retorno Dos', '+56922222402',
    'Calle Falsa 302', 'Pudahuel', CURRENT_DATE - 2, 'QA Retail',
    'en_retorno', 'en_retorno', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000106',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-RET-003', 'Cliente QA Retorno Tres', '+56922222403',
    'Calle Falsa 303', 'Ñuñoa', CURRENT_DATE - 2, 'QA Retail',
    'en_retorno', 'en_retorno', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000107',
    '00000000-0000-4000-8000-000000000001',
    'QA-ORD-RET-004', 'Cliente QA Retorno Cuatro', '+56922222404',
    'Calle Falsa 304', 'Providencia', CURRENT_DATE - 2, 'QA Retail',
    'en_retorno', 'en_retorno', '00000000-0000-4000-8000-000000000120',
    '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 days'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.packages (
  id, operator_id, order_id, label, status, return_reason, status_updated_at,
  sku_items, raw_data
) VALUES
  (
    '00000000-0000-4000-8000-000000000108',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000104',
    'QA-CTN-RET-001', 'retorno_hub', 'Cliente ausente', NOW() - INTERVAL '1 day',
    '[{"sku": "QA-SKU-RET1", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000109',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000105',
    'QA-CTN-RET-002', 'retorno_hub', 'Dirección incorrecta', NOW() - INTERVAL '20 hours',
    '[{"sku": "QA-SKU-RET2", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000112',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000106',
    'QA-CTN-RET-003', 'retorno_hub', 'Rechazado por el cliente', NOW() - INTERVAL '10 hours',
    '[{"sku": "QA-SKU-RET3", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000113',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000107',
    'QA-CTN-RET-004', 'retorno_hub', 'Zona sin acceso', NOW() - INTERVAL '5 hours',
    '[{"sku": "QA-SKU-RET4", "description": "Caja QA", "quantity": 1}]'::jsonb,
    '{"source": "seed-qa"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.dispatches (
  id, operator_id, route_id, order_id, provider, external_dispatch_id,
  external_route_id, status, planned_sequence, estimated_at, arrived_at, completed_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000114',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000104',
    'dispatchtrack', 'qa-dispatch-ret-001', 'QA-RET-ROUTE-01',
    'failed', 1,
    (CURRENT_DATE - 2) + TIME '10:00', (CURRENT_DATE - 2) + TIME '10:05', (CURRENT_DATE - 2) + TIME '10:10'
  ),
  (
    '00000000-0000-4000-8000-000000000115',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000105',
    'dispatchtrack', 'qa-dispatch-ret-002', 'QA-RET-ROUTE-01',
    'failed', 2,
    (CURRENT_DATE - 2) + TIME '10:30', (CURRENT_DATE - 2) + TIME '10:35', (CURRENT_DATE - 2) + TIME '10:40'
  ),
  (
    '00000000-0000-4000-8000-000000000116',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000106',
    'dispatchtrack', 'qa-dispatch-ret-003', 'QA-RET-ROUTE-01',
    'failed', 3,
    (CURRENT_DATE - 2) + TIME '11:00', (CURRENT_DATE - 2) + TIME '11:05', (CURRENT_DATE - 2) + TIME '11:10'
  ),
  (
    '00000000-0000-4000-8000-000000000117',
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000103',
    '00000000-0000-4000-8000-000000000107',
    'dispatchtrack', 'qa-dispatch-ret-004', 'QA-RET-ROUTE-01',
    'failed', 4,
    (CURRENT_DATE - 2) + TIME '11:30', (CURRENT_DATE - 2) + TIME '11:35', (CURRENT_DATE - 2) + TIME '11:40'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- fleet_vehicles — a vehicle Despacho can actually assign
-- =============================================================================
-- The Despacho route builder's vehicle dropdown reads fleet_vehicles (the
-- DispatchTrack mirror), not the operator-managed `vehicles` table Recogida
-- uses. Nothing seeds fleet_vehicles, and QA receives no DispatchTrack
-- webhooks, so the dropdown was empty for Transportes Musan and no route could
-- be dispatched. One dummy plate is enough to exercise the flow.
--
-- Musan's id is gen_random_uuid() in migration 20260223000001, so it differs
-- per environment and must be resolved by slug, never hardcoded. If the
-- operator is absent the SELECT yields no row and the seed simply skips it.
--
-- The route builder shows and submits external_vehicle_id (as
-- routes.truck_identifier), so it carries the plate; plate_number repeats it
-- for anything reading the plate column.
INSERT INTO public.fleet_vehicles (
  id, operator_id, provider, external_vehicle_id, plate_number, vehicle_type, driver_name
)
SELECT
  '00000000-0000-4000-8000-000000000220',
  o.id,
  'dispatchtrack'::routing_provider_enum,
  'JPRG26',
  'JPRG26',
  'Furgón',
  NULL
FROM public.operators o
WHERE o.slug = 'transportes-musan' AND o.deleted_at IS NULL
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- fleet_vehicles — the QA test operator's own trucks
-- =============================================================================
-- QA finding #4: every one of the 27 fleet_vehicles rows on QA belongs to
-- Musan — cfea91ec-5e48-43f7-b756-45759715df10 as read directly off the live
-- QA database at the time this was written, NOT a value to hardcode or trust
-- going forward: per the warning two sections up, Musan's id is
-- gen_random_uuid() and differs per environment, which is exactly why the
-- row above resolves it by slug instead. The QA test operator
-- 00000000-0000-4000-8000-000000000001 had zero. The route
-- builder's truck <select> reads fleet_vehicles scoped to the session's own
-- operator_id (see apps/frontend/src/app/app/dispatch/[routeId]/page.tsx),
-- so it was always empty for QA and "Despachar a DispatchTrack" could never
-- enable — nobody had ever exercised the dispatch step against QA.
--
-- Collision safety: the DispatchTrack webhook sync
-- (apps/worker/n8n/workflows/paris-dispatchtrack-webhook.json) upserts on
-- `on_conflict=operator_id,provider,external_vehicle_id` — matching this
-- table's own `unique_vehicle_per_operator` constraint — but it always
-- writes the hardcoded Musan operator id, never the QA test operator's. A
-- webhook upsert therefore can never match, and so can never clobber, a row
-- seeded under 00000000-0000-4000-8000-000000000001: the operator_id half of
-- the conflict target can't agree. Fixed ids in the same
-- 00000000-0000-4000-8000-0000000002xx family the QA users use (see the
-- pickup-crew/pickup-leader ids above), one per plate.
INSERT INTO public.fleet_vehicles (
  id, operator_id, provider, external_vehicle_id, plate_number, vehicle_type, driver_name
)
VALUES
  ('00000000-0000-4000-8000-000000000230', '00000000-0000-4000-8000-000000000001',
   'dispatchtrack'::routing_provider_enum, 'QA-TRUCK-01', 'QATR01', 'Furgón', NULL),
  ('00000000-0000-4000-8000-000000000231', '00000000-0000-4000-8000-000000000001',
   'dispatchtrack'::routing_provider_enum, 'QA-TRUCK-02', 'QATR02', 'Camión', NULL)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Re-anchor the dated fixtures to today
-- =============================================================================
-- Every INSERT above computes its dates from CURRENT_DATE, and every INSERT is
-- ON CONFLICT (id) DO NOTHING. Both are right on the day QA is first seeded and
-- wrong on every day after: the rows keep the date they were created with, and
-- re-running the seed cannot correct them because the conflict clause skips the
-- row entirely. QA fixtures therefore age out of every date-scoped screen —
-- on 2026-08-21 the Pre-Ruta board returned 0 orders for today and 5 for
-- 2026-08-11, the day the environment happened to be seeded.
--
-- So shift them instead of re-inserting them. The shift is a whole number of
-- days applied uniformly per cohort, which preserves the relative spread the
-- fixtures encode (QA-ORD-001 yesterday, -003 tomorrow, -005 in two days) —
-- pinning every row to CURRENT_DATE would flatten exactly the spread the
-- date-range screens exist to show.
--
--   baseline cohort   ids 00000000-0000-4000-8000-…, seeded by this file.
--                     Anchor: QA-ORD-002 (…141), the one order written as
--                     plain CURRENT_DATE, so today minus its date IS the drift.
--   generated cohort  ids 00000000-0000-4000-9000-…, from the seed-qa TS
--                     generator, which stamps every order with the same
--                     new Date() — so its latest date is that cohort's anchor.
--
-- Rows outside those two id ranges are left alone: anything a tester created by
-- hand in QA is not a fixture and must not be moved under them.
--
-- Idempotent: a second run computes a delta of 0 and skips.
DO $$
DECLARE
  v_delta integer;
BEGIN
  -- ── baseline cohort ──────────────────────────────────────────────────────
  SELECT CURRENT_DATE - delivery_date INTO v_delta
    FROM public.orders
   WHERE id = '00000000-0000-4000-8000-000000000141';

  IF COALESCE(v_delta, 0) <> 0 THEN
    UPDATE public.orders
       SET delivery_date         = delivery_date + v_delta,
           delivery_window_start = delivery_window_start + make_interval(days => v_delta),
           delivery_window_end   = delivery_window_end   + make_interval(days => v_delta)
     WHERE id::text LIKE '00000000-0000-4000-8000-%';

    UPDATE public.routes
       SET route_date = route_date + v_delta
     WHERE id::text LIKE '00000000-0000-4000-8000-%';

    UPDATE public.dispatches
       SET estimated_at = estimated_at + make_interval(days => v_delta),
           arrived_at   = arrived_at   + make_interval(days => v_delta),
           completed_at = completed_at + make_interval(days => v_delta)
     WHERE id::text LIKE '00000000-0000-4000-8000-%';

    RAISE NOTICE 'seed-qa: baseline fixtures rolled forward % day(s)', v_delta;
  END IF;

  -- ── generated cohort ─────────────────────────────────────────────────────
  SELECT CURRENT_DATE - max(delivery_date) INTO v_delta
    FROM public.orders
   WHERE id::text LIKE '00000000-0000-4000-9000-%';

  IF COALESCE(v_delta, 0) <> 0 THEN
    UPDATE public.orders
       SET delivery_date         = delivery_date + v_delta,
           delivery_window_start = delivery_window_start + make_interval(days => v_delta),
           delivery_window_end   = delivery_window_end   + make_interval(days => v_delta)
     WHERE id::text LIKE '00000000-0000-4000-9000-%';

    UPDATE public.routes
       SET route_date = route_date + v_delta
     WHERE id::text LIKE '00000000-0000-4000-9000-%';

    UPDATE public.dispatches
       SET estimated_at = estimated_at + make_interval(days => v_delta),
           arrived_at   = arrived_at   + make_interval(days => v_delta),
           completed_at = completed_at + make_interval(days => v_delta)
     WHERE id::text LIKE '00000000-0000-4000-9000-%';

    RAISE NOTICE 'seed-qa: generated fixtures rolled forward % day(s)', v_delta;
  END IF;
END $$;

COMMIT;

-- Summary (visible in psql output when run with -a or via RAISE)
DO $$
BEGIN
  RAISE NOTICE 'seed-qa: operator=%, drivers=%, pickup_points=%, routes=%, orders=%, packages=%, dispatches=%, dock_zones=%, load_positions=%',
    (SELECT count(*) FROM public.operators WHERE id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.drivers   WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.pickup_points WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.routes    WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.orders    WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.packages  WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.dispatches WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.dock_zones WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.load_positions WHERE operator_id = '00000000-0000-4000-8000-000000000001');
  -- pickup_routes should read 0 here: the QA pickup_crew driver must land on
  -- 3j (no active route) and start one through the UI (spec-54). unrouted
  -- pending manifests should read 3 (QA-CARGA-A/B/C, pickup_route_id NULL) —
  -- that's what makes them visible in 3j's grouped list via
  -- get_pending_manifests(). pickup_scans should read 0: none are seeded for
  -- those loads, on purpose (see "Mobile in-flight state" note above).
  RAISE NOTICE 'seed-qa: vehicles=%, pickup_routes(active)=%, unrouted pending pickup manifests=%, pickup_scans=%, retorno_hub packages=%',
    (SELECT count(*) FROM public.vehicles      WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.pickup_routes WHERE operator_id = '00000000-0000-4000-8000-000000000001' AND status = 'in_progress' AND deleted_at IS NULL),
    (SELECT count(*) FROM public.manifests     WHERE operator_id = '00000000-0000-4000-8000-000000000001' AND external_load_id IN ('QA-CARGA-A','QA-CARGA-B','QA-CARGA-C') AND pickup_route_id IS NULL),
    (SELECT count(*) FROM public.pickup_scans  WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.packages      WHERE operator_id = '00000000-0000-4000-8000-000000000001' AND status = 'retorno_hub');
  -- QA finding #4: fleet_vehicles (the Despacho truck <select>'s own table,
  -- distinct from `vehicles` above) should read 2 for the QA operator, not 0.
  RAISE NOTICE 'seed-qa: fleet_vehicles(QA operator)=%',
    (SELECT count(*) FROM public.fleet_vehicles WHERE operator_id = '00000000-0000-4000-8000-000000000001');
END $$;
