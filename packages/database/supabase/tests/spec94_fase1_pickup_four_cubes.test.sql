-- pgTAP: spec-94 fase 1 (ronda 3, "manda la ruta") — las cuatro RPC de
-- Recogida particionan el espacio de estados de manera exhaustiva y
-- disjunta (docs/specs/spec-94-recogida-cuatro-estados.md, "El modelo de
-- estados" y "Por qué manda la ruta, y no status ni reception_status").
--
-- La aserción es ASIGNACIÓN, no sólo partición: cada carga viva aparece en
-- la RPC que su predicado nombra, y en NINGUNA otra.
--
-- Dos poblaciones, como exige la sección "La verificación" del spec:
--   * filas vivas de manifests (la mayoría del fixture);
--   * un external_load_id con órdenes vivas SIN fila de manifests
--     (CARGA-94-NOMANIFEST).
--
-- EL TEST QUE PRUEBA EL MODELO NUEVO (ronda 3): CARGA-94-DOCK se cierra con
-- un UPDATE de un solo paso (status='completed', pickup_route_id=ruta
-- in_progress). trg_manifest_reception_status auto-rellena
-- reception_status='awaiting_reception' -- exactamente lo que produce en
-- producción, no un artefacto del fixture. Bajo el modelo viejo (ronda 2,
-- que miraba reception_status) esa carga habría caído en el cubo 3
-- ("Camino a bodega") con el camión todavía en el andén -- la mentira que
-- esta ronda corrige. CARGA-94-TRANSIT y CARGA-94-RXRECEIVED repiten la
-- MISMA forma (reception_status='awaiting_reception', vía el mismo
-- trigger) pero con la ruta en 'in_transit'/'received' -- si el modelo
-- mirara reception_status en vez de la ruta, las tres caerían en el mismo
-- cubo. Que caigan en cubos distintos es lo que prueba que manda la ruta.
--
-- CARGA-94-DRAFT y CARGA-94-ROUTECANCELLED hacen falsificable el NOT IN del
-- cubo 2. pickup_route_status_enum tiene CINCO valores
-- (draft/in_progress/in_transit/received/cancelled, 20260625000001:20), no
-- cuatro -- el complemento real de {in_transit, received} es {draft,
-- in_progress, cancelled}. CARGA-94-DRAFT SOLA no alcanza: coincide con la
-- lista positiva ('draft','in_progress') en todo lo que toca, y la mutación
-- queda invisible (confirmado empíricamente). CARGA-94-ROUTECANCELLED (ruta
-- VIVA con status='cancelled') es la que realmente distingue las dos
-- fórmulas.
--
-- CARGA-94-DELETEDROUTE ya NO se queda en el cubo 2 (ronda 2 lo dejaba ahí
-- vía el LEFT JOIN): con el modelo de ronda 3, "ruta viva" es falso, así
-- que la carga cae por sus propias columnas (reception_status NULL,
-- status<>completed) en el cubo 1.

BEGIN;
SELECT plan(28);

-- ── Fixtures: operador A (el caller) ─────────────────────────────────────────
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
   '{"full_name":"Crew 94-B"}'::jsonb, NOW(), NOW(), '', ''),
  ('00000000-0000-4000-8000-000000009407',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'crew-94c@spec94.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"00000000-0000-4000-8000-000000009400"}'::jsonb,
   '{"full_name":"Crew 94-C"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009400','crew-94@spec94.test','Crew 94',ARRAY['pickup']),
  ('00000000-0000-4000-8000-000000009406','00000000-0000-4000-8000-000000009400','crew-94b@spec94.test','Crew 94-B',ARRAY['pickup']),
  ('00000000-0000-4000-8000-000000009407','00000000-0000-4000-8000-000000009400','crew-94c@spec94.test','Crew 94-C',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('00000000-0000-4000-8000-000000009402','00000000-0000-4000-8000-000000009400','SPEC94', true)
ON CONFLICT (id) DO NOTHING;

-- ── Rutas ────────────────────────────────────────────────────────────────────
-- uniq_pickup_routes_one_active_per_driver sólo restringe (operator_id,
-- driver_id) con status IN ('draft','in_progress') AND deleted_at IS NULL.
-- DOCK/INROUTE/DRAFT están los tres en ese conjunto -> tres drivers
-- distintos. DELETEDROUTE (soft-deleted) y TRANSIT/RXRECEIVED/ROUTECANCELLED
-- (fuera de draft/in_progress) pueden compartir driver 9401 libremente.
--
-- PR-94-ROUTECANCELLED nace 'cancelled' DIRECTAMENTE en el INSERT, no vía
-- UPDATE: un UPDATE ... SET status='cancelled' dispara
-- trg_pickup_routes_set_manifest_reception_status (20260625000001:203-208),
-- que desengancha (pickup_route_id = NULL) todo manifiesto atado a la ruta
-- en la MISMA transacción -- la fixture que se quiere (un manifiesto TODAVÍA
-- enganchado a una ruta viva y cancelada) sería imposible de construir así.
-- Naciendo cancelada, el trigger (que sólo dispara AFTER UPDATE OF status)
-- nunca corre, y el UPDATE posterior sobre manifests (más abajo) puede
-- engancharla sin que nada la desenganche.
INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status, deleted_at)
VALUES
  ('00000000-0000-4000-8000-000000009410','00000000-0000-4000-8000-000000009400','PR-94-DOCK','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_progress', NULL),
  ('00000000-0000-4000-8000-000000009411','00000000-0000-4000-8000-000000009400','PR-94-INROUTE','00000000-0000-4000-8000-000000009406','00000000-0000-4000-8000-000000009402','in_progress', NULL),
  ('00000000-0000-4000-8000-000000009412','00000000-0000-4000-8000-000000009400','PR-94-DELETEDROUTE','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_progress', NOW()),
  ('00000000-0000-4000-8000-000000009416','00000000-0000-4000-8000-000000009400','PR-94-DRAFT','00000000-0000-4000-8000-000000009407','00000000-0000-4000-8000-000000009402','draft', NULL),
  ('00000000-0000-4000-8000-000000009417','00000000-0000-4000-8000-000000009400','PR-94-TRANSIT','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','in_transit', NULL),
  ('00000000-0000-4000-8000-000000009418','00000000-0000-4000-8000-000000009400','PR-94-RXRECEIVED','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','received', NULL),
  ('00000000-0000-4000-8000-000000009419','00000000-0000-4000-8000-000000009400','PR-94-ROUTECANCELLED','00000000-0000-4000-8000-000000009401','00000000-0000-4000-8000-000000009402','cancelled', NULL);

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
  ('00000000-0000-4000-8000-0000000094ab','00000000-0000-4000-8000-000000009400','ORD-94-B','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-CANCELLED-BARE','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094ac','00000000-0000-4000-8000-000000009400','ORD-94-C','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-DRAFT','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094ad','00000000-0000-4000-8000-000000009400','ORD-94-D','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-TRANSIT','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094ae','00000000-0000-4000-8000-000000009400','ORD-94-E','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-RXRECEIVED','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094af','00000000-0000-4000-8000-000000009400','ORD-94-F','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-DEADROUTE-DONE','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094d0','00000000-0000-4000-8000-000000009400','ORD-94-G','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-ROUTECANCELLED','Retailer 94','{}'::jsonb,'MANUAL',NOW()),
  ('00000000-0000-4000-8000-0000000094d2','00000000-0000-4000-8000-000000009400','ORD-94-H','Cliente 94','+56900000940','Calle 94','Santiago',CURRENT_DATE,'CARGA-94-ORDERSDELETED-NULL','Retailer 94','{}'::jsonb,'MANUAL',NOW());

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
  ('00000000-0000-4000-8000-0000000094bb','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094ab','CTN94-B','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094bc','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094ac','CTN94-C','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094bd','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094ad','CTN94-D','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094be','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094ae','CTN94-E','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094bf','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094af','CTN94-F','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094d1','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094d0','CTN94-G','[]'::jsonb,'{}'::jsonb),
  ('00000000-0000-4000-8000-0000000094d3','00000000-0000-4000-8000-000000009400','00000000-0000-4000-8000-0000000094d2','CTN94-H','[]'::jsonb,'{}'::jsonb);

