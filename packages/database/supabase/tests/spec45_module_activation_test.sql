-- spec-45 — Module Activation Layer test suite
-- Run inside a transaction; ROLLBACK at the end so the DB is unchanged.
-- Each section RAISE EXCEPTIONs on assertion failure.

BEGIN;

-- ─── Schema existence checks ────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'operator_enabled_modules'
  ) THEN
    RAISE EXCEPTION 'operator_enabled_modules table missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'operator_module_audit'
  ) THEN
    RAISE EXCEPTION 'operator_module_audit table missing';
  END IF;
END $$;

-- ─── Partial unique index check ─────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'operator_enabled_modules'
      AND indexdef ILIKE '%disabled_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'partial unique index on (operator_id, module_key) missing';
  END IF;
END $$;

-- ─── RLS enabled ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operator_enabled_modules'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on operator_enabled_modules';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.operator_module_audit'::regclass) THEN
    RAISE EXCEPTION 'RLS not enabled on operator_module_audit';
  END IF;
END $$;

-- ─── RPCs exist ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_enabled_modules_for_operator') THEN
    RAISE EXCEPTION 'RPC get_enabled_modules_for_operator missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'enable_module_for_operator') THEN
    RAISE EXCEPTION 'RPC enable_module_for_operator missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'disable_module_for_operator') THEN
    RAISE EXCEPTION 'RPC disable_module_for_operator missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_operators_with_module_state') THEN
    RAISE EXCEPTION 'RPC list_operators_with_module_state missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_module_audit_for_operator') THEN
    RAISE EXCEPTION 'RPC get_module_audit_for_operator missing';
  END IF;
END $$;

-- ─── Test fixture: two operators + two users ────────────────────────────────
INSERT INTO public.operators (id, name, slug, country_code) VALUES
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Tenant C', 'tenant-c', 'CL'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Tenant D', 'tenant-d', 'CL')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token
) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'super@aureon.test', crypt('x', gen_salt('bf')), NOW(),
   jsonb_build_object('claims', jsonb_build_object('role','super_admin')),
   '{}'::jsonb, NOW(), NOW(), '', ''),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff',
   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'admin-c@tenant.test', crypt('x', gen_salt('bf')), NOW(),
   jsonb_build_object('claims', jsonb_build_object('role','admin','operator_id','cccccccc-cccc-cccc-cccc-cccccccccccc')),
   '{}'::jsonb, NOW(), NOW(), '', '')
ON CONFLICT (id) DO NOTHING;

-- ─── enable_module_for_operator: rejects non-super-admin ────────────────────
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
BEGIN
  SET LOCAL request.jwt.claims = '{"role":"admin","sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","operator_id":"cccccccc-cccc-cccc-cccc-cccccccccccc"}';
  BEGIN
    PERFORM public.enable_module_for_operator(
      'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'test'
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'enable_module_for_operator should reject non-super-admin';
  END IF;
END $$;

-- ─── enable + get_enabled_modules round-trip ────────────────────────────────
SET LOCAL request.jwt.claims = '{"role":"super_admin","sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"}';
SELECT public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'phase-1 go-live'
);

DO $$
DECLARE
  enabled TEXT[];
BEGIN
  enabled := public.get_enabled_modules_for_operator(
    'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID
  );
  IF NOT ('pickup' = ANY(enabled)) THEN
    RAISE EXCEPTION 'pickup should be in enabled list after enable';
  END IF;
END $$;

-- ─── Idempotency: second enable produces no second active row ──────────────
SELECT public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'second attempt'
);
DO $$
DECLARE
  active_count INT;
  audit_count INT;
BEGIN
  SELECT COUNT(*) INTO active_count FROM public.operator_enabled_modules
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND module_key = 'pickup' AND disabled_at IS NULL;
  IF active_count <> 1 THEN
    RAISE EXCEPTION 'expected exactly 1 active row after idempotent enable, got %', active_count;
  END IF;

  SELECT COUNT(*) INTO audit_count FROM public.operator_module_audit
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND module_key = 'pickup' AND action = 'enable';
  IF audit_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 enable audit rows after idempotent enable, got %', audit_count;
  END IF;
END $$;

-- ─── disable + re-enable: fresh row inserted, history preserved ────────────
SELECT public.disable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 'rolled back'
);
SELECT public.enable_module_for_operator(
  'cccccccc-cccc-cccc-cccc-cccccccccccc'::UUID, 'pickup', 're-enable'
);
DO $$
DECLARE
  total_rows INT;
BEGIN
  SELECT COUNT(*) INTO total_rows FROM public.operator_enabled_modules
   WHERE operator_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND module_key = 'pickup';
  IF total_rows <> 2 THEN
    RAISE EXCEPTION 'expected 2 rows (1 disabled + 1 active) after re-enable, got %', total_rows;
  END IF;
END $$;

-- ─── Empty reason rejected ──────────────────────────────────────────────────
DO $$
DECLARE
  rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    PERFORM public.enable_module_for_operator(
      'dddddddd-dddd-dddd-dddd-dddddddddddd'::UUID, 'pickup', ''
    );
  EXCEPTION WHEN OTHERS THEN
    rejected := TRUE;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'empty reason should be rejected';
  END IF;
END $$;

-- ─── Default seed assertion: pre-existing operators got Phase 1 modules ────
DO $$
DECLARE
  bad_op UUID;
BEGIN
  SELECT o.id INTO bad_op
    FROM public.operators o
   WHERE o.slug <> 'aureon-internal'
     AND o.created_at < '2026-06-16'::DATE
     AND o.is_active = TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.operator_enabled_modules oem
        WHERE oem.operator_id = o.id
          AND oem.module_key = 'ops_control'
          AND oem.disabled_at IS NULL
     )
   LIMIT 1;
  IF bad_op IS NOT NULL THEN
    RAISE EXCEPTION 'pre-existing operator % missing default ops_control seed', bad_op;
  END IF;
END $$;

ROLLBACK;
