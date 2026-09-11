-- pgTAP: spec-94 fase 1 — las cuatro RPC de Recogida particionan el espacio
-- de estados de manera exhaustiva y disjunta (docs/specs/spec-94-recogida-
-- cuatro-estados.md, "El modelo de estados").
--
-- La aserción es ASIGNACIÓN, no sólo partición: cada carga viva aparece en
-- la RPC que su predicado nombra, y en NINGUNA otra. "Exactamente una vez"
-- es un corolario, no una comprobación aparte -- una carga en la RPC
-- equivocada también pasaría un conteo global en verde.
--
-- Dos poblaciones, como exige la sección "La verificación" del spec:
--   * filas vivas de manifests (la mayoría del fixture);
--   * un external_load_id con órdenes vivas SIN fila de manifests
--     (CARGA-94-NOMANIFEST) -- la mitad del contrato de get_pending_manifests
--     que el LEFT JOIN existe para preservar.
--
-- Fixture (los seis casos que el spec exige por nombre, más los necesarios
-- para que cada rama de cada predicado sea falsificable):
--   CARGA-94-DOCK          cubo 2 -- cerrada en el andén, ruta in_progress
--   CARGA-94-INROUTE       cubo 2 -- sin cerrar, ruta in_progress
--   CARGA-94-DELETEDROUTE  cubo 2 -- ruta SOFT-DELETED (regresión CARGA-PARIS-001)
--   CARGA-94-AWAITING      cubo 3 -- reception_status='awaiting_reception'
--   CARGA-94-INPROGRESSRX  cubo 3 -- reception_status='reception_in_progress'
--   CARGA-94-RECEIVED      cubo 4 -- reception_status='received'
--   CARGA-94-OLDCLOSE      cubo 4 -- flujo viejo: completed, sin ruta, sin reception_status
--   CARGA-94-PENDING       cubo 1 -- caso base, nada seteado
--   CARGA-94-NOMANIFEST    cubo 1 -- fila de manifests borrada tras el trigger (arm1, id NULL)
--   CARGA-94-ORDERSDELETED cubo 1 -- fila de manifests viva, TODAS sus órdenes soft-deleted (arm2)
--   CARGA-94-CANCELLED     ninguno -- status='cancelled' CON reception_status
--                          seteado (espejo de QA-LOAD-004, seed-qa/scenarios/pickup.ts:42)
--   CARGA-94-CANCELLED-BARE ninguno -- status='cancelled' sin ruta ni reception_status:
--                          el único caso donde `status <> 'cancelled'` en el cubo 1 es lo
--                          único que la excluye (todo lo demás la dejaría pasar).

