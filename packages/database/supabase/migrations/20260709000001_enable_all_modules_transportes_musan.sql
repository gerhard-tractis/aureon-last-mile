-- Enable ALL spec-45 modules for the Transportes Musan operator.
-- Musan previously only had the Phase-1 defaults (ops_control, late_order_alerts)
-- from 20260616000005; this activates the remaining 7 modules.
--
-- Keyed off slug (not a hard-coded UUID) so it is environment-agnostic.
-- Idempotent: ON CONFLICT DO NOTHING skips modules already enabled, and the
-- audit row is only written for modules that were actually just turned on.
--
-- NOTE: variable names avoid Postgres 14+ built-in SQL functions like
-- `system_user` and `mod` (see 20260616000005 for the rationale).
DO $$
DECLARE
  v_system_user UUID := '00000000-0000-0000-0000-000000000055';
  v_op_id UUID;
  v_module TEXT;
  v_row_count BIGINT;
BEGIN
  SELECT id INTO v_op_id
    FROM public.operators
   WHERE slug = 'transportes-musan';

  IF v_op_id IS NULL THEN
    RAISE NOTICE 'Operator transportes-musan not found; skipping module enablement.';
    RETURN;
  END IF;

  FOREACH v_module IN ARRAY ARRAY[
    'ops_control',
    'late_order_alerts',
    'pickup',
    'reception',
    'distribution',
    'pre_route',
    'dispatch',
    'returns',
    'conversations'
  ] LOOP
    INSERT INTO public.operator_enabled_modules (operator_id, module_key, enabled_by)
    VALUES (v_op_id, v_module, v_system_user)
    ON CONFLICT DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    IF v_row_count > 0 THEN
      INSERT INTO public.operator_module_audit
        (operator_id, module_key, action, actor_user_id, reason)
      VALUES (v_op_id, v_module, 'enable', v_system_user,
              'Enable all modules for Transportes Musan');
    END IF;
  END LOOP;
END $$;
