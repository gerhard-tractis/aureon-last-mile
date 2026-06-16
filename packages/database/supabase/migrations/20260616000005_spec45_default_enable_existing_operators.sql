-- spec-45 — Default-enable Phase 1 modules for any operator that existed
-- before this migration ran. The internal Aureon operator is excluded.
-- New operators created AFTER this migration get nothing seeded.

DO $$
DECLARE
  system_user UUID := '00000000-0000-0000-0000-000000000055';
  op_id UUID;
  mod TEXT;
BEGIN
  FOR op_id IN
    SELECT id FROM public.operators
     WHERE slug <> 'aureon-internal'
       AND is_active = TRUE
  LOOP
    FOREACH mod IN ARRAY ARRAY['ops_control','late_order_alerts'] LOOP
      INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
      VALUES (op_id, mod, system_user)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.operator_module_audit
        (operator_id, module_key, action, actor_user_id, reason)
      VALUES (op_id, mod, 'enable', system_user, 'spec-45 default seed for existing operators');
    END LOOP;
  END LOOP;
END $$;