-- ── Ajustar cada manifests row al estado que su carga representa ─────────────
-- (trg_ensure_manifest_for_order ya creó la fila con status='pending' al
-- insertar la orden; el id es impredecible, por eso todo va por
-- operator_id + external_load_id.)

-- CARGA-94-DOCK: UN SOLO PASO. reception_status se deja SIN TOCAR (sigue
-- NULL de la creación) -- trg_manifest_reception_status la rellena sola a
-- 'awaiting_reception' en la transición hacia 'completed'. Esto es
-- exactamente lo que pasa en producción al cerrar una carga con
-- close_manifest; no es un artefacto de fixture.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009410',
  total_orders = 1, total_packages = 2
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK';

UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009411',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-INROUTE';

UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009412', -- ruta SOFT-DELETED
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DELETEDROUTE';

-- CARGA-94-DEADROUTE-DONE: MISMA ruta soft-deleted que CARGA-94-DELETEDROUTE,
-- pero COMPLETED (reception_status queda en 'awaiting_reception' vía el
-- trigger, un solo paso). Esta es la fixture que realmente hace falsificable
-- mover `pr.deleted_at IS NULL` del ON a un AND incondicional en el WHERE de
-- la subconsulta NOT IN de get_pending_manifests -- CARGA-94-DELETEDROUTE
-- por sí sola NO alcanza: en ese caso ninguna otra condición de exclusión es
-- verdadera (status<>completed, reception_status NULL), así que ambas
-- formulaciones (ON vs WHERE) terminan de acuerdo en "no excluir". Aquí, en
-- cambio, reception_status IS NOT NULL YA justifica la exclusión por sí solo
-- -- si el AND de ruta-muerta se vuelve incondicional, sobreescribe esa
-- exclusión independiente y la carga reaparecería equivocadamente en
-- Pendientes.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009412', -- MISMA ruta SOFT-DELETED
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DEADROUTE-DONE';

