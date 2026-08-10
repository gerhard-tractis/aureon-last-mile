-- =============================================================================
-- spec-51 — pipeline_position() never learned about 'listo_para_despacho'
-- =============================================================================
-- Migration 20260324000001_dispatch_module.sql renamed the enum value
-- 'listo' -> 'listo_para_despacho' in both order_status_enum and
-- package_status_enum. It did NOT update the two functions that compare against
-- that value as TEXT, so the rename silently broke them:
--
--   pipeline_position(p_status TEXT)   -- latest def: 20260319000001
--     matches only 'listo', so pipeline_position('listo_para_despacho')
--     falls through to ELSE 0 — i.e. "terminal / not in the active pipeline".
--
--   recalculate_order_status()         -- latest def: 20260513000005
--     maps position 8 back to the literal 'listo', which is no longer a valid
--     order_status_enum label. That branch is currently unreachable (position 8
--     can never be produced) and would raise on cast if it ever were.
--
-- IMPACT (production bug, not cosmetic):
--   POST /api/dispatch/routes/[id]/close sets every 'en_carga' package on the
--   route to 'listo_para_despacho'. That fires trg_recalculate_order_status.
--   Inside recalculate_order_status, v_active_count counts packages with
--   pipeline_position(status) > 0 — which is now 0 for every package just
--   staged for dispatch. For an order whose packages are ALL on the closed
--   route, v_active_count + v_entregado = 0, so the function takes the
--   "no packages left" branch and sets the order to 'cancelado'.
--
--   Net effect: closing a dispatch route cancels its orders.
--
-- Both functions are rewritten below from their LATEST definitions per the
-- repo rule in CLAUDE.md — pipeline_position from 20260319000001 and
-- recalculate_order_status from 20260513000005 — changed only where the stale
-- literal appears.
--
-- Existing rows are NOT repaired here. Orders already flipped to 'cancelado'
-- stay that way until a package row changes and re-fires the trigger. The
-- repair needs a decision on scope against real data; see
-- docs/specs/spec-51-qa-scenario-seed.md for the diagnostic query.
-- =============================================================================

-- 1. pipeline_position — template: 20260319000001_create_distribution_tables.sql
--    Only change: 'listo' -> 'listo_para_despacho'.
CREATE OR REPLACE FUNCTION pipeline_position(p_status TEXT)
RETURNS INT AS $$
  SELECT CASE p_status
    WHEN 'ingresado'           THEN 1
    WHEN 'verificado'          THEN 2
    WHEN 'en_bodega'           THEN 3
    WHEN 'sectorizado'         THEN 4
    WHEN 'retenido'            THEN 5
    WHEN 'asignado'            THEN 6
    WHEN 'en_carga'            THEN 7
    WHEN 'listo_para_despacho' THEN 8
    WHEN 'en_ruta'             THEN 9
    WHEN 'entregado'           THEN 10
    ELSE 0
  END;
$$ LANGUAGE sql IMMUTABLE;

-- 2. recalculate_order_status — template: 20260513000005_spec43_followup_trigger_cleanup.sql
--    Only change: the two `WHEN 8 THEN 'listo'` branches.
CREATE OR REPLACE FUNCTION recalculate_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id     UUID;
  v_active_count INT;   -- non-terminal packages excluding retorno_hub
  v_retorno      INT;   -- count of retorno_hub packages
  v_entregado    INT;   -- count of entregado packages
  v_min_pos      INT;
  v_max_pos      INT;
  v_min_status   order_status_enum;
  v_max_status   order_status_enum;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT
    COUNT(*) FILTER (WHERE pipeline_position(status::text) > 0),
    COUNT(*) FILTER (WHERE status = 'retorno_hub'),
    COUNT(*) FILTER (WHERE status = 'entregado')
  INTO v_active_count, v_retorno, v_entregado
  FROM packages
  WHERE order_id   = v_order_id
    AND deleted_at IS NULL;

  IF v_retorno > 0 THEN
    UPDATE orders SET
      status            = CASE WHEN v_entregado > 0
                               THEN 'parcialmente_entregado'::order_status_enum
                               ELSE 'en_retorno'::order_status_enum END,
      leading_status    = CASE WHEN v_entregado > 0
                               THEN 'parcialmente_entregado'::order_status_enum
                               ELSE 'en_retorno'::order_status_enum END,
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_active_count + v_entregado = 0 THEN
    UPDATE orders SET
      status            = 'cancelado',
      leading_status    = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id   = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  SELECT CASE
    WHEN v_min_pos <= 3 THEN
      CASE v_min_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_min_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_min_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo_para_despacho'
        WHEN 9 THEN 'en_ruta'  WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_min_status;

  SELECT CASE
    WHEN v_max_pos <= 3 THEN
      CASE v_max_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_max_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_max_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo_para_despacho'
        WHEN 9 THEN 'en_ruta'  WHEN 10 THEN 'entregado'
      END
  END::order_status_enum INTO v_max_status;

  UPDATE orders SET
    status            = v_min_status,
    leading_status    = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
