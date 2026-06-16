-- =============================================================
-- Spec-43 follow-up: partial index on packages(status='retorno_hub')
--
-- The original spec-43 migration (20260512000001) tried to create this
-- index in the same transaction that added the 'retorno_hub' enum value.
-- Postgres rejects that ("unsafe use of new value of enum type",
-- SQLSTATE 55P04). Splitting the index into its own migration lets the
-- enum addition commit before the index references it.
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_packages_retorno_hub
  ON public.packages(order_id, status)
  WHERE status = 'retorno_hub';
