-- spec-45 — Seed internal Aureon operator and a system user.
-- The system user is the actor for automated seed rows (e.g. default-enable
-- migrations). Super-admin humans will be created later via the normal
-- user-creation flow with operator_id = the internal operator.
--
-- UUIDs use deterministic constants so subsequent migrations (and tests) can
-- reference them directly.

-- Internal operator (slug 'aureon-internal'). Excluded from the default-enable
-- seed in migration 5.
INSERT INTO public.operators (id, name, slug, country_code, is_active)
VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  'Aureon',
  'aureon-internal',
  'CL',
  TRUE
)
ON CONFLICT (slug) DO NOTHING;

-- System user used as actor for seed rows. Has no real login on purpose — it
-- only exists to satisfy the FK on operator_enabled_modules.enabled_by.
DO $$
DECLARE
  system_user_id UUID := '00000000-0000-0000-0000-000000000055';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = system_user_id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token
    ) VALUES (
      system_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      'system@aureon-internal.local',
      crypt(gen_random_uuid()::text, gen_salt('bf')),
      NOW(),
      -- handle_new_user trigger (created by 20260216170542) reads operator_id
      -- and role from the TOP LEVEL of raw_app_meta_data and aborts if
      -- operator_id is missing. Keep `claims` populated too so the JWT hook
      -- contract used by spec-45 RPCs still sees the same shape.
      jsonb_build_object(
        'operator_id', '00000000-0000-0000-0000-0000000000a1',
        'role', 'super_admin',
        'claims', jsonb_build_object(
          'operator_id', '00000000-0000-0000-0000-0000000000a1',
          'role', 'super_admin'
        )
      ),
      jsonb_build_object('full_name', 'System (spec-45)'),
      NOW(), NOW(), '', ''
    );
  END IF;
END $$;
