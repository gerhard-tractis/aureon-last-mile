-- spec-53 — package label RPC isolation
-- get_manifest_label_data / mark_manifest_labels_printed must not leak or
-- mutate another operator's data, and soft-deleted rows must be excluded.
-- Run inside transaction; ROLLBACK at end.

BEGIN;

-- ─── Schema existence ──────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'manifests' AND column_name = 'labels_printed_at'
  ) THEN
    RAISE EXCEPTION 'manifests.labels_printed_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_manifest_label_data') THEN
    RAISE EXCEPTION 'get_manifest_label_data missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'mark_manifest_labels_printed') THEN
    RAISE EXCEPTION 'mark_manifest_labels_printed missing';
  END IF;
END $$;

-- ─── Fixture: 2 operators, 2 users, 1 manifest/order/package each ──────────
INSERT INTO public.operators (id, name, slug)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000053','Spec53 Op A','spec53-op-a'),
  ('bbbbbbbb-0000-4000-b000-000000000053','Spec53 Op B','spec53-op-b')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('aaaaaaaa-0000-4000-a000-000000000153',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-a@spec53.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"aaaaaaaa-0000-4000-a000-000000000053"}'::jsonb,
   '{"full_name":"User A"}'::jsonb, NOW(), NOW(), '', ''),
  ('bbbbbbbb-0000-4000-b000-000000000153',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'user-b@spec53.test', crypt('x', gen_salt('bf')), NOW(),
   '{"operator_id":"bbbbbbbb-0000-4000-b000-000000000053"}'::jsonb,
   '{"full_name":"User B"}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, operator_id, email, full_name, permissions)
VALUES
  ('aaaaaaaa-0000-4000-a000-000000000153','aaaaaaaa-0000-4000-a000-000000000053','user-a@spec53.test','User A',ARRAY['pickup']),
  ('bbbbbbbb-0000-4000-b000-000000000153','bbbbbbbb-0000-4000-b000-000000000053','user-b@spec53.test','User B',ARRAY['pickup'])
ON CONFLICT (id) DO UPDATE
  SET operator_id = EXCLUDED.operator_id,
      full_name   = EXCLUDED.full_name,
      permissions = EXCLUDED.permissions;

-- Service-role context (no RLS) for the rest of the fixture.
SELECT set_config('request.jwt.claims', '{}', true);

INSERT INTO public.manifests (id, operator_id, external_load_id, retailer_name, status)
VALUES
  ('cccccccc-0000-4000-c000-000000000053','aaaaaaaa-0000-4000-a000-000000000053','CARGA-SPEC53-A','Easy','in_progress'),
  ('dddddddd-0000-4000-d000-000000000053','bbbbbbbb-0000-4000-b000-000000000053','CARGA-SPEC53-B','Sodimac','in_progress')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (id, operator_id, order_number, customer_name, customer_phone, delivery_address, comuna, delivery_date, external_load_id, imported_via, imported_at, raw_data)
VALUES
  ('eeeeeeee-0000-4000-e000-000000000053','aaaaaaaa-0000-4000-a000-000000000053','ORD-SPEC53-A','Cliente A','+56911111111','Calle A 1','Las Condes','2026-08-13','CARGA-SPEC53-A','MANUAL','2026-08-13T00:00:00Z','{}'::jsonb),
  ('ffffffff-0000-4000-f000-000000000053','bbbbbbbb-0000-4000-b000-000000000053','ORD-SPEC53-B','Cliente B','+56922222222','Calle B 2','Providencia','2026-08-13','CARGA-SPEC53-B','MANUAL','2026-08-13T00:00:00Z','{}'::jsonb),
  -- soft-deleted order under operator A — must be excluded from label data
  ('11111111-1111-4000-a000-000000000053','aaaaaaaa-0000-4000-a000-000000000053','ORD-SPEC53-DEL','Cliente Del','+56933333333','Calle D 3','Ñuñoa','2026-08-13','CARGA-SPEC53-A','MANUAL','2026-08-13T00:00:00Z','{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE public.orders SET deleted_at = NOW() WHERE id = '11111111-1111-4000-a000-000000000053';

INSERT INTO public.packages (id, operator_id, order_id, label, package_number, declared_box_count, sku_items, raw_data)
VALUES
  ('22222222-2222-4000-a000-000000000053','aaaaaaaa-0000-4000-a000-000000000053','eeeeeeee-0000-4000-e000-000000000053','CTN-SPEC53-A','1',1,'[]'::jsonb,'{}'::jsonb),
  ('33333333-3333-4000-b000-000000000053','bbbbbbbb-0000-4000-b000-000000000053','ffffffff-0000-4000-f000-000000000053','CTN-SPEC53-B','1',1,'[]'::jsonb,'{}'::jsonb),
  -- soft-deleted package under operator A's live order — must be excluded
  ('44444444-4444-4000-a000-000000000053','aaaaaaaa-0000-4000-a000-000000000053','eeeeeeee-0000-4000-e000-000000000053','CTN-SPEC53-A-DEL','2',1,'[]'::jsonb,'{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

UPDATE public.packages SET deleted_at = NOW() WHERE id = '44444444-4444-4000-a000-000000000053';

-- ─── get_manifest_label_data returns nothing for a manifest belonging to
-- ─── another operator ──────────────────────────────────────────────────────
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000153","operator_id":"aaaaaaaa-0000-4000-a000-000000000053","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c FROM public.get_manifest_label_data('dddddddd-0000-4000-d000-000000000053');
  IF c <> 0 THEN
    RAISE EXCEPTION 'get_manifest_label_data leaked operator B manifest to operator A, got % rows', c;
  END IF;
  RESET role;
END $$;

-- ─── get_manifest_label_data returns the caller's own manifest, excluding
-- ─── soft-deleted orders/packages ──────────────────────────────────────────
DO $$
DECLARE c INT; lbl TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000153","operator_id":"aaaaaaaa-0000-4000-a000-000000000053","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c FROM public.get_manifest_label_data('cccccccc-0000-4000-c000-000000000053');
  IF c <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 label row (soft-deleted order/package excluded), got %', c;
  END IF;

  SELECT package_label INTO lbl FROM public.get_manifest_label_data('cccccccc-0000-4000-c000-000000000053');
  IF lbl <> 'CTN-SPEC53-A' THEN
    RAISE EXCEPTION 'expected the live package label, got %', lbl;
  END IF;
  RESET role;
END $$;

-- ─── p_package_id narrows to a single row ──────────────────────────────────
DO $$
DECLARE c INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000153","operator_id":"aaaaaaaa-0000-4000-a000-000000000053","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  SELECT COUNT(*) INTO c FROM public.get_manifest_label_data(
    'cccccccc-0000-4000-c000-000000000053',
    '22222222-2222-4000-a000-000000000053'
  );
  IF c <> 1 THEN
    RAISE EXCEPTION 'p_package_id did not narrow to exactly 1 row, got %', c;
  END IF;
  RESET role;
END $$;

-- ─── mark_manifest_labels_printed raises for a foreign manifest ───────────
DO $$
DECLARE raised BOOLEAN := false; err_msg TEXT := 'no error raised';
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000153","operator_id":"aaaaaaaa-0000-4000-a000-000000000053","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  BEGIN
    PERFORM public.mark_manifest_labels_printed('dddddddd-0000-4000-d000-000000000053');
  EXCEPTION WHEN OTHERS THEN
    raised := true;
    GET STACKED DIAGNOSTICS err_msg = MESSAGE_TEXT;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'mark_manifest_labels_printed did not raise for a foreign manifest';
  END IF;
  RESET role;
END $$;

-- ─── mark_manifest_labels_printed succeeds for the caller's own manifest and
-- ─── stamps the caller as labels_printed_by ────────────────────────────────
DO $$
DECLARE v_printed_at TIMESTAMPTZ; v_printed_by UUID;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-0000-4000-a000-000000000153","operator_id":"aaaaaaaa-0000-4000-a000-000000000053","role":"authenticated"}', true);
  SET LOCAL role = 'authenticated';

  PERFORM public.mark_manifest_labels_printed('cccccccc-0000-4000-c000-000000000053');

  SELECT labels_printed_at, labels_printed_by INTO v_printed_at, v_printed_by
    FROM public.manifests WHERE id = 'cccccccc-0000-4000-c000-000000000053';

  IF v_printed_at IS NULL THEN
    RAISE EXCEPTION 'labels_printed_at was not set';
  END IF;
  IF v_printed_by IS DISTINCT FROM 'aaaaaaaa-0000-4000-a000-000000000153'::UUID THEN
    RAISE EXCEPTION 'labels_printed_by should be the calling user, got %', v_printed_by;
  END IF;
  RESET role;
END $$;

ROLLBACK;
