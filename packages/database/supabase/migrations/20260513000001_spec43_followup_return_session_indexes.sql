-- =============================================================
-- Spec-43 follow-up: prevent duplicate return_receptions sessions
--
-- Two receptionists opening the same route at the same time used to insert
-- two separate (pending|in_progress) sessions because useReturnReceptionSession
-- did SELECT-then-INSERT with no constraint. This partial unique index makes
-- the DB refuse the second INSERT; find_or_create_return_reception (next
-- migration) catches the unique-violation and falls back to SELECT.
-- =============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_receptions_open_per_route
  ON public.return_receptions(operator_id, external_route_id)
  WHERE status IN ('pending', 'in_progress')
    AND deleted_at IS NULL;

COMMENT ON INDEX public.uq_return_receptions_open_per_route IS
  'At most one open (pending|in_progress) return reception session per (operator, external_route_id).';
