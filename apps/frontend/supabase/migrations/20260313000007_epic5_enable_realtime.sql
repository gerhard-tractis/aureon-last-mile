-- =============================================================
-- Epic 5: Enable Supabase Realtime on orders table
-- RLS automatically filters events to operator's own rows
-- =============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