BEGIN;
SELECT plan(18);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000009400', 'Spec94 Op', 'spec94-op')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('00000000-0000-4000-8000-000000009401',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-94@spec94.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000009400"}'::jsonb,
   '{"full_name":"Crew 94"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-000000009406',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-94b@spec94.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000009400"}'::jsonb,
   '{"full_name":"Crew 94-B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009400','crew-94@spec94.test','Crew 94',ARRAY['pickup']),
  ('00000000-0000-4000-8000-000000009406','00000000-0000-4000-8000-000000009400','crew-94b@spec94.test','Crew 94-B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('00000000-0000-4000-8000-000000009402','00000000-0000-4000-8000-000000009400','SPEC94', true)
ON CONFLICT (id) DO NOTHING;

-- ── Rutas ────────────────────────────────────────────────────────────────────
-- ROUTE_DOCK/ROUTE_DELETED share driver 9401 with status='in_progress': the
-- partial unique index uniq_pickup_routes_one_active_per_driver only guards
-- deleted_at IS NULL rows, so a soft-deleted route never competes with it.
-- ROUTE_INROUTE needs a SECOND in_progress route -> a different driver.
-- ROUTE_AWAIT/ROUTE_INPROG_RX/ROUTE_RECEIVED are 'in_transit'/'received',
-- outside that index's status list, so they can reuse driver 9401 too.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, deleted_at)
VALUES
  ('00000000-0000-4000-8000-000000009410','00000000-0000-4000-8000-000000009400','PR-94-DOCK','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_progress', NULL),
  ('00000000-0000-4000-8000-000000009411','00000000-0000-4000-8000-000000009400','PR-94-INROUTE','00000000-0000-4000-8000-000000009406','00000000-0000-4000-8000-000000009402','in_progress', NULL),
  ('00000000-0000-4000-8000-000000009412','00000000-0000-4000-8000-000000009400','PR-94-DELETEDROUTE','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_progress', NOW()),
  ('00000000-0000-4000-8000-000000009413','00000000-0000-4000-8000-000000009400','PR-94-AWAIT','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_transit', NULL),
  ('00000000-0000-4000-8000-000000009414','00000000-0000-4000-8000-000000009400','PR-94-INPROGRESSRX','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_transit', NULL),
  ('00000000-0000-4000-8000-000000009415','00000000-0000-4000-8000-000000009400','PR-94-RECEIVED','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','received', NULL);

-- ── Órdenes (una por carga; trg_ensure_manifest_for_order crea la fila de
--    manifests automáticamente al insertar) ───────────────────────────────────
INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES
  ('00000000-0000-4000-8000-0000000094a0','00000000-0000-4000-8000-000000009400','ORD-94-0','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-DOCK','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a1','00000000-0000-4000-8000-000000009400','ORD-94-1','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-INROUTE','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a2','00000000-0000-4000-8000-000000009400','ORD-94-2','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-DELETEDROUTE','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a3','00000000-0000-4000-8000-000000009400','ORD-94-3','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-AWAITING','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a4','00000000-0000-4000-8000-000000009400','ORD-94-4','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-INPROGRESSRX','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a5','00000000-0000-4000-8000-000000009400','ORD-94-5','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-RECEIVED','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a6','00000000-0000-4000-8000-000000009400','ORD-94-6','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-OLDCLOSE','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a7','00000000-0000-4000-8000-000000009400','ORD-94-7','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-PENDING','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a8','00000000-0000-4000-8000-000000009400','ORD-94-8','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-NOMANIFEST','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094a9','00000000-0000-4000-8000-000000009400','ORD-94-9','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-ORDERSDELETED','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094aa','00000000-0000-4000-8000-000000009400','ORD-94-A','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-CANCELLED','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094ab','00000000-0000-4000-8000-000000009400','ORD-94-B','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-CANCELLED-BARE','Retailer 94','{}'::jsonb,'MANUAL',NOW());

-- ── Bultos (uno por carga; dos para CARGA-94-DOCK: uno se declara faltante) ──
INSERT INTO public.packages (id, operator_id, order_id, label, sku_items, raw_data)
VALUES
  ('00000000-0000-4000-8000-0000000094b0','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a0','CTN94-0','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094c0','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a0','CTN94-0B','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b1','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a1','CTN94-1','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b2','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a2','CTN94-2','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b3','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a3','CTN94-3','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b4','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a4','CTN94-4','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b5','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a5','CTN94-5','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b6','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a6','CTN94-6','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b7','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a7','CTN94-7','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b8','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a8','CTN94-8','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094b9','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094a9','CTN94-9','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094ba','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094aa','CTN94-A','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094bb','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094ab','CTN94-B','[]'::jsonb,'{}'::jsonb);

-- ── Ajustar cada manifests row al estado que su carga representa ─────────────
-- (trg_ensure_manifest_for_order ya creó la fila con status='pending' al
-- insertar la orden; el id es impredecible, por eso todo va por
-- operator_id + external_load_id.)
-- CARGA-94-DOCK: dos pasos, no uno. trg_manifest_set_reception_status
-- (20260318000001, todavía vivo -- nunca redefinido desde spec-08) es un
-- BEFORE UPDATE que auto-rellena reception_status='awaiting_reception' EN
-- CUALQUIER transición hacia status='completed' si reception_status venía
-- NULL, sin mirar pickup_route_id. close_manifest (20260916000001) no toca
-- reception_status en su propio UPDATE, así que ese trigger igual dispara.
-- Un solo UPDATE con status='completed' Y reception_status=NULL a la vez
-- nunca llega a guardar el NULL -- el trigger lo pisa antes de escribir.
-- Paso 1 deja reception_status en un valor no-nulo (cualquiera) para que la
-- guarda `IF NEW.reception_status IS NULL` del trigger no dispare; paso 2
-- lo vuelve a NULL con OLD.status ya en 'completed', así que la condición
-- externa del trigger (transición HACIA completed) ya no aplica.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009410',
  reception_status = 'reception_in_progress', -- placeholder, ver nota arriba
  total_orders = 1, total_packages = 2
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK';

UPDATE public.manifests SET reception_status = NULL
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK';

UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009411',
  reception_status = NULL,
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-INROUTE';

UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009412', -- ruta SOFT-DELETED
  reception_status = NULL,
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DELETEDROUTE';

UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009413',
  reception_status = 'awaiting_reception',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-AWAITING';

UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009414',
  reception_status = 'reception_in_progress',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-INPROGRESSRX';

UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009415',
  reception_status = 'received',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-RECEIVED';

-- CARGA-94-OLDCLOSE: mismo problema de trg_manifest_set_reception_status,
-- mismo arreglo en dos pasos -- ver la nota extensa junto a CARGA-94-DOCK.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = NULL,
  reception_status = 'reception_in_progress', -- placeholder
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-OLDCLOSE';

UPDATE public.manifests SET reception_status = NULL
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-OLDCLOSE';

-- CARGA-94-PENDING: se queda tal cual la creó el trigger (status='pending',
-- pickup_route_id NULL, reception_status NULL).

-- CARGA-94-NOMANIFEST: borrar la fila que el trigger creó -- simula el CARGA
-- que llega por un canal de ingesta que nunca dispara el flujo de escaneo.
DELETE FROM public.manifests
 WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-NOMANIFEST';

-- CARGA-94-ORDERSDELETED: la fila de manifests queda viva (pending); lo que
-- se borra es la ÚNICA orden de la carga.
UPDATE public.orders SET deleted_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-ORDERSDELETED';

UPDATE public.manifests SET
  status = 'cancelled',
  reception_status = 'awaiting_reception' -- espejo de QA-LOAD-004
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-CANCELLED';

UPDATE public.manifests SET
  status = 'cancelled',
  pickup_route_id = NULL,
  reception_status = NULL
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-CANCELLED-BARE';

-- ── Discrepancia + escaneo verificado sobre CARGA-94-DOCK, para probar que
--    missing_count/verified_count de get_routed_manifests leen datos reales,
--    no un COALESCE(...,0) de fachada. ─────────────────────────────────────
INSERT INTO public.discrepancies (
  operator_id, kind, operation_type, status, package_id, manifest_id, detected_by_user_id
) VALUES (
  '00000000-0000-4000-8000-000000009400', 'missing', 'pickup', 'open',
  '00000000-0000-4000-8000-0000000094b0',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK'),
  '00000000-0000-4000-8000-000000009401'
);

INSERT INTO public.pickup_scans (
  operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at
) VALUES (
  '00000000-0000-4000-8000-000000009400',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK'),
  '00000000-0000-4000-8000-0000000094c0', 'CTN94-0B', 'verified',
  '00000000-0000-4000-8000-000000009401', NOW()
);

-- Segundo escaneo, 'verified' pero con package_id NULL. No hay CHECK que lo
-- impida a nivel de esquema (los comentarios de get_routed_manifests dicen
-- "'not_found' siempre tiene package_id NULL, pero no vale apoyarse en eso
-- quedando implícito" -- este es exactamente el caso que hace esa guarda
-- falsificable: sin `package_id IS NOT NULL`, verified_count contaría esta
-- fila también y saldría 2, no 1.
INSERT INTO public.pickup_scans (
  operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at
) VALUES (
  '00000000-0000-4000-8000-000000009400',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK'),
  NULL, 'CTN94-GHOST', 'verified',
  '00000000-0000-4000-8000-000000009401', NOW()
);

-- ── Contexto: RLS ON, como en producción ─────────────────────────────────────
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009401","operator_id":"00000000-0000-4000-8000-000000009400","role":"authenticated"}',
  true
);
SET LOCAL role = 'authenticated';

CREATE TEMP TABLE t_pending   AS SELECT * FROM public.get_pending_manifests();
CREATE TEMP TABLE t_routed    AS SELECT * FROM public.get_routed_manifests();
CREATE TEMP TABLE t_transit   AS SELECT * FROM public.get_in_transit_manifests();
CREATE TEMP TABLE t_completed AS SELECT * FROM public.get_completed_manifests();

-- ── Asignación: cada carga en la RPC de su predicado, y en ninguna otra ──────
SELECT is(
  ARRAY[
    'CARGA-94-DOCK' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-DOCK' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-DOCK' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-DOCK' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, true, false, false],
  'CARGA-94-DOCK (cerrada en el andén, ruta in_progress): sólo en get_routed_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-INROUTE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-INROUTE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-INROUTE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-INROUTE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, true, false, false],
  'CARGA-94-INROUTE (sin cerrar, ruta in_progress): sólo en get_routed_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, true, false, false],
  'CARGA-94-DELETEDROUTE (ruta soft-deleted): SIGUE en get_routed_manifests -- LEFT JOIN con la condición en el ON, no en el WHERE (regresión CARGA-PARIS-001)'
);

SELECT is(
  ARRAY[
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-AWAITING (reception_status=awaiting_reception): sólo en get_in_transit_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-INPROGRESSRX (reception_status=reception_in_progress): sólo en get_in_transit_manifests -- prueba el segundo valor del IN(), no sólo el primero'
);

SELECT is(
  ARRAY[
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, true],
  'CARGA-94-RECEIVED (reception_status=received): sólo en get_completed_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-OLDCLOSE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-OLDCLOSE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-OLDCLOSE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-OLDCLOSE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, true],
  'CARGA-94-OLDCLOSE (flujo viejo: completed, sin ruta, sin reception_status): sólo en get_completed_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-PENDING' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-PENDING' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-PENDING' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-PENDING' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[true, false, false, false],
  'CARGA-94-PENDING (caso base): sólo en get_pending_manifests'
);

SELECT is(
  ARRAY[
    'CARGA-94-NOMANIFEST' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-NOMANIFEST' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-NOMANIFEST' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-NOMANIFEST' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[true, false, false, false],
  'CARGA-94-NOMANIFEST (órdenes vivas, SIN fila de manifests): sólo en get_pending_manifests (arm1, LEFT JOIN)'
);

SELECT is(
  ARRAY[
    'CARGA-94-ORDERSDELETED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-ORDERSDELETED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-ORDERSDELETED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-ORDERSDELETED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[true, false, false, false],
  'CARGA-94-ORDERSDELETED (fila de manifests viva, TODAS sus órdenes soft-deleted): sólo en get_pending_manifests (arm2, el brazo nuevo)'
);

SELECT is(
  ARRAY[
    'CARGA-94-CANCELLED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-CANCELLED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-CANCELLED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-CANCELLED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, false],
  'CARGA-94-CANCELLED (espejo QA-LOAD-004: cancelled + reception_status seteado): en NINGUNA de las cuatro'
);

SELECT is(
  ARRAY[
    'CARGA-94-CANCELLED-BARE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-CANCELLED-BARE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-CANCELLED-BARE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-CANCELLED-BARE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, false],
  'CARGA-94-CANCELLED-BARE (cancelled puro, sin ruta ni reception_status): en NINGUNA -- el único caso donde status<>''cancelled'' por sí solo excluye del cubo 1'
);

-- ── Contenido real de las columnas nuevas de get_routed_manifests ───────────
SELECT is(
  (SELECT (route_code, route_status, driver_name, missing_count, verified_count, closed_at IS NOT NULL)
     FROM t_routed WHERE external_load_id = 'CARGA-94-DOCK'),
  ('PR-94-DOCK'::text, 'in_progress'::text, 'Crew 94'::text, 1, 1::bigint, true),
  'CARGA-94-DOCK: route_code/route_status/driver_name vienen de la ruta real; missing_count=1 (la discrepancia abierta), verified_count=1 (el escaneo verified), closed_at poblado porque status=completed'
);

SELECT is(
  (SELECT (route_code, route_status, driver_name, closed_at)
     FROM t_routed WHERE external_load_id = 'CARGA-94-INROUTE'),
  ('PR-94-INROUTE'::text, 'in_progress'::text, 'Crew 94-B'::text, NULL::timestamptz),
  'CARGA-94-INROUTE: closed_at es NULL porque status<>completed (no chip de "cerrada" para una carga que sigue abierta)'
);

SELECT is(
  (SELECT (route_code, route_status, driver_name)
     FROM t_routed WHERE external_load_id = 'CARGA-94-DELETEDROUTE'),
  (NULL::text, NULL::text, NULL::text),
  'CARGA-94-DELETEDROUTE: route_code/route_status/driver_name salen NULL -- el LEFT JOIN sobrevive pero la fila de pickup_routes no calza (deleted_at IS NULL está en el ON)'
);

-- ── El contrato del brazo nuevo de get_pending_manifests ────────────────────
SELECT is(
  (SELECT (id IS NULL, order_count, package_count, pickup_point)
     FROM t_pending WHERE external_load_id = 'CARGA-94-NOMANIFEST'),
  (true, 1::bigint, 1::bigint, NULL::text),
  'CARGA-94-NOMANIFEST: id NULL (no hay fila de manifests todavía) pero order_count/package_count SÍ cuentan la orden viva -- viene del arm1 (orders-rooted)'
);

SELECT is(
  (SELECT (id IS NOT NULL, order_count, package_count, pickup_point)
     FROM t_pending WHERE external_load_id = 'CARGA-94-ORDERSDELETED'),
  (true, 0::bigint, 0::bigint, NULL::text),
  'CARGA-94-ORDERSDELETED: id SÍ presente (la fila de manifests vive) pero order_count/package_count son 0 -- viene del arm2 (manifest-rooted, sin ninguna orden viva que agrupar)'
);

-- ── Ámbito de operador, no de usuario firmado (spec-94: "el cubo nuevo es a
--    nivel de operador") -- get_routed_manifests debe devolver TODAS las
--    cargas ruteadas del operador, no sólo las de la ruta del usuario
--    firmado. El caller (crew-94, sub=...9401) lidera PR-94-DOCK y
--    PR-94-DELETEDROUTE, pero NO es driver ni crew de PR-94-INROUTE (esa
--    ruta es de crew-94b, sub=...9406) -- y aun así debe ver las tres.
--    get_my_active_pickup_route (spec-61), por contraste, sólo mostraría
--    las rutas del propio usuario; heredar ese alcance aquí reproduciría
--    el agujero que este spec cierra. ──────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM t_routed WHERE external_load_id IN ('CARGA-94-DOCK','CARGA-94-INROUTE','CARGA-94-DELETEDROUTE')),
  3,
  'get_routed_manifests ve las tres cargas ruteadas aunque ninguna comparta líder -- es de ámbito operador, no de usuario firmado'
);

SELECT * FROM finish();
ROLLBACK;