-- CARGA-94-ROUTECANCELLED: ruta VIVA (deleted_at IS NULL) con
-- status='cancelled' -- ni in_transit ni received, así que el NOT IN del
-- cubo 2 la incluye. Es la fixture que hace falsificable NOT IN frente a
-- una lista positiva IN ('draft','in_progress'): pickup_route_status_enum
-- tiene CINCO valores (20260625000001:20), no cuatro -- el complemento real
-- de {in_transit, received} es {draft, in_progress, cancelled}, tres
-- valores, y CARGA-94-DRAFT por sí sola sólo cubre uno de ellos. Sin esta
-- fixture, IN ('draft','in_progress') y NOT IN ('in_transit','received')
-- coinciden en todo lo que el fixture toca y la mutación queda invisible
-- (confirmado empíricamente antes de añadir esta fila).
UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009419', -- ruta VIVA, status='cancelled'
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-ROUTECANCELLED';

-- CARGA-94-DRAFT: la ruta está en 'draft' -- ni in_transit ni received, así
-- que el NOT IN del cubo 2 la incluye. Es la fixture que hace falsificable
-- esa cláusula (ver mutation-testing).
UPDATE public.manifests SET
  status = 'pending',
  pickup_route_id = '00000000-0000-4000-8000-000000009416',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DRAFT';

-- CARGA-94-TRANSIT: misma forma que CARGA-94-DOCK (reception_status queda
-- en 'awaiting_reception', vía el mismo trigger), pero la ruta está
-- 'in_transit'. Si el modelo mirara reception_status en vez de la ruta,
-- esta carga caería en el mismo cubo que CARGA-94-DOCK -- cae en cubo 3,
-- que es la prueba de que manda la ruta.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009417',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-TRANSIT';

-- CARGA-94-RXRECEIVED: misma forma otra vez, ruta 'received'.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  pickup_route_id = '00000000-0000-4000-8000-000000009418',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-RXRECEIVED';

-- CARGA-94-AWAITING / CARGA-94-INPROGRESSRX / CARGA-94-RECEIVED: SIN ruta
-- (pickup_route_id se queda NULL) -- el brazo "sin ruta viva" de los cubos
-- 3/4. reception_status se setea EXPLÍCITAMENTE en el mismo UPDATE, así que
-- el trigger no lo pisa (la guarda es "IF NEW.reception_status IS NULL").
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  reception_status = 'awaiting_reception',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-AWAITING';

UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  reception_status = 'reception_in_progress',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-INPROGRESSRX';

UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
  reception_status = 'received',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-RECEIVED';

