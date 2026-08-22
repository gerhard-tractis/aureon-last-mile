-- =============================================================================
-- spec-65 Task 1 — public.order_sla_status: the SLA rule, stated once in SQL
--
-- Pedidos (`/app/orders`) filters, sorts, counts and paginates orders by SLA
-- across the whole order history. The existing SLA authority is TypeScript
-- (`classifyRisk` in
-- apps/frontend/src/app/app/operations-control/lib/sla.ts), which runs over
-- a snapshot already loaded in the browser — fine for the Torre de control,
-- but Pedidos cannot ship thousands of orders to the client just to classify
-- them. This function is the SQL half of that one rule. It does not replace
-- `classifyRisk`, which stays the client-side authority for Torre de
-- control; this is a second implementation of the same contract, checked
-- against `classifyRisk` by matching case names in
-- apps/frontend/src/lib/orders/sla-cases.ts (TypeScript) and
-- packages/database/supabase/tests/order_sla_status.test.sql (SQL). Adding a
-- case means adding it to both files.
--
-- Semantics, mirrored from `classifyRisk` exactly:
--   - delivered, or no effective delivery-window end → ('none', 0)
--   - a reschedule counts ONLY when all three reschedule columns are
--     non-null; a partial reschedule is ignored entirely
--   - minutes remaining = floor((effective_end - now) / 1 minute)
--   - minutes_remaining < 0                    → 'late'
--   - minutes_remaining <= AT_RISK_HOURS * 60   → 'at_risk'  (note: <=, not <)
--   - otherwise                                → 'ok'
--
-- Timezone: this function is defined entirely in TIMESTAMP (never
-- TIMESTAMPTZ) so its verdict cannot depend on the database session's
-- TimeZone setting — the same reason `classifyRisk` builds a wall-clock
-- `Date` rather than parsing with an offset. Callers must pass
-- `NOW() AT TIME ZONE 'America/Santiago'` (or an order-owning-operator's
-- local equivalent) for `p_now`, and TIMESTAMP (not TIMESTAMPTZ) for
-- `p_delivered_at`.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_sla_status(
  p_delivery_date              DATE,
  p_delivery_window_start      TIME,
  p_delivery_window_end        TIME,
  p_rescheduled_delivery_date  DATE,
  p_rescheduled_window_start   TIME,
  p_rescheduled_window_end     TIME,
  p_delivered_at               TIMESTAMP,
  p_now                        TIMESTAMP
)
RETURNS TABLE (
  sla_status         TEXT,
  minutes_remaining  INT
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  -- AT_RISK_HOURS (6, from sla.ts) * 60. Kept as a literal constant here
  -- rather than a parameter: this function's whole job is to be the one
  -- other place the number 6 lives, matched to sla.ts by the case-name
  -- parity check, not to make the boundary configurable.
  c_at_risk_minutes CONSTANT INT := 360;
  v_has_reschedule  BOOLEAN;
  v_effective_end   TIMESTAMP;
  v_minutes         INT;
BEGIN
  -- A reschedule counts only when all three columns are set. A partial
  -- reschedule (e.g. only the date changed) is ignored entirely and the
  -- original window is used, exactly as `effectiveWindow` in sla.ts does.
  v_has_reschedule :=
    p_rescheduled_delivery_date IS NOT NULL
    AND p_rescheduled_window_start IS NOT NULL
    AND p_rescheduled_window_end IS NOT NULL;

  IF v_has_reschedule THEN
    v_effective_end := p_rescheduled_delivery_date + p_rescheduled_window_end;
  ELSIF p_delivery_date IS NOT NULL AND p_delivery_window_end IS NOT NULL THEN
    v_effective_end := p_delivery_date + p_delivery_window_end;
  ELSE
    v_effective_end := NULL;
  END IF;

  -- Delivered, or no effective window end at all: cannot be SLA-classified.
  IF p_delivered_at IS NOT NULL OR v_effective_end IS NULL THEN
    RETURN QUERY SELECT 'none'::TEXT, 0::INT;
    RETURN;
  END IF;

  v_minutes := FLOOR(EXTRACT(EPOCH FROM (v_effective_end - p_now)) / 60)::INT;

  IF v_minutes < 0 THEN
    RETURN QUERY SELECT 'late'::TEXT, v_minutes;
  ELSIF v_minutes <= c_at_risk_minutes THEN
    RETURN QUERY SELECT 'at_risk'::TEXT, v_minutes;
  ELSE
    RETURN QUERY SELECT 'ok'::TEXT, v_minutes;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.order_sla_status(DATE, TIME, TIME, DATE, TIME, TIME, TIMESTAMP, TIMESTAMP) IS
  'spec-65 Task 1 — the SQL half of the SLA rule whose authority is classifyRisk (apps/frontend/src/app/app/operations-control/lib/sla.ts). A reschedule counts only when all three rescheduled_* columns are non-null. Defined in TIMESTAMP (never TIMESTAMPTZ) so its verdict is independent of session TimeZone; callers pass wall-clock local time for p_now and p_delivered_at. Checked against classifyRisk by matching case names in apps/frontend/src/lib/orders/sla-cases.ts and packages/database/supabase/tests/order_sla_status.test.sql.';

GRANT EXECUTE ON FUNCTION public.order_sla_status(DATE, TIME, TIME, DATE, TIME, TIME, TIMESTAMP, TIMESTAMP) TO authenticated;
