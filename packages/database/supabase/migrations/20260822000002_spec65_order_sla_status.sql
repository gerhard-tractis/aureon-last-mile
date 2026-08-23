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
-- LANGUAGE sql, not plpgsql: Task 2's list query will call this once per row
-- for the filter, again for the sort key, again for the count, over the
-- whole order history. A plpgsql set-returning function is opaque to the
-- planner and materializes a tuplestore per call; a `LANGUAGE sql` function
-- with this same `RETURNS TABLE` shape is eligible for
-- `inline_set_returning_function`, so the planner folds the CASE ladder
-- straight into the calling query, and — since it is IMMUTABLE — it can even
-- be used in an index expression later.
--
-- Semantics, mirrored from `classifyRisk` exactly:
--   - NULL p_now, delivered, or no effective delivery-window end → ('none', 0)
--   - a reschedule counts ONLY when all three reschedule columns are
--     non-null; a partial reschedule is ignored entirely
--   - the effective window end is truncated to the minute before comparing,
--     exactly as `toISO` in sla.ts drops seconds from the TIME column via
--     `time.slice(0, 5)`. `p_now` is NOT truncated — `classifyRisk` never
--     truncates its own `now` parameter either, so callers passing
--     `NOW() AT TIME ZONE ...` (which carries seconds) still match.
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
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
AS $$
  WITH effective AS (
    SELECT
      -- A reschedule counts only when all three columns are set. A partial
      -- reschedule (e.g. only the date changed) is ignored entirely and the
      -- original window is used, exactly as `effectiveWindow` in sla.ts does.
      -- date_trunc('minute', ...) drops any seconds on the chosen window's
      -- end, matching sla.ts's `time.slice(0, 5)`.
      date_trunc('minute',
        CASE
          WHEN p_rescheduled_delivery_date IS NOT NULL
           AND p_rescheduled_window_start  IS NOT NULL
           AND p_rescheduled_window_end    IS NOT NULL
            THEN p_rescheduled_delivery_date + p_rescheduled_window_end
          WHEN p_delivery_date IS NOT NULL
           AND p_delivery_window_end IS NOT NULL
            THEN p_delivery_date + p_delivery_window_end
          ELSE NULL
        END
      ) AS end_at
  ),
  minutes AS (
    SELECT
      FLOOR(EXTRACT(EPOCH FROM (effective.end_at - p_now)) / 60)::INT AS remaining
    FROM effective
  )
  SELECT
    CASE
      WHEN p_delivered_at IS NOT NULL
        OR p_now IS NULL
        OR effective.end_at IS NULL          THEN 'none'
      WHEN minutes.remaining < 0             THEN 'late'
      WHEN minutes.remaining <= 360          THEN 'at_risk'  -- AT_RISK_HOURS(6) * 60
      ELSE                                        'ok'
    END AS sla_status,
    CASE
      WHEN p_delivered_at IS NOT NULL
        OR p_now IS NULL
        OR effective.end_at IS NULL          THEN 0
      ELSE minutes.remaining
    END AS minutes_remaining
  FROM effective, minutes;
$$;

COMMENT ON FUNCTION public.order_sla_status(DATE, TIME, TIME, DATE, TIME, TIME, TIMESTAMP, TIMESTAMP) IS
  'spec-65 Task 1 — the SQL half of the SLA rule whose authority is classifyRisk (apps/frontend/src/app/app/operations-control/lib/sla.ts). A reschedule counts only when all three rescheduled_* columns are non-null. The effective window end is truncated to the minute (matching sla.ts dropping TIME seconds); p_now is not. Defined in TIMESTAMP (never TIMESTAMPTZ) so its verdict is independent of session TimeZone; callers pass wall-clock local time for p_now and p_delivered_at. LANGUAGE sql (not plpgsql) so the planner can inline it into the caller''s query. Checked against classifyRisk by matching case names in apps/frontend/src/lib/orders/sla-cases.ts and packages/database/supabase/tests/order_sla_status.test.sql.';

GRANT EXECUTE ON FUNCTION public.order_sla_status(DATE, TIME, TIME, DATE, TIME, TIME, TIMESTAMP, TIMESTAMP) TO authenticated;
