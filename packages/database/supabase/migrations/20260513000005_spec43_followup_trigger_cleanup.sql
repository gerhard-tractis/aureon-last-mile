-- =============================================================
-- Spec-43 follow-up: drop redundant predicate from recalculate_order_status
-- Template: latest definition from 20260512000002_spec43_recalculate_order_status.sql
--
-- pipeline_position('retorno_hub') already returns 0, so the AND status <>
-- 'retorno_hub' clause inside the FILTER expression is dead code. Removing
-- it doesn't change behaviour; the rewrite below is verbatim apart from
-- that one line.
-- =============================================================

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
