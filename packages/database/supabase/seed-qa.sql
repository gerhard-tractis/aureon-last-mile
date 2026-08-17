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
-- simply never seeded — the sync only replays migrations, it does not seed, so
-- QA has shown an empty andén grid since the module was built.
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
END $$;
