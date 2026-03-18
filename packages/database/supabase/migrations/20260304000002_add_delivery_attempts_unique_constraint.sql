-- Story 3A.1 fix: Add plain unique constraint for PostgREST ON CONFLICT support.
-- PostgREST ?on_conflict= requires a plain unique constraint (not partial index).
-- The partial index from 20260303000001 is kept for soft-delete correctness but cannot be
-- used with PostgREST ON CONFLICT syntax — it only works with full unique constraints.

ALTER TABLE delivery_attempts
  ADD CONSTRAINT uq_delivery_attempts_attempt
  UNIQUE (operator_id, order_id, attempt_number);
