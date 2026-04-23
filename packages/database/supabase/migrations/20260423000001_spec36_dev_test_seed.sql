-- =============================================================================
-- Migration: 20260423000001_spec36_dev_test_seed.sql
-- Description: Spec-36 — Create one DEV test driver per existing operator.
--              Drivers are soft-deleted (deleted_at = now()) by default.
--              Idempotent: safe to re-run.
-- =============================================================================

DO $$
DECLARE
  v_operator_id UUID;
  v_driver_id UUID;
BEGIN
  -- Iterate over all existing operators
  FOR v_operator_id IN
    SELECT id FROM public.operators WHERE deleted_at IS NULL
  LOOP
    -- Derive deterministic UUID from operator_id using md5
    v_driver_id := (
      md5('DEV_DRIVER_' || v_operator_id::text)::uuid
    );

    -- Insert one test driver per operator
    -- ON CONFLICT DO NOTHING makes this idempotent
    INSERT INTO public.drivers (
      id,
      operator_id,
      fleet_type,
      full_name,
      phone,
      status,
      deleted_at,
      created_at,
      updated_at
    ) VALUES (
      v_driver_id,
      v_operator_id,
      'own',                    -- fleet_type
      'DEV Test Driver',         -- full_name
      '+56900000000',            -- phone
      'active',                  -- status
      now(),                     -- deleted_at (soft-delete by default)
      now(),                     -- created_at
      now()                      -- updated_at
    )
    ON CONFLICT (id) DO NOTHING;
  END LOOP;
END $$;
