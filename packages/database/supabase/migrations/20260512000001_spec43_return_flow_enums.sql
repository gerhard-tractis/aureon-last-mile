-- =============================================================
-- Spec-43: Extend status enums for failed-delivery return flow.
-- IMPORTANT: ALTER TYPE … ADD VALUE cannot run in the same
-- transaction that references the new values. This migration
-- only adds the values; the partial index on `retorno_hub`
-- lives in a follow-up migration so the new enum value is
-- committed before it's referenced.
-- =============================================================

-- Extend package_status_enum with the non-terminal "returning to hub" state
ALTER TYPE package_status_enum ADD VALUE IF NOT EXISTS 'retorno_hub' BEFORE 'cancelado';

-- Extend order_status_enum with the two new return-flow values
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'en_retorno';
ALTER TYPE order_status_enum ADD VALUE IF NOT EXISTS 'parcialmente_entregado';

-- Add return reason columns to packages (no enum dependency)
ALTER TABLE public.packages
  ADD COLUMN IF NOT EXISTS return_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_reason_code VARCHAR(10);

-- Note: the partial index `idx_packages_retorno_hub` is created in
-- 20260616000006_spec43_retorno_hub_index.sql once the new enum value
-- has been committed in this migration's own transaction.
--
-- Note: `idx_orders_operator_status` (full index on operator_id, status)
-- already exists from epic5, so no extra orders-side index is needed.
