-- Migration: Add external_route_id to dispatches for route backfill
-- Created: 2026-03-06
-- Story: 3B.1 polish — dispatch events arrive before route events,
--        need to store the provider's route ID for later FK backfill.

ALTER TABLE public.dispatches
  ADD COLUMN IF NOT EXISTS external_route_id VARCHAR(100);

COMMENT ON COLUMN public.dispatches.external_route_id IS 'Route ID from routing provider (e.g. DispatchTrack route_id integer). Used to backfill route_id FK when route event arrives later.';

CREATE INDEX IF NOT EXISTS idx_dispatches_external_route_id
  ON public.dispatches(operator_id, provider, external_route_id);