-- CARGA-94-OLDCLOSE: flujo viejo -- completed, SIN ruta, reception_status
-- IS NULL. Dos pasos: el trigger auto-rellena awaiting_reception en el
-- primer UPDATE (reception_status no tocado, viene NULL), el segundo lo
-- vuelve a NULL con OLD.status ya en 'completed' -- la condición externa
-- del trigger (transición HACIA completed) ya no aplica, así que el NULL
-- sí se guarda esta vez.
UPDATE public.manifests SET
  status = 'completed', completed_at = NOW(),
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
-- se borra es la ÚNICA orden de la carga. total_orders/total_packages se
-- fijan a un valor REAL (2/3), no se dejan en el NULL por defecto de
-- ensure_manifest_for_order -- así la aserción de más abajo prueba que el
-- brazo arm2 pasa el número real (el total de intake ORIGINAL, de antes de
-- que las órdenes se soft-borraran), no que "NULL entra, NULL sale" de
-- casualidad (lo que también pasaría con un bug que siempre devolviera NULL
-- sin mirar la columna).
UPDATE public.orders SET deleted_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-ORDERSDELETED';

-- CARGA-94-ORDERSDELETED-NULL: MISMA forma, pero total_orders/total_packages
-- se dejan en el NULL por defecto de ensure_manifest_for_order -- nunca
-- tocados. Ronda 4 (review fase 2): la fixture (2,3) de arriba sólo prueba
-- que un valor REAL pasa honesto; esta prueba la otra mitad del contrato,
-- "NULL entra, NULL sale", que es justo lo que sostiene el ripple entero
-- de order_count/package_count nullable (page.tsx's handleRowOpen,
-- totalsToRows, ManifestRow). Sin este fixture, un bug que aplastara NULL a
-- 0 en el brazo arm2 no lo detectaría ningún test SQL.
UPDATE public.orders SET deleted_at = NOW()
 WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-ORDERSDELETED-NULL';

UPDATE public.manifests SET total_orders = 2, total_packages = 3
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

-- ── Discrepancia + escaneos sobre CARGA-94-DOCK, para probar que
--    missing_count/verified_count de get_routed_manifests leen datos
--    reales, no un COALESCE(...,0) de fachada. El segundo escaneo,
--    'verified' con package_id NULL, es lo que hace falsificable
--    `package_id IS NOT NULL` -- sin él, verified_count contaría también
--    esta fila y saldría 2, no 1. ─────────────────────────────────────────
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

INSERT INTO public.pickup_scans (
  operator_id, manifest_id, package_id, barcode_scanned, scan_result, scanned_by_user_id, scanned_at
) VALUES (
  '00000000-0000-4000-8000-000000009400',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-DOCK'),
  NULL, 'CTN94-GHOST', 'verified',
  '00000000-0000-4000-8000-000000009401', NOW()
);

-- ── Discrepancia sobre CARGA-94-TRANSIT, para probar que missing_count de
--    get_in_transit_manifests (ronda 4) lee datos reales, no 0 fijo. ──────
INSERT INTO public.discrepancies (
  operator_id, kind, operation_type, status, package_id, manifest_id, detected_by_user_id
) VALUES (
  '00000000-0000-4000-8000-000000009400', 'missing', 'pickup', 'open',
  '00000000-0000-4000-8000-0000000094bd',
  (SELECT id FROM public.manifests WHERE operator_id = '00000000-0000-4000-8000-000000009400' AND external_load_id = 'CARGA-94-TRANSIT'),
  '00000000-0000-4000-8000-000000009401'
);

