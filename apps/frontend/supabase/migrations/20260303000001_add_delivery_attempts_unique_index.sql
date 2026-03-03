-- Story 3A.1: Add unique index on delivery_attempts for idempotent UPSERT
-- Allows re-importing the same DispatchTrack XLSX without creating duplicate rows.
-- Uses a partial index (WHERE deleted_at IS NULL) to match Supabase soft-delete pattern.

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_attempts_unique_attempt
ON delivery_attempts(operator_id, order_id, attempt_number)
WHERE deleted_at IS NULL;
