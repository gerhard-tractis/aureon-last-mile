-- spec-45 — Default-enable Phase 1 modules for any operator that existed
-- before this migration ran. The internal Aureon operator is excluded.
-- New operators created AFTER this migration get nothing seeded.

-- NOTE: variable names avoid Postgres 14+ built-in SQL functions like
-- `system_user` and `mod` — inside a VALUES list these resolve to the
-- function/operator, not the plpgsql variable, and silently yield wrong
-- types (e.g. system_user() returns text, breaking the UUID enabled_by
-- column).
DO $$
DECLARE
  v_system_user UUID := '00000000-0000-0000-0000-000000000055';
  v_op_id UUID;
  v_module TEXT;
BEGIN
  FOR v_op_id IN
    SELECT id FROM public.operators
     WHERE slug <> 'aureon-internal'
       AND is_active = TRUE
  LOOP
    FOREACH v_module IN ARRAY ARRAY['ops_control','late_order_alerts'] LOOP
      INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
      VALUES (v_op_id, v_module, v_system_user)
      ON CONFLICT DO NOTHING;

      INSERT INTO public.operator_module_audit
        (operator_id, module_key, action, actor_user_id, reason)
      VALUES (v_op_id, v_module, 'enable', v_system_user, 'spec-45 default seed for existing operators');
    END LOOP;
  END LOOP;
END $$;