-- ── Operador B: sólo para el aislamiento cross-tenant de get_routed_manifests ─
-- Misma forma que CARGA-94-DOCK (cubo 2, ruta in_progress) pero de OTRO
-- operador. Si el filtro operator_id de get_routed_manifests fallara, esta
-- carga aparecería junto a las del operador A.
INSERT INTO public.operators (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000009500', 'Spec94 Op B', 'spec94-op-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES (
  '00000000-0000-4000-8000-000000009501',
  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'crew-94opb@spec94.test', crypt('x', gen_salt('bf')), NOW(),
  '{"operator_id":"00000000-0000-4000-8000-000000009500"}'::jsonb,
  '{"full_name":"Crew 94 Op B"}'::jsonb, NOW(), NOW(), '', ''
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES ('00000000-0000-4000-8000-000000009501','00000000-0000-4000-8000-000000009500','crew-94opb@spec94.test','Crew 94 Op B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

INSERT INTO public.vehicles (id, operator_id, plate, active)
VALUES ('00000000-0000-4000-8000-000000009502','00000000-0000-4000-8000-000000009500','SPEC94B', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.pickup_routes (id, operator_id, code, driver_id, vehicle_id, status)
VALUES ('00000000-0000-4000-8000-000000009510','00000000-0000-4000-8000-000000009500','PR-94-OTHEROP','00000000-0000-4000-8000-000000009501','00000000-0000-4000-8000-000000009502','in_progress');

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  raw_data, imported_via, imported_at
) VALUES (
  '00000000-0000-4000-8000-0000000095a0','00000000-0000-4000-8000-000000009500','ORD-94OPB-1',
  'Cliente OpB','+56900000950','Calle OpB','Santiago',CURRENT_DATE,
  'CARGA-94-OTHEROP','Retailer OpB','{}'::jsonb,'MANUAL',NOW()
);

UPDATE public.manifests SET
  status = 'in_progress',
  pickup_route_id = '00000000-0000-4000-8000-000000009510',
  total_orders = 1, total_packages = 1
WHERE operator_id = '00000000-0000-4000-8000-000000009500' AND external_load_id = 'CARGA-94-OTHEROP';

-- GUARD: como owner (RLS bypassada), ambos operadores deben ser visibles --
-- si esto fallara, TEST 1 de abajo probaría RLS en vez del filtro
-- operator_id propio de la función (mismo patrón que
-- spec61_pending_excludes_routed.sql:86-102).
DO $$
DECLARE c INT;
BEGIN
  SELECT COUNT(*) INTO c FROM public.operators
   WHERE slug IN ('spec94-op','spec94-op-b');
  IF c <> 2 THEN
    RAISE EXCEPTION 'owner context saw % of 2 fixture operators -- TEST 1 ya no probaría el filtro operator_id propio de la función', c;
  END IF;
END $$;

-- ── TEST 1 -- contexto OWNER (RLS bypassada): el filtro propio de la función ─
-- Ronda de review: correr esta aserción bajo SET LOCAL role='authenticated'
-- no prueba nada por sí sola -- manifests_tenant_select
-- (20260310100000:163-168) ya esconde al operador B por RLS antes de que el
-- WHERE de get_routed_manifests entre en juego, así que borrar
-- `m.operator_id = public.get_operator_id()` de la función dejaría esta
-- aserción en verde igual. Como owner (el rol de esta conexión bypassa RLS
-- por defecto), sólo el filtro propio de la función puede excluir al
-- operador B -- set_config basta para que get_operator_id() (SECURITY
-- DEFINER, lee current_setting) resuelva al operador A sin cambiar de rol.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000009401","operator_id":"00000000-0000-4000-8000-000000009400"}',
  true
);

DO $$
DECLARE loads TEXT[];
BEGIN
  SELECT array_agg(external_load_id ORDER BY external_load_id)
    INTO loads FROM public.get_routed_manifests();
  loads := COALESCE(loads, '{}');

  IF 'CARGA-94-OTHEROP' = ANY(loads) THEN
    RAISE EXCEPTION 'TEST 1 (owner, RLS bypassada): la carga ruteada del operador B se filtró a la respuesta del operador A -- el filtro operator_id propio de get_routed_manifests falló: %', loads;
  END IF;
  IF NOT ('CARGA-94-DOCK' = ANY(loads)) THEN
    RAISE EXCEPTION 'TEST 1: una carga ruteada real del operador A no aparece -- %', loads;
  END IF;
END $$;

-- ── TEST 2 -- contexto authenticated, RLS ON, como en producción ────────────
-- No es un duplicado de TEST 1: aquí RLS SÍ participa (manifests_tenant_
-- select), así que esto prueba que la RLS real de producción tampoco deja
-- pasar al operador B -- un fallo distinto al que TEST 1 detecta.
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
  'CARGA-94-DOCK (cerrada en el andén, ruta in_progress, reception_status=awaiting_reception vía el trigger): sólo en get_routed_manifests -- EL test que prueba que manda la ruta'
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
    'CARGA-94-DRAFT' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-DRAFT' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-DRAFT' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-DRAFT' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, true, false, false],
  'CARGA-94-DRAFT (ruta en draft): sólo en get_routed_manifests -- prueba el NOT IN del cubo 2 (draft no es in_transit ni received)'
);

SELECT is(
  ARRAY[
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-DELETEDROUTE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[true, false, false, false],
  'CARGA-94-DELETEDROUTE (ruta soft-deleted -- ya no es "ruta viva"): cae por sus propias columnas en get_pending_manifests, no en get_routed_manifests (regresión CARGA-PARIS-001, corregida distinto en ronda 3)'
);

SELECT is(
  ARRAY[
    'CARGA-94-DEADROUTE-DONE' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-DEADROUTE-DONE' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-DEADROUTE-DONE' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-DEADROUTE-DONE' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-DEADROUTE-DONE (MISMA ruta soft-deleted que CARGA-94-DELETEDROUTE, pero completed con reception_status=awaiting_reception vía el trigger): sólo en get_in_transit_manifests, NUNCA en get_pending_manifests -- la fixture que hace falsificable un AND incondicional de ruta-muerta en la subconsulta NOT IN'
);

SELECT is(
  ARRAY[
    'CARGA-94-ROUTECANCELLED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-ROUTECANCELLED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-ROUTECANCELLED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-ROUTECANCELLED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, true, false, false],
  'CARGA-94-ROUTECANCELLED (ruta VIVA con status=cancelled -- no in_transit, no received): sólo en get_routed_manifests -- la fixture que hace falsificable NOT IN frente a una lista positiva (el enum tiene 5 valores, no 4)'
);

SELECT is(
  ARRAY[
    'CARGA-94-TRANSIT' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-TRANSIT' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-TRANSIT' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-TRANSIT' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-TRANSIT (misma forma que CARGA-94-DOCK, ruta in_transit): sólo en get_in_transit_manifests -- prueba que la ruta decide, no reception_status (idéntico en ambas)'
);

SELECT is(
  ARRAY[
    'CARGA-94-RXRECEIVED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-RXRECEIVED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-RXRECEIVED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-RXRECEIVED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, true],
  'CARGA-94-RXRECEIVED (misma forma otra vez, ruta received): sólo en get_completed_manifests -- misma reception_status que CARGA-94-DOCK y CARGA-94-TRANSIT, cubo distinto'
);

SELECT is(
  ARRAY[
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-AWAITING' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-AWAITING (sin ruta, reception_status=awaiting_reception): sólo en get_in_transit_manifests -- brazo "sin ruta viva"'
);

SELECT is(
  ARRAY[
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-INPROGRESSRX' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, true, false],
  'CARGA-94-INPROGRESSRX (sin ruta, reception_status=reception_in_progress): sólo en get_in_transit_manifests -- prueba el segundo valor del IN()'
);

SELECT is(
  ARRAY[
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-RECEIVED' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[false, false, false, true],
  'CARGA-94-RECEIVED (sin ruta, reception_status=received): sólo en get_completed_manifests -- brazo "sin ruta viva"'
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
    'CARGA-94-ORDERSDELETED-NULL' IN (SELECT external_load_id FROM t_pending),
    'CARGA-94-ORDERSDELETED-NULL' IN (SELECT external_load_id FROM t_routed),
    'CARGA-94-ORDERSDELETED-NULL' IN (SELECT external_load_id FROM t_transit),
    'CARGA-94-ORDERSDELETED-NULL' IN (SELECT external_load_id FROM t_completed)
  ],
  ARRAY[true, false, false, false],
  'CARGA-94-ORDERSDELETED-NULL (misma forma, total_orders/total_packages nunca tocados): sólo en get_pending_manifests (arm2)'
);

-- Ronda 4: la mitad del contrato que la fixture (2,3) no prueba -- un
-- manifiesto arm2 cuyos total_orders/total_packages NUNCA se escribieron
-- debe devolver NULL, no 0. Sin esta aserción, un `COALESCE(m.total_orders,
-- 0)` en el brazo arm2 pasaría en verde contra el resto de la suite.
SELECT is(
  (SELECT (order_count, package_count)
     FROM t_pending WHERE external_load_id = 'CARGA-94-ORDERSDELETED-NULL'),
  (NULL::bigint, NULL::bigint),
  'CARGA-94-ORDERSDELETED-NULL: order_count/package_count son NULL, no 0 -- total_orders/total_packages nunca se escribieron'
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
  'CARGA-94-DOCK: route_code/route_status/driver_name vienen de la ruta real; missing_count=1 (la discrepancia abierta), verified_count=1 (el escaneo verified con package_id real; el segundo, con package_id NULL, no cuenta), closed_at poblado porque status=completed'
);

SELECT is(
  (SELECT (route_code, route_status, driver_name, closed_at)
     FROM t_routed WHERE external_load_id = 'CARGA-94-INROUTE'),
  ('PR-94-INROUTE'::text, 'in_progress'::text, 'Crew 94-B'::text, NULL::timestamptz),
  'CARGA-94-INROUTE: closed_at es NULL porque status<>completed (no chip de "cerrada" para una carga que sigue abierta)'
);

SELECT is(
  (SELECT route_status FROM t_routed WHERE external_load_id = 'CARGA-94-DRAFT'),
  'draft'::text,
  'CARGA-94-DRAFT: route_status refleja el valor real de la ruta (draft)'
);

-- Ronda 4 (review fase 2): get_in_transit_manifests también devuelve
-- closed_at/missing_count -- "Cierres de hoy" necesita este cubo (una
-- carga cerrada en el andén cuya ruta luego arranca cae aquí). Sin esta
-- aserción, borrar esas dos columnas del SELECT pasaría en verde.
SELECT is(
  (SELECT (closed_at IS NOT NULL, missing_count)
     FROM t_transit WHERE external_load_id = 'CARGA-94-TRANSIT'),
  (true, 1),
  'CARGA-94-TRANSIT: closed_at poblado (status=completed) y missing_count=1 (la discrepancia real) -- get_in_transit_manifests ya no se queda sin estas columnas'
);

SELECT is(
  (SELECT id IS NOT NULL FROM t_pending WHERE external_load_id = 'CARGA-94-DELETEDROUTE'),
  true,
  'CARGA-94-DELETEDROUTE: aparece en get_pending_manifests con su manifest_id real (la fila existe de verdad, no es un artefacto del LEFT JOIN)'
);

-- ── El contrato del brazo nuevo de get_pending_manifests ────────────────────
SELECT is(
  (SELECT (id IS NULL, order_count, package_count, pickup_point)
     FROM t_pending WHERE external_load_id = 'CARGA-94-NOMANIFEST'),
  (true, 1::bigint, 1::bigint, NULL::text),
  'CARGA-94-NOMANIFEST: id NULL (no hay fila de manifests todavía) pero order_count/package_count SÍ cuentan la orden viva -- viene del arm1 (orders-rooted)'
);

-- Ronda de review: order_count/package_count del arm2 NO deben ser un
-- 0::BIGINT fijo. openPendingManifest.ts prohíbe explícitamente convertir un
-- "desconocido" en cero -- si el usuario abre esta carga, page.tsx pasa
-- estos mismos valores a un UPDATE manifests SET total_orders=...,
-- total_packages=... PERMANENTE, y un 0 fijo pisaría el total real de
-- intake (aquí, 2/3) con un cero falso. m.total_orders/total_packages
-- (nullable) es la fuente honesta.
SELECT is(
  (SELECT (id IS NOT NULL, order_count, package_count, pickup_point)
     FROM t_pending WHERE external_load_id = 'CARGA-94-ORDERSDELETED'),
  (true, 2::bigint, 3::bigint, NULL::text),
  'CARGA-94-ORDERSDELETED: id SÍ presente (la fila de manifests vive), order_count/package_count son el total REAL de manifests (2/3) -- viene de m.total_orders/total_packages, nunca un 0 fijo'
);

-- ── Ámbito de operador, no de usuario firmado ────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::int FROM t_routed WHERE external_load_id IN ('CARGA-94-DOCK','CARGA-94-INROUTE','CARGA-94-DRAFT')),
  3,
  'get_routed_manifests ve las tres cargas ruteadas del operador aunque ninguna comparta líder -- es de ámbito operador, no de usuario firmado'
);

-- ── Aislamiento cross-tenant, TEST 2 (repetición pgTAP de la comprobación
--    del DO block de arriba): bajo RLS real (authenticated), la carga del
--    operador B tampoco se filtra. El filtro propio de la función ya quedó
--    probado por TEST 1 (owner, RLS bypassada); esto añade la capa de RLS
--    real de producción encima, no la sustituye. ─────────────────────────
SELECT is(
  'CARGA-94-OTHEROP' IN (SELECT external_load_id FROM t_routed),
  false,
  'get_routed_manifests bajo authenticated (RLS ON) tampoco filtra la carga ruteada del operador B -- TEST 2, complementa el filtro propio ya probado en TEST 1'
);

SELECT * FROM finish();
ROLLBACK;
