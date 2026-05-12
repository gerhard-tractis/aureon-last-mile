-- =============================================================
-- Spec-43: Teach the order-status trigger about return-flow states.
-- Template: latest definition from 20260319000001_create_distribution_tables.sql
--           (10-position pipeline_position: sectorizado=4, retenido=5, asignado=6,
--            en_carga=7, listo=8, en_ruta=9, entregado=10; positions 4/5 are
--            package-only and map back to en_bodega at the order level)
--
-- Why this is required:
--   recalculate_order_status (from epic5) derives orders.status from the MIN/MAX
--   pipeline_position of active packages. Because pipeline_position('retorno_hub')
--   returns 0, the original trigger sees a DT status-3 webhook (all packages →
--   retorno_hub) as "zero active packages" and forces the order to 'cancelado'.
--
-- The updated trigger handles four cases:
--   | Package mix                                      | Order status          |
--   | at least one retorno_hub, no entregado           | en_retorno            |
--   | at least one retorno_hub, at least one entregado | parcialmente_entregado|
--   | no retorno_hub, no other active packages         | cancelado (unchanged) |
--   | no retorno_hub, some active packages             | MIN/MAX (unchanged)   |
--
-- pipeline_position itself is left unchanged — retorno_hub keeps returning 0.
-- The trigger short-circuits on retorno_hub before the MIN/MAX path.
-- =============================================================

-- The pipeline_position helper is unchanged; retorno_hub keeps returning 0 and
-- is handled by an explicit branch in the trigger below.

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
    COUNT(*) FILTER (WHERE pipeline_position(status::text) > 0 AND status <> 'retorno_hub'),
    COUNT(*) FILTER (WHERE status = 'retorno_hub'),
    COUNT(*) FILTER (WHERE status = 'entregado')
  INTO v_active_count, v_retorno, v_entregado
  FROM packages
  WHERE order_id   = v_order_id
    AND deleted_at IS NULL;

  -- Return-flow branch takes precedence over the legacy MIN/MAX logic.
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

  -- No retorno_hub packages: fall through to the original logic.
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

  -- Positions 4 (sectorizado) and 5 (retenido) are package-only states;
  -- map them back to en_bodega for order-level status (same logic as
  -- 20260319000001_create_distribution_tables.sql).
  SELECT CASE
    WHEN v_min_pos <= 3 THEN
      CASE v_min_pos
        WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado' WHEN 3 THEN 'en_bodega'
      END
    WHEN v_min_pos IN (4, 5) THEN 'en_bodega'
    ELSE
      CASE v_min_pos
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
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
        WHEN 6 THEN 'asignado' WHEN 7 THEN 'en_carga' WHEN 8 THEN 'listo'
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

-- Trigger definition is unchanged; CREATE OR REPLACE on the function is enough.
