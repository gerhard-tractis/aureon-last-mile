-- =============================================================
-- Epic 5: Pipeline position helper, priority calculation, and
--          order status recalculation trigger
-- =============================================================

-- ── Pipeline Position Helper ──────────────────────────────────
-- Maps enum values to ordinal positions for MIN/MAX comparison
CREATE OR REPLACE FUNCTION pipeline_position(p_status TEXT)
RETURNS INT AS $$
  SELECT CASE p_status
    WHEN 'ingresado'  THEN 1
    WHEN 'verificado' THEN 2
    WHEN 'en_bodega'  THEN 3
    WHEN 'asignado'   THEN 4
    WHEN 'en_carga'   THEN 5
    WHEN 'listo'      THEN 6
    WHEN 'en_ruta'    THEN 7
    WHEN 'entregado'  THEN 8
    ELSE 0  -- terminal statuses (cancelado, devuelto, dañado, extraviado)
  END;
$$ LANGUAGE sql IMMUTABLE;

-- ── Order Status Recalculation Trigger ───────────────────────
CREATE OR REPLACE FUNCTION recalculate_order_status()
RETURNS TRIGGER AS $$
DECLARE
  v_order_id UUID;
  v_min_pos INT;
  v_max_pos INT;
  v_min_status order_status_enum;
  v_max_status order_status_enum;
  v_active_count INT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  -- Count active (non-terminal, non-deleted) packages
  SELECT COUNT(*) INTO v_active_count
  FROM packages
  WHERE order_id = v_order_id
    AND deleted_at IS NULL
    AND pipeline_position(status::text) > 0;

  -- If zero active packages → order is cancelado
  IF v_active_count = 0 THEN
    UPDATE orders SET
      status = 'cancelado',
      leading_status = 'cancelado',
      status_updated_at = NOW()
    WHERE id = v_order_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- MIN/MAX by pipeline position across active packages
  SELECT
    MIN(pipeline_position(p.status::text)),
    MAX(pipeline_position(p.status::text))
  INTO v_min_pos, v_max_pos
  FROM packages p
  WHERE p.order_id = v_order_id
    AND p.deleted_at IS NULL
    AND pipeline_position(p.status::text) > 0;

  -- Map positions back to enum values
  SELECT CASE v_min_pos
    WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado'
    WHEN 3 THEN 'en_bodega' WHEN 4 THEN 'asignado'
    WHEN 5 THEN 'en_carga'  WHEN 6 THEN 'listo'
    WHEN 7 THEN 'en_ruta'   WHEN 8 THEN 'entregado'
  END::order_status_enum INTO v_min_status;

  SELECT CASE v_max_pos
    WHEN 1 THEN 'ingresado' WHEN 2 THEN 'verificado'
    WHEN 3 THEN 'en_bodega' WHEN 4 THEN 'asignado'
    WHEN 5 THEN 'en_carga'  WHEN 6 THEN 'listo'
    WHEN 7 THEN 'en_ruta'   WHEN 8 THEN 'entregado'
  END::order_status_enum INTO v_max_status;

  UPDATE orders SET
    status = v_min_status,
    leading_status = v_max_status,
    status_updated_at = NOW()
  WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire on: INSERT, status change, soft delete, hard delete
CREATE TRIGGER trg_recalculate_order_status
  AFTER INSERT OR UPDATE OF status, deleted_at OR DELETE ON packages
  FOR EACH ROW
  EXECUTE FUNCTION recalculate_order_status();

-- ── Priority Calculation Function ────────────────────────────
CREATE OR REPLACE FUNCTION calculate_order_priority(
  p_delivery_date DATE,
  p_delivery_window_end TIME,
  p_current_time TIMESTAMPTZ DEFAULT NOW()
) RETURNS VARCHAR(10) AS $$
DECLARE
  v_deadline TIMESTAMPTZ;
  v_minutes_remaining INT;
BEGIN
  v_deadline := (p_delivery_date + COALESCE(p_delivery_window_end, '23:59'::TIME))
                AT TIME ZONE 'America/Santiago';

  v_minutes_remaining := EXTRACT(EPOCH FROM (v_deadline - p_current_time)) / 60;

  RETURN CASE
    WHEN v_minutes_remaining < 0 THEN 'late'
    WHEN v_minutes_remaining < 45 THEN 'urgent'
    WHEN v_minutes_remaining < 120 THEN 'alert'
    ELSE 'ok'
  END;
END;
$$ LANGUAGE plpgsql STABLE;
