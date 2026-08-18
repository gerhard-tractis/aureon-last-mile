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
-- Mobile in-flight state: active pickup route, scannable manifest, returns
-- =============================================================================
-- Three mobile screens render an empty state with nothing further to test
-- them against — no active pickup_routes row, no manifest a driver could
-- scan against, no packages sitting in retorno_hub:
--   /app/pickup/route/active   useActivePickupRoute.ts:28  — reads
--     pickup_routes WHERE driver_id = auth.uid() (the SIGNED-IN driver's own
--     id, not a row in the `drivers` table above) AND status = 'in_progress'.
--     "Yours" is decided entirely by driver_id = the caller's auth.uid(), so
--     this can only be seeded for a real auth user. The QA pickup_crew login
--     (qa-pickup-crew@qa.test) is created with the FIXED id
--     00000000-0000-4000-8000-000000000201 by create-qa-users.sh (see that
--     script's ROLE_ROWS) — that id is used as driver_id below. This seed
--     runs BEFORE create-qa-users.sh on a brand-new environment
--     (setup-qa.sh: migrations -> seed-qa.sql -> create-qa-users.sh), so the
--     pickup-route block is written as INSERT ... SELECT ... WHERE EXISTS
--     against public.users: it inserts nothing until that user exists, then
--     self-heals on the next deploy-qa.sh run (which reapplies this file on
--     every merge, but never re-runs create-qa-users.sh — see deploy-qa.sh).
--   /app/pickup/scan/[loadId]  — manifest reachable by external_load_id, spec-47
--     guards scanning on manifests.pickup_route_id pointing at an in_progress
--     route, so manifest B below (queued for scanning) is chained off the
--     same guard.
--   /app/reception "Retornos" tab  useReturnRoutes.ts / returnRouteResolution.ts
--     — groups packages.status = 'retorno_hub' by the route resolved through
--     dispatches.external_route_id (falling back to routes.external_route_id).
--     No return_receptions/route_receptions row is written here — the app
--     creates that session lazily via find_or_create_return_reception RPC.
--
-- pickup_routes.vehicle_id is NOT NULL (spec-52); a dedicated QA vehicle row
-- is inserted first, unconditionally, so it never blocks on the driver guard.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 8. QA pickup vehicle (pickup_routes.vehicle_id NOT NULL — 20260812000003)
-- ---------------------------------------------------------------------------
INSERT INTO public.vehicles (id, operator_id, plate, vehicle_type, active)
VALUES (
  '00000000-0000-4000-8000-000000000184',
  '00000000-0000-4000-8000-000000000001',
  'QA-PICKUP-01', 'van', TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Active pickup_routes row for the QA pickup_crew driver (spec-47/spec-52).
--    Guarded on the driver's public.users row existing — see header note.
-- ---------------------------------------------------------------------------
INSERT INTO public.pickup_routes (
  id, operator_id, code, driver_id, vehicle_id, status, started_at
)
SELECT
  '00000000-0000-4000-8000-000000000185',
  '00000000-0000-4000-8000-000000000001',
  'PR-QA-SEED-01',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000184',
  'in_progress',
  NOW() - INTERVAL '2 hours'
WHERE EXISTS (
  SELECT 1 FROM public.users
   WHERE id = '00000000-0000-4000-8000-000000000201'
     AND operator_id = '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. Three manifests on that route, in mixed verification states
--     (manifest_status_enum: pending|in_progress|completed|cancelled):
--       A — fully verified (2/2 packages scanned)
--       B — partially verified (2/3 scanned + 1 not_found) — also the
--           /app/pickup/scan/[loadId] target (external_load_id QA-CARGA-B)
--       C — total_packages IS NULL — exercises the "unknown total" path
-- ---------------------------------------------------------------------------
INSERT INTO public.manifests (
  id, operator_id, external_load_id, retailer_name, pickup_location,
  total_orders, total_packages, status, pickup_route_id, created_at
)
SELECT v.id, v.operator_id, v.external_load_id, v.retailer_name, v.pickup_location,
       v.total_orders, v.total_packages, v.status::manifest_status_enum,
       v.pickup_route_id, v.created_at
FROM (VALUES
  ('00000000-0000-4000-8000-000000000186'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-CARGA-A', 'QA Retail', 'QA Hub Bodega Central',
   1, 2, 'in_progress', '00000000-0000-4000-8000-000000000185'::uuid, NOW() - INTERVAL '2 hours'),
  ('00000000-0000-4000-8000-000000000187'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-CARGA-B', 'QA Retail', 'QA Hub Bodega Central',
   1, 3, 'in_progress', '00000000-0000-4000-8000-000000000185'::uuid, NOW() - INTERVAL '90 minutes'),
  ('00000000-0000-4000-8000-000000000188'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-CARGA-C', 'QA Retail', 'QA Hub Bodega Central',
   1, NULL, 'pending', '00000000-0000-4000-8000-000000000185'::uuid, NOW() - INTERVAL '30 minutes')
) AS v(id, operator_id, external_load_id, retailer_name, pickup_location,
       total_orders, total_packages, status, pickup_route_id, created_at)
WHERE EXISTS (
  SELECT 1 FROM public.pickup_routes WHERE id = '00000000-0000-4000-8000-000000000185'
)
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
SELECT v.id, v.operator_id, v.order_number, v.customer_name, v.customer_phone,
       v.delivery_address, v.comuna, v.delivery_date, v.retailer_name,
       v.status::order_status_enum, v.leading_status::order_status_enum,
       v.pickup_point_id, v.external_load_id, v.raw_data,
       v.imported_via::imported_via_enum, v.imported_at
FROM (VALUES
  ('00000000-0000-4000-8000-000000000189'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-ORD-PICKA-1', 'Cliente QA Carga A', '+56922222301',
   'Calle Falsa 201', 'Maipú', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120'::uuid,
   'QA-CARGA-A', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '3 hours'),
  ('00000000-0000-4000-8000-000000000190'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-ORD-PICKB-1', 'Cliente QA Carga B', '+56922222302',
   'Calle Falsa 202', 'Pudahuel', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120'::uuid,
   'QA-CARGA-B', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '2 hours'),
  ('00000000-0000-4000-8000-000000000191'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   'QA-ORD-PICKC-1', 'Cliente QA Carga C', '+56922222303',
   'Calle Falsa 203', 'Ñuñoa', CURRENT_DATE, 'QA Retail',
   'ingresado', 'ingresado', '00000000-0000-4000-8000-000000000120'::uuid,
   'QA-CARGA-C', '{"source": "seed-qa"}'::jsonb, 'MANUAL', NOW() - INTERVAL '1 hour')
) AS v(id, operator_id, order_number, customer_name, customer_phone,
       delivery_address, comuna, delivery_date, retailer_name,
       status, leading_status, pickup_point_id, external_load_id,
       raw_data, imported_via, imported_at)
WHERE EXISTS (
  SELECT 1 FROM public.pickup_routes WHERE id = '00000000-0000-4000-8000-000000000185'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Packages for those orders — A has 2 (both will be scanned verified),
--     B has 3 (2 scanned verified, 1 left unscanned), C has 1 (unscanned;
--     its manifest carries the NULL total_packages).
-- ---------------------------------------------------------------------------
INSERT INTO public.packages (
  id, operator_id, order_id, label, status, sku_items, raw_data
)
SELECT v.id, v.operator_id, v.order_id, v.label, v.status::package_status_enum,
       v.sku_items, v.raw_data
FROM (VALUES
  ('00000000-0000-4000-8000-000000000192'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000189'::uuid, 'QA-CARGA-A-1', 'ingresado',
   '[{"sku": "QA-SKU-A1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000193'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000189'::uuid, 'QA-CARGA-A-2', 'ingresado',
   '[{"sku": "QA-SKU-A2", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000194'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000190'::uuid, 'QA-CARGA-B-1', 'ingresado',
   '[{"sku": "QA-SKU-B1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000195'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000190'::uuid, 'QA-CARGA-B-2', 'ingresado',
   '[{"sku": "QA-SKU-B2", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000196'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000190'::uuid, 'QA-CARGA-B-3', 'ingresado',
   '[{"sku": "QA-SKU-B3", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb),
  ('00000000-0000-4000-8000-000000000197'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000191'::uuid, 'QA-CARGA-C-1', 'ingresado',
   '[{"sku": "QA-SKU-C1", "description": "Caja QA", "quantity": 1}]'::jsonb,
   '{"source": "seed-qa"}'::jsonb)
) AS v(id, operator_id, order_id, label, status, sku_items, raw_data)
WHERE EXISTS (
  SELECT 1 FROM public.pickup_routes WHERE id = '00000000-0000-4000-8000-000000000185'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. pickup_scans — manifest A fully verified (2/2), manifest B partially
--     verified (2/3) plus one not_found scan so the scan screen's history and
--     result card have real mixed content (scan_result_enum:
--     verified|not_found|duplicate). scanned_by_user_id left NULL: it is a
--     nullable FK to public.users and the driver row is already guarded for
--     above via pickup_routes — no need for a second guard here.
--     Each INSERT fires trg_pickup_scan_advance_status (20260812000002),
--     which advances the matched package to 'verificado' on first apply; a
--     later idempotent re-run hits ON CONFLICT DO NOTHING and does not refire.
-- ---------------------------------------------------------------------------
INSERT INTO public.pickup_scans (
  id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at
)
SELECT v.id, v.operator_id, v.manifest_id, v.package_id, v.barcode_scanned,
       v.scan_result::scan_result_enum, v.scanned_at
FROM (VALUES
  ('00000000-0000-4000-8000-000000000198'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000186'::uuid, '00000000-0000-4000-8000-000000000192'::uuid,
   'QA-CARGA-A-1', 'verified', NOW() - INTERVAL '110 minutes'),
  ('00000000-0000-4000-8000-000000000199'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000186'::uuid, '00000000-0000-4000-8000-000000000193'::uuid,
   'QA-CARGA-A-2', 'verified', NOW() - INTERVAL '108 minutes'),
  ('00000000-0000-4000-8000-000000000100'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000187'::uuid, '00000000-0000-4000-8000-000000000194'::uuid,
   'QA-CARGA-B-1', 'verified', NOW() - INTERVAL '80 minutes'),
  ('00000000-0000-4000-8000-000000000101'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000187'::uuid, '00000000-0000-4000-8000-000000000195'::uuid,
   'QA-CARGA-B-2', 'verified', NOW() - INTERVAL '78 minutes'),
  ('00000000-0000-4000-8000-000000000102'::uuid, '00000000-0000-4000-8000-000000000001'::uuid,
   '00000000-0000-4000-8000-000000000187'::uuid, NULL,
   'QA-CARGA-B-UNKNOWN', 'not_found', NOW() - INTERVAL '75 minutes')
) AS v(id, operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_at)
WHERE EXISTS (
  SELECT 1 FROM public.pickup_routes WHERE id = '00000000-0000-4000-8000-000000000185'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 14. Return route: routes + dispatches + packages in status = 'retorno_hub'
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

COMMIT;

-- Summary (visible in psql output when run with -a or via RAISE)
DO $$
BEGIN
  RAISE NOTICE 'seed-qa: operator=%, drivers=%, pickup_points=%, routes=%, orders=%, packages=%, dispatches=%, dock_zones=%',
    (SELECT count(*) FROM public.operators WHERE id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.drivers   WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.pickup_points WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.routes    WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.orders    WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.packages  WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.dispatches WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.dock_zones WHERE operator_id = '00000000-0000-4000-8000-000000000001');
  RAISE NOTICE 'seed-qa: vehicles=%, pickup_routes=%, manifests(pickup_route)=%, pickup_scans=%, retorno_hub packages=%',
    (SELECT count(*) FROM public.vehicles      WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.pickup_routes WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.manifests     WHERE operator_id = '00000000-0000-4000-8000-000000000001' AND pickup_route_id IS NOT NULL),
    (SELECT count(*) FROM public.pickup_scans  WHERE operator_id = '00000000-0000-4000-8000-000000000001'),
    (SELECT count(*) FROM public.packages      WHERE operator_id = '00000000-0000-4000-8000-000000000001' AND status = 'retorno_hub');
END $$;
