-- pgTAP: spec-83 fase 2 — get_pending_manifests() returns the pickup window
-- (pickup_window_start/end, pickup_cutoff_time), sourced from
-- pickup_points.pickup_locations[0].operating_hours and
-- pickup_points.sla_config.pickup_cutoff_time.
--
-- Asymmetric fixture on purpose: point A has BOTH a window and a stricter
-- cutoff configured, point B has NEITHER — the state every real pickup point
-- is in today. A 1/1 fixture (two copies of the same shape) would not catch
-- a swap between the window and cutoff columns, nor a NULL default that
-- quietly became a fabricated time.
BEGIN;
SELECT plan(4);

INSERT INTO public.operators (id, name, slug)
VALUES ('aaaaaaaa-0000-4000-a000-000000000830','Spec83 Fase2 Ventana','spec83-fase2-ventana')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000831','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','pend-leader@spec83f2.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000830","role":"pickup_leader"}'::jsonb,
   '{"full_name":"Lider F2"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, role, email, full_name, permissions)
VALUES ('aaaaaaaa-0000-4000-a000-000000000831','aaaaaaaa-0000-4000-a000-000000000830',
        'pickup_leader','pend-leader@spec83f2.test','Lider F2',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id, role = EXCLUDED.role,
      full_name = EXCLUDED.full_name, permissions = EXCLUDED.permissions;

-- Point A: fully configured — window 09:00-13:00, cutoff 12:30 (stricter).
INSERT INTO public.pickup_points (id, operator_id, name, code, intake_method, pickup_locations, sla_config)
VALUES (
  '88888888-0000-4000-8000-000000000831','aaaaaaaa-0000-4000-a000-000000000830',
  'Bodega Configurada','BC-830','manual',
  '[{"name":"Bodega Configurada","operating_hours":{"start":"09:00","end":"13:00"}}]'::jsonb,
  '{"pickup_cutoff_time":"12:30"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- Point B: nothing configured — the state every real pickup point is in
-- today. pickup_locations/sla_config keep their table defaults ('[]'/'{}').
INSERT INTO public.pickup_points (id, operator_id, name, code, intake_method)
VALUES (
  '88888888-0000-4000-8000-000000000832','aaaaaaaa-0000-4000-a000-000000000830',
  'Bodega Sin Configurar','BC-831','manual'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, operator_id, order_number, customer_name, customer_phone,
  delivery_address, comuna, delivery_date, external_load_id, retailer_name,
  pickup_point_id, raw_data, imported_via, imported_at
) VALUES
  ('66666666-0000-4000-6000-000000000831','aaaaaaaa-0000-4000-a000-000000000830','ORD-831',
   'Cliente Uno','+56900000831','Calle Falsa 831','Providencia',CURRENT_DATE,
   'SPEC83-F2-CONFIGURADO','Cliente A','88888888-0000-4000-8000-000000000831',
   '{}'::jsonb,'MANUAL',NOW()),
  ('66666666-0000-4000-6000-000000000832','aaaaaaaa-0000-4000-a000-000000000830','ORD-832',
   'Cliente Dos','+56900000832','Calle Falsa 832','Providencia',CURRENT_DATE,
   'SPEC83-F2-SINCONFIGURAR','Cliente A','88888888-0000-4000-8000-000000000832',
   '{}'::jsonb,'MANUAL',NOW())
ON CONFLICT (id) DO NOTHING;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-4000-a000-000000000831","operator_id":"aaaaaaaa-0000-4000-a000-000000000830","role":"authenticated"}',
  true
);

SELECT is(
  (SELECT (pickup_window_start, pickup_window_end, pickup_cutoff_time)
     FROM public.get_pending_manifests()
    WHERE external_load_id = 'SPEC83-F2-CONFIGURADO'),
  ('09:00'::text, '13:00'::text, '12:30'::text),
  'a configured pickup point returns its window AND its (stricter) cutoff'
);

-- The unconfigured point's load must come back NULL on all three columns —
-- not a value borrowed from point A's row, and not an empty string that a
-- careless frontend could mistake for "any time is fine".
SELECT is(
  (SELECT pickup_window_start FROM public.get_pending_manifests()
    WHERE external_load_id = 'SPEC83-F2-SINCONFIGURAR'),
  NULL::text,
  'an unconfigured pickup point must not fabricate a window start'
);

SELECT is(
  (SELECT pickup_window_end FROM public.get_pending_manifests()
    WHERE external_load_id = 'SPEC83-F2-SINCONFIGURAR'),
  NULL::text,
  'an unconfigured pickup point must not fabricate a window end'
);

SELECT is(
  (SELECT pickup_cutoff_time FROM public.get_pending_manifests()
    WHERE external_load_id = 'SPEC83-F2-SINCONFIGURAR'),
  NULL::text,
  'an unconfigured pickup point must not fabricate a cutoff'
);

SELECT * FROM finish();
ROLLBACK;
